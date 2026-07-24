import "server-only";

import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

import type { db as Database } from "@/db";
import {
  cart,
  cartItem,
  cartItemAddon,
  product,
  productAddon,
  productImage,
  productOption,
  productOptionValue,
  productVariant,
  variantOptionValue,
} from "@/db/schema";
import {
  calcCartLineTotal,
  calcCartSummary,
  type CartSummary,
  type ShippingPolicy,
} from "@/domain/cart";
import { getSiteSetting } from "@/server/services/site-setting.service";

/**
 * 카트 도메인 서비스 — 비회원 카트(sessionToken) 기준.
 * customerId는 3주차 인증 후 병합용이라 지금은 채우지 않는다.
 * 쿠키 발급 등 HTTP 관심사는 라우터가 담당하고, 여기는 DB·규칙만 다룬다(RULE-14).
 */

// 트랜잭션 안팎에서 같은 헬퍼를 쓰기 위한 클라이언트 타입
type DatabaseClient = typeof Database;
type TransactionClient = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type QueryClient = DatabaseClient | TransactionClient;

/**
 * 배송 정책 — site_setting("shipping_policy")에서 로드.
 * 시드가 없어도 카트 합계가 깨지지 않도록 스펙 기본값으로 폴백한다.
 */
const FALLBACK_SHIPPING_POLICY: ShippingPolicy = { baseFee: 3000, freeThreshold: 30000 };

async function loadShippingPolicy(database: DatabaseClient): Promise<ShippingPolicy> {
  const stored = await getSiteSetting(database, "shipping_policy");
  if (stored && typeof stored === "object") {
    const candidate = stored as Partial<ShippingPolicy>;
    if (
      typeof candidate.baseFee === "number" &&
      typeof candidate.freeThreshold === "number"
    ) {
      return { baseFee: candidate.baseFee, freeThreshold: candidate.freeThreshold };
    }
  }
  return FALLBACK_SHIPPING_POLICY;
}

// =============================================================
// 조회
// =============================================================

export type CartLineAddon = {
  addonId: number;
  addonName: string;
  addonPrice: number;
  addonQuantity: number;
  /** 현재 남은 addon 재고 — addonQuantity > addonStock이면 UI가 수량 조정을 안내한다 */
  addonStock: number;
  /** addon 재고 0 — 색 + 텍스트로 함께 표시(KWCAG), 라인 주문 불가 */
  addonSoldOut: boolean;
  /** addon이 판매중지(isActive=false) — 라인 주문 불가 */
  addonUnavailable: boolean;
};

export type CartLine = {
  cartItemId: number;
  variantId: number;
  productId: number;
  productName: string;
  productSlug: string;
  thumbnailPath: string | null;
  thumbnailAlt: string | null;
  /** 옵션 조합 라벨(예: "24개입 / 선물 포장") — 옵션 없는 상품은 null */
  optionLabel: string | null;
  unitPrice: number;
  quantity: number;
  /** 현재 남은 재고 — quantity > stock이면 UI가 수량 조정을 안내한다 */
  stock: number;
  /** 재고 0 — 색 + 텍스트로 함께 표시(KWCAG) */
  soldOut: boolean;
  /** 상품·variant가 삭제/비활성 — 주문 불가, 합계에서 제외 */
  unavailable: boolean;
  addons: CartLineAddon[];
  /** 서버 계산 라인 금액(단가×수량 + 추가상품) */
  lineTotal: number;
};

export type CartView = {
  lines: CartLine[];
  summary: CartSummary;
};

/** 토큰의 카트 1건 — sessionToken에 유니크 제약이 없으므로 최신 것을 쓴다 */
async function findCartByToken(client: QueryClient, cartToken: string) {
  const [cartRow] = await client
    .select({ id: cart.id })
    .from(cart)
    .where(eq(cart.sessionToken, cartToken))
    .orderBy(desc(cart.id))
    .limit(1);
  return cartRow ?? null;
}

/**
 * 카트 화면 데이터 — 라인 + 서버 계산 합계를 한 번에 내려준다.
 * 토큰이 없거나 카트가 비어도 summary는 항상 내려준다(무료배송 안내 바 표시용).
 */
export async function getCartWithItems(
  database: DatabaseClient,
  cartToken: string | null,
): Promise<CartView> {
  const shippingPolicy = await loadShippingPolicy(database);
  const emptyView: CartView = { lines: [], summary: calcCartSummary([], shippingPolicy) };

  if (!cartToken) return emptyView;
  const cartRow = await findCartByToken(database, cartToken);
  if (!cartRow) return emptyView;

  const itemRows = await database
    .select({
      cartItemId: cartItem.id,
      variantId: cartItem.variantId,
      quantity: cartItem.quantity,
    })
    .from(cartItem)
    .where(eq(cartItem.cartId, cartRow.id))
    .orderBy(desc(cartItem.id)); // 최근 담은 라인이 위
  if (itemRows.length === 0) return emptyView;

  const variantIds = [...new Set(itemRows.map((row) => row.variantId))];
  const cartItemIds = itemRows.map((row) => row.cartItemId);

  const [variantRows, optionLabelRows, lineAddonRows] = await Promise.all([
    database
      .select({
        variantId: productVariant.id,
        unitPrice: productVariant.price,
        stock: productVariant.stock,
        variantActive: productVariant.isActive,
        variantDeletedAt: productVariant.deletedAt,
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        productStatus: product.status,
        productDeletedAt: product.deletedAt,
      })
      .from(productVariant)
      .innerJoin(product, eq(productVariant.productId, product.id))
      .where(inArray(productVariant.id, variantIds)),
    database
      .select({
        variantId: variantOptionValue.variantId,
        valueLabel: productOptionValue.value,
      })
      .from(variantOptionValue)
      .innerJoin(
        productOptionValue,
        eq(variantOptionValue.optionValueId, productOptionValue.id),
      )
      .innerJoin(productOption, eq(productOptionValue.optionId, productOption.id))
      .where(inArray(variantOptionValue.variantId, variantIds))
      .orderBy(asc(productOption.position)),
    database
      .select({
        cartItemId: cartItemAddon.cartItemId,
        addonId: cartItemAddon.addonId,
        addonQuantity: cartItemAddon.quantity,
        addonName: productAddon.name,
        addonPrice: productAddon.price,
        addonStock: productAddon.stock,
        addonActive: productAddon.isActive,
      })
      .from(cartItemAddon)
      .innerJoin(productAddon, eq(cartItemAddon.addonId, productAddon.id))
      .where(inArray(cartItemAddon.cartItemId, cartItemIds)),
  ]);

  const productIds = [...new Set(variantRows.map((row) => row.productId))];
  const thumbnailRows =
    productIds.length === 0
      ? []
      : await database
          .select({
            productId: productImage.productId,
            path: productImage.path,
            alt: productImage.alt,
          })
          .from(productImage)
          .where(
            and(
              inArray(productImage.productId, productIds),
              eq(productImage.kind, "thumbnail"),
            ),
          )
          .orderBy(desc(productImage.isPrimary), asc(productImage.position));

  const variantById = new Map(variantRows.map((row) => [row.variantId, row]));

  const optionLabelsByVariant = new Map<number, string[]>();
  for (const row of optionLabelRows) {
    const labels = optionLabelsByVariant.get(row.variantId) ?? [];
    labels.push(row.valueLabel);
    optionLabelsByVariant.set(row.variantId, labels);
  }

  const addonsByCartItem = new Map<number, CartLineAddon[]>();
  for (const row of lineAddonRows) {
    const addons = addonsByCartItem.get(row.cartItemId) ?? [];
    addons.push({
      addonId: row.addonId,
      addonName: row.addonName,
      addonPrice: row.addonPrice,
      addonQuantity: row.addonQuantity,
      addonStock: row.addonStock,
      addonSoldOut: row.addonStock <= 0,
      addonUnavailable: !row.addonActive,
    });
    addonsByCartItem.set(row.cartItemId, addons);
  }

  const thumbnailByProduct = new Map<number, { path: string; alt: string }>();
  for (const row of thumbnailRows) {
    if (!thumbnailByProduct.has(row.productId)) {
      thumbnailByProduct.set(row.productId, { path: row.path, alt: row.alt });
    }
  }

  const lines: CartLine[] = [];
  for (const itemRow of itemRows) {
    const variantRow = variantById.get(itemRow.variantId);
    if (!variantRow) continue; // variant가 하드 삭제되면 FK cascade로 라인도 사라진다 — 방어

    const unavailable =
      variantRow.productStatus !== "active" ||
      variantRow.productDeletedAt !== null ||
      !variantRow.variantActive ||
      variantRow.variantDeletedAt !== null;
    const addons = addonsByCartItem.get(itemRow.cartItemId) ?? [];
    const optionLabels = optionLabelsByVariant.get(itemRow.variantId);
    const thumbnail = thumbnailByProduct.get(variantRow.productId);

    lines.push({
      cartItemId: itemRow.cartItemId,
      variantId: itemRow.variantId,
      productId: variantRow.productId,
      productName: variantRow.productName,
      productSlug: variantRow.productSlug,
      thumbnailPath: thumbnail?.path ?? null,
      thumbnailAlt: thumbnail?.alt ?? null,
      optionLabel: optionLabels?.length ? optionLabels.join(" / ") : null,
      unitPrice: variantRow.unitPrice,
      quantity: itemRow.quantity,
      stock: variantRow.stock,
      soldOut: variantRow.stock <= 0,
      unavailable,
      addons,
      lineTotal: calcCartLineTotal({
        unitPrice: variantRow.unitPrice,
        quantity: itemRow.quantity,
        addons,
      }),
    });
  }

  const summary = calcCartSummary(
    lines.map((line) => ({
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      addons: line.addons,
      // 품절·판매중지 addon이 붙은 라인은 그 구성대로 주문할 수 없다 —
      // variant 품절과 동일하게 결제 예상 금액에서 제외한다
      orderable:
        !line.unavailable &&
        !line.soldOut &&
        line.addons.every((addon) => !addon.addonSoldOut && !addon.addonUnavailable),
    })),
    shippingPolicy,
  );

  return { lines, summary };
}

/** 헤더 뱃지용 라인 수 — 수량 합이 아니라 라인 개수 */
export async function getCartItemCount(
  database: DatabaseClient,
  cartToken: string | null,
): Promise<number> {
  if (!cartToken) return 0;
  const cartRow = await findCartByToken(database, cartToken);
  if (!cartRow) return 0;

  const [row] = await database
    .select({ lineCount: count() })
    .from(cartItem)
    .where(eq(cartItem.cartId, cartRow.id));
  return row?.lineCount ?? 0;
}

// =============================================================
// 변경
// =============================================================

export type CartAddonSelection = {
  addonId: number;
  quantity: number;
};

export type CartMutationResult = {
  cartItemId: number;
  /** 실제 반영된 수량 — 재고 초과 요청은 재고만큼 보정된다(RULE-11) */
  appliedQuantity: number;
  /** 재고 부족으로 수량이 보정되었는지 — true면 원인+해결 토스트를 띄운다 */
  stockLimited: boolean;
  /** addon 수량이 addon 재고로 보정되었는지 — true면 장바구니에서 수량 확인을 안내한다 */
  addonStockLimited: boolean;
  /** 현재 남은 재고 — "재고가 N개 남았습니다. 수량을 조정해 주세요" 안내용 */
  availableStock: number;
};

/** 같은 addonId를 중복 선택해 보내도 한 줄로 합친다 — PK(cartItemId, addonId) 충돌 방지 */
function normalizeAddonSelections(selections: CartAddonSelection[]): CartAddonSelection[] {
  const quantityByAddonId = new Map<number, number>();
  for (const selection of selections) {
    quantityByAddonId.set(
      selection.addonId,
      (quantityByAddonId.get(selection.addonId) ?? 0) + selection.quantity,
    );
  }
  return [...quantityByAddonId.entries()].map(([addonId, quantity]) => ({
    addonId,
    quantity,
  }));
}

/** 조합 동일성 = addonId 집합 일치(수량 무관). 병합 시 수량은 각각 합산한다(스키마 주석 규약) */
function sameAddonCombination(
  lineAddons: { addonId: number }[],
  requested: CartAddonSelection[],
): boolean {
  if (lineAddons.length !== requested.length) return false;
  const lineAddonIds = new Set(lineAddons.map((addon) => addon.addonId));
  return requested.every((selection) => lineAddonIds.has(selection.addonId));
}

/** variant + 상품 노출 상태 검증 — 담기/수량변경 공통 */
async function loadSellableVariant(database: DatabaseClient, variantId: number) {
  const [variantRow] = await database
    .select({
      variantId: productVariant.id,
      productId: productVariant.productId,
      stock: productVariant.stock,
      variantActive: productVariant.isActive,
      variantDeletedAt: productVariant.deletedAt,
      productStatus: product.status,
      productDeletedAt: product.deletedAt,
    })
    .from(productVariant)
    .innerJoin(product, eq(productVariant.productId, product.id))
    .where(eq(productVariant.id, variantId))
    .limit(1);

  if (
    !variantRow ||
    variantRow.productStatus !== "active" ||
    variantRow.productDeletedAt !== null ||
    !variantRow.variantActive ||
    variantRow.variantDeletedAt !== null
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "지금은 판매하지 않는 상품입니다. 상품 목록에서 다시 선택해 주세요.",
    });
  }
  return variantRow;
}

export type AddCartItemInput = {
  cartToken: string;
  variantId: number;
  quantity: number;
  addons?: CartAddonSelection[];
};

/**
 * 카트 담기 — 카트가 없으면 생성하고, 동일 variant + 동일 addon 조합 라인은 수량을 병합한다.
 * 재고 초과 요청은 거부하지 않고 재고만큼 보정해 담고, 보정 사실을 돌려준다.
 */
export async function addCartItem(
  database: DatabaseClient,
  input: AddCartItemInput,
): Promise<CartMutationResult> {
  const variantRow = await loadSellableVariant(database, input.variantId);

  if (variantRow.stock <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "품절된 상품입니다. 재입고 알림을 신청해 주세요.",
    });
  }

  const requestedAddons = normalizeAddonSelections(input.addons ?? []);
  // addon도 자체 재고가 판매 한도(스키마 productAddon.stock) — variant와 동일하게 검증한다
  const addonStockById = new Map<number, number>();
  if (requestedAddons.length > 0) {
    const validAddonRows = await database
      .select({ addonId: productAddon.id, addonStock: productAddon.stock })
      .from(productAddon)
      .where(
        and(
          inArray(
            productAddon.id,
            requestedAddons.map((selection) => selection.addonId),
          ),
          eq(productAddon.productId, variantRow.productId),
          eq(productAddon.isActive, true),
        ),
      );
    if (validAddonRows.length !== requestedAddons.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "선택한 추가상품을 찾을 수 없습니다. 상품 페이지에서 다시 선택해 주세요.",
      });
    }
    if (validAddonRows.some((row) => row.addonStock <= 0)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "품절된 추가상품이 있습니다. 추가상품을 빼고 다시 담아 주세요.",
      });
    }
    for (const row of validAddonRows) {
      addonStockById.set(row.addonId, row.addonStock);
    }
  }

  // 카트 확보 → 병합 대상 탐색 → 반영까지 한 트랜잭션 — 라인과 addon이 어긋나지 않게
  return database.transaction(async (tx) => {
    const existingCart = await findCartByToken(tx, input.cartToken);
    const cartId = existingCart
      ? existingCart.id
      : (
          await tx
            .insert(cart)
            .values({ sessionToken: input.cartToken })
            .returning({ id: cart.id })
        )[0].id;

    const candidateRows = await tx
      .select({ cartItemId: cartItem.id, quantity: cartItem.quantity })
      .from(cartItem)
      .where(and(eq(cartItem.cartId, cartId), eq(cartItem.variantId, input.variantId)));

    type CandidateAddonRow = { cartItemId: number; addonId: number; addonQuantity: number };
    const candidateAddonRows: CandidateAddonRow[] =
      candidateRows.length === 0
        ? []
        : await tx
            .select({
              cartItemId: cartItemAddon.cartItemId,
              addonId: cartItemAddon.addonId,
              addonQuantity: cartItemAddon.quantity,
            })
            .from(cartItemAddon)
            .where(
              inArray(
                cartItemAddon.cartItemId,
                candidateRows.map((row) => row.cartItemId),
              ),
            );
    const addonsByCandidate = new Map<number, CandidateAddonRow[]>();
    for (const row of candidateAddonRows) {
      const addons = addonsByCandidate.get(row.cartItemId) ?? [];
      addons.push(row);
      addonsByCandidate.set(row.cartItemId, addons);
    }

    const mergeTarget =
      candidateRows.find((row) =>
        sameAddonCombination(addonsByCandidate.get(row.cartItemId) ?? [], requestedAddons),
      ) ?? null;

    const availableStock = variantRow.stock;

    if (mergeTarget) {
      const desiredQuantity = mergeTarget.quantity + input.quantity;
      const appliedQuantity = Math.min(desiredQuantity, availableStock);
      await tx
        .update(cartItem)
        .set({ quantity: appliedQuantity })
        .where(eq(cartItem.id, mergeTarget.cartItemId));

      // 같은 조합을 다시 담은 것이므로 addon 수량도 함께 합산한다 — addon 재고 초과분은 보정(RULE-11)
      let addonStockLimited = false;
      const targetAddons = addonsByCandidate.get(mergeTarget.cartItemId) ?? [];
      for (const requested of requestedAddons) {
        const currentAddon = targetAddons.find(
          (addon) => addon.addonId === requested.addonId,
        );
        const desiredAddonQuantity =
          (currentAddon?.addonQuantity ?? 0) + requested.quantity;
        const appliedAddonQuantity = Math.min(
          desiredAddonQuantity,
          addonStockById.get(requested.addonId) ?? 0,
        );
        if (appliedAddonQuantity < desiredAddonQuantity) addonStockLimited = true;
        await tx
          .update(cartItemAddon)
          .set({ quantity: appliedAddonQuantity })
          .where(
            and(
              eq(cartItemAddon.cartItemId, mergeTarget.cartItemId),
              eq(cartItemAddon.addonId, requested.addonId),
            ),
          );
      }

      return {
        cartItemId: mergeTarget.cartItemId,
        appliedQuantity,
        stockLimited: desiredQuantity > appliedQuantity,
        addonStockLimited,
        availableStock,
      };
    }

    const appliedQuantity = Math.min(input.quantity, availableStock);
    const [insertedItem] = await tx
      .insert(cartItem)
      .values({ cartId, variantId: input.variantId, quantity: appliedQuantity })
      .returning({ id: cartItem.id });

    // addon 수량도 addon 재고를 상한으로 보정해 담는다(RULE-11)
    let addonStockLimited = false;
    if (requestedAddons.length > 0) {
      await tx.insert(cartItemAddon).values(
        requestedAddons.map((selection) => {
          const appliedAddonQuantity = Math.min(
            selection.quantity,
            addonStockById.get(selection.addonId) ?? 0,
          );
          if (appliedAddonQuantity < selection.quantity) addonStockLimited = true;
          return {
            cartItemId: insertedItem.id,
            addonId: selection.addonId,
            quantity: appliedAddonQuantity,
          };
        }),
      );
    }

    return {
      cartItemId: insertedItem.id,
      appliedQuantity,
      stockLimited: input.quantity > appliedQuantity,
      addonStockLimited,
      availableStock,
    };
  });
}

/** 카트 소유 검증 — 토큰의 카트에 속한 라인만 만질 수 있다 */
async function findOwnedCartItem(
  database: DatabaseClient,
  cartToken: string,
  cartItemId: number,
) {
  const [itemRow] = await database
    .select({
      cartItemId: cartItem.id,
      variantId: cartItem.variantId,
      quantity: cartItem.quantity,
    })
    .from(cartItem)
    .innerJoin(cart, eq(cartItem.cartId, cart.id))
    .where(and(eq(cartItem.id, cartItemId), eq(cart.sessionToken, cartToken)))
    .limit(1);
  return itemRow ?? null;
}

export async function updateCartItemQuantity(
  database: DatabaseClient,
  input: { cartToken: string; cartItemId: number; quantity: number },
): Promise<CartMutationResult> {
  const itemRow = await findOwnedCartItem(database, input.cartToken, input.cartItemId);
  if (!itemRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "장바구니에 없는 상품입니다. 화면을 새로고침해 주세요.",
    });
  }

  const [variantRow] = await database
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, itemRow.variantId))
    .limit(1);
  const availableStock = variantRow?.stock ?? 0;

  if (availableStock <= 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "품절된 상품이라 수량을 바꿀 수 없습니다. 라인을 삭제해 주세요.",
    });
  }

  const appliedQuantity = Math.min(input.quantity, availableStock);
  await database
    .update(cartItem)
    .set({ quantity: appliedQuantity })
    .where(eq(cartItem.id, itemRow.cartItemId));

  return {
    cartItemId: itemRow.cartItemId,
    appliedQuantity,
    stockLimited: input.quantity > appliedQuantity,
    addonStockLimited: false, // 수량 변경은 addon을 건드리지 않는다
    availableStock,
  };
}

/** 실행취소 토스트(UX 규칙 7)가 재담기에 쓰는 스냅샷 — addCartItem 입력으로 그대로 넣을 수 있다 */
export type RemovedCartLineSnapshot = {
  variantId: number;
  quantity: number;
  addons: CartAddonSelection[];
};

export async function removeCartItem(
  database: DatabaseClient,
  input: { cartToken: string; cartItemId: number },
): Promise<RemovedCartLineSnapshot> {
  const itemRow = await findOwnedCartItem(database, input.cartToken, input.cartItemId);
  if (!itemRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "장바구니에 없는 상품입니다. 화면을 새로고침해 주세요.",
    });
  }

  const addonRows = await database
    .select({ addonId: cartItemAddon.addonId, quantity: cartItemAddon.quantity })
    .from(cartItemAddon)
    .where(eq(cartItemAddon.cartItemId, itemRow.cartItemId));

  // addon 라인은 FK cascade로 함께 삭제된다
  await database.delete(cartItem).where(eq(cartItem.id, itemRow.cartItemId));

  return {
    variantId: itemRow.variantId,
    quantity: itemRow.quantity,
    addons: addonRows,
  };
}
