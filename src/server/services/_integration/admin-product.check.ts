/**
 * 관리자 상품 관리 검증 — 등록·수정·variant 재조정을 실제 DB에서 확인한다.
 * 실행: npm run check:admin-product   (SSH 터널 켠 상태)
 *
 * 핵심 검증은 **variant 재조정**이다. 옵션을 바꿔도 기존 판매 단위의 id가 살아남는지는
 * 실측해야만 알 수 있고, 여기가 깨지면 이미 팔린 주문의 통계 참조와 재고 원장이 끊긴다.
 *
 * 시나리오: [1]신규 등록(조합 생성·minPrice·이미지) [2]옵션 값 추가 — 기존 id 보존
 *           [3]옵션 값 삭제 — 하드 삭제가 아니라 내림 [4]재고 조정 원장
 *           [5]slug 중복 차단 [6]옵션 미사용 단일 상품 [7]목록 탭·품절 [8]삭제 [9]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  adminUser,
  inventoryLog,
  product,
  productImage,
  productOption,
  productVariant,
} from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

let passCount = 0;
let failCount = 0;

function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passCount += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failCount += 1;
    console.log(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function adminCaller(adminUserId: number) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(adminUserId))
    .setAudience("admin")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const headers = new Headers({ cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}` });
  return createCaller(await createTRPCContext({ headers }));
}

type AdminApi = Awaited<ReturnType<typeof adminCaller>>;

/** 살아있는 판매 단위를 조합 라벨과 함께 — 재조정 검증의 기준 */
async function readLiveVariants(productId: number) {
  return db
    .select({ id: productVariant.id, price: productVariant.price, stock: productVariant.stock })
    .from(productVariant)
    .where(and(eq(productVariant.productId, productId), isNull(productVariant.deletedAt)))
    .orderBy(productVariant.position, productVariant.id);
}

const SUFFIX = randomUUID().slice(0, 8);
const BASE_SLUG = `check-product-${SUFFIX}`;

/** 옵션 2그룹의 전 조합을 만든다 — 화면이 하는 일과 같다 */
function buildVariantMatrix(
  optionGroups: { name: string; values: string[] }[],
  basePrice: number,
  stock: number,
) {
  let combinations: string[][] = [[]];
  for (const optionGroup of optionGroups) {
    const next: string[][] = [];
    for (const partial of combinations) {
      for (const value of optionGroup.values) next.push([...partial, value]);
    }
    combinations = next;
  }
  return combinations.map((optionLabels, index) => ({
    optionLabels,
    price: basePrice + index * 1000,
    compareAtPrice: null,
    stock,
    sku: null,
    isActive: true,
  }));
}

async function main() {
  console.log("PaRaSOL 관리자 상품 관리 검증 (임시 상품은 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const createdProductIds: number[] = [];

  try {
    const caller: AdminApi = await adminCaller(admin.id);

    console.log("\n[1] 신규 등록 — 조합 생성·표시가·이미지 기대");
    const optionGroups = [
      { name: "구성", values: ["12개입", "24개입"] },
      { name: "포장", values: ["기본 포장", "선물 포장"] },
    ];
    const created = await caller.adminProduct.save({
      productId: null,
      name: `검증용 쿠키 ${SUFFIX}`,
      slug: BASE_SLUG,
      summary: "검증용 상품입니다",
      description: null,
      productStatus: "active",
      badgeLabel: null,
      makerId: null,
      categoryIds: [],
      options: optionGroups,
      variants: buildVariantMatrix(optionGroups, 10000, 5),
      addons: [{ addonId: null, name: "메시지 카드", price: 1000, isActive: true }],
      images: [
        { imageKind: "thumbnail", path: "products/202607/aaaa1111.jpg", alt: "쿠키 대표 이미지" },
        { imageKind: "detail", path: "products/202607/bbbb2222.jpg", alt: "쿠키 상세 이미지" },
      ],
    });
    createdProductIds.push(created.productId);

    const firstVariants = await readLiveVariants(created.productId);
    check(firstVariants.length === 4, `2×2 조합 → 판매 단위 4개 (${firstVariants.length})`);

    const [productRow] = await db
      .select({ minPrice: product.minPrice })
      .from(product)
      .where(eq(product.id, created.productId));
    check(
      productRow.minPrice === 10000,
      `표시가 캐시가 최저가로 갱신 (${productRow.minPrice})`,
    );

    const imageRows = await db
      .select({ kind: productImage.kind, isPrimary: productImage.isPrimary })
      .from(productImage)
      .where(eq(productImage.productId, created.productId));
    check(
      imageRows.filter((row) => row.kind === "thumbnail" && row.isPrimary).length === 1,
      "갤러리 첫 장이 대표 이미지",
      imageRows,
    );

    console.log("\n[2] 옵션 값 추가 — 기존 판매 단위 id가 살아남는다 기대");
    const idsBefore = new Set(firstVariants.map((row) => row.id));
    const grownGroups = [
      { name: "구성", values: ["12개입", "24개입", "36개입"] },
      { name: "포장", values: ["기본 포장", "선물 포장"] },
    ];
    const editForm = await caller.adminProduct.form({ productId: created.productId });
    await caller.adminProduct.save({
      ...editForm.form,
      productId: created.productId,
      options: grownGroups,
      variants: buildVariantMatrix(grownGroups, 10000, 5),
    });

    const grownVariants = await readLiveVariants(created.productId);
    check(grownVariants.length === 6, `3×2 조합 → 6개 (${grownVariants.length})`);
    const survived = grownVariants.filter((row) => idsBefore.has(row.id));
    check(
      survived.length === 4,
      `기존 4개가 id 그대로 살아남았다 (${survived.length}) — 지웠다면 주문 통계 참조가 끊긴다`,
      { before: [...idsBefore], after: grownVariants.map((row) => row.id) },
    );

    console.log("\n[3] 옵션 값 삭제 — 하드 삭제가 아니라 내림 기대");
    const shrunkGroups = [
      { name: "구성", values: ["12개입"] },
      { name: "포장", values: ["기본 포장", "선물 포장"] },
    ];
    const beforeShrink = await caller.adminProduct.form({ productId: created.productId });
    await caller.adminProduct.save({
      ...beforeShrink.form,
      productId: created.productId,
      options: shrunkGroups,
      variants: buildVariantMatrix(shrunkGroups, 10000, 5),
    });

    const shrunkVariants = await readLiveVariants(created.productId);
    check(shrunkVariants.length === 2, `1×2 조합 → 2개 (${shrunkVariants.length})`);

    const allRows = await db
      .select({ id: productVariant.id, deletedAt: productVariant.deletedAt })
      .from(productVariant)
      .where(eq(productVariant.productId, created.productId));
    check(
      allRows.length === 6 && allRows.filter((row) => row.deletedAt !== null).length === 4,
      `행은 6개 그대로, 4개만 내려갔다 (총 ${allRows.length} · 내림 ${allRows.filter((r) => r.deletedAt !== null).length})`,
    );

    const optionRows = await db
      .select({ id: productOption.id })
      .from(productOption)
      .where(eq(productOption.productId, created.productId));
    check(optionRows.length === 2, `옵션 그룹 2개 유지 (${optionRows.length})`);

    console.log("\n[4] 재고 직접 수정 — 원장에 남는다 기대");
    const beforeStock = await caller.adminProduct.form({ productId: created.productId });
    const targetVariantId = shrunkVariants[0].id;
    const adjusted = await caller.adminProduct.save({
      ...beforeStock.form,
      productId: created.productId,
      variants: beforeStock.form.variants.map((variantEntry, index) =>
        index === 0 ? { ...variantEntry, stock: 42 } : variantEntry,
      ),
    });
    check(adjusted.stockAdjustedCount === 1, `재고 조정 1건 보고 (${adjusted.stockAdjustedCount})`);

    const [logRow] = await db
      .select({ delta: inventoryLog.delta, stockAfter: inventoryLog.stockAfter, reason: inventoryLog.reason })
      .from(inventoryLog)
      .where(and(eq(inventoryLog.variantId, targetVariantId), eq(inventoryLog.reason, "manual")))
      .orderBy(inventoryLog.id);
    check(
      logRow !== undefined && logRow.reason === "manual",
      "manual 원장 기록 — 재고가 조용히 바뀌지 않는다",
      logRow,
    );

    const [stockRow] = await db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, targetVariantId));
    check(stockRow.stock === 42, `재고 반영 (${stockRow.stock})`);

    console.log("\n[5] slug 중복 — 차단 기대");
    let slugBlocked = false;
    try {
      await caller.adminProduct.save({
        ...beforeStock.form,
        productId: null,
        name: "중복 시도",
        slug: BASE_SLUG,
      });
    } catch (error) {
      slugBlocked = error instanceof Error && /이미 사용 중인 URL/.test(error.message);
    }
    check(slugBlocked, "같은 URL 주소로 새 상품을 만들 수 없다");

    console.log("\n[6] 옵션 미사용 단일 상품 — 판매 단위 1개 강제 기대");
    const single = await caller.adminProduct.save({
      productId: null,
      name: `검증용 단일상품 ${SUFFIX}`,
      slug: `${BASE_SLUG}-single`,
      summary: null,
      description: null,
      productStatus: "active",
      badgeLabel: null,
      makerId: null,
      categoryIds: [],
      options: [],
      variants: [
        { optionLabels: [], price: 8000, compareAtPrice: 10000, stock: 0, sku: null, isActive: true },
      ],
      addons: [],
      images: [],
    });
    createdProductIds.push(single.productId);
    const singleVariants = await readLiveVariants(single.productId);
    check(singleVariants.length === 1, "옵션이 없어도 판매 단위 1개가 있다(RULE-11)");

    console.log("\n[7] 목록 — 품절 판정은 상태가 아니라 재고에서 온다 기대");
    const soldoutList = await caller.adminProduct.list({ tab: "soldout" });
    check(
      soldoutList.cards.some((card) => card.productId === single.productId),
      "재고 0인 판매중 상품이 품절 탭에 잡힌다",
    );
    const soldoutCard = soldoutList.cards.find((card) => card.productId === single.productId);
    check(soldoutCard?.isSoldOut === true, "카드가 품절을 값으로 알린다(색만으로 전달 금지)");

    const searched = await caller.adminProduct.list({ keyword: SUFFIX });
    check(searched.totalCount >= 2, `검색으로 두 상품이 잡힌다 (${searched.totalCount})`);

    const lowStockSort = await caller.adminProduct.list({ sort: "lowstock", keyword: SUFFIX });
    check(
      lowStockSort.cards[0]?.productId === single.productId,
      "재고 적은 순 정렬이 재고 0을 먼저 보여준다",
      lowStockSort.cards.map((card) => ({ id: card.productId, stock: card.totalStock })),
    );

    console.log("\n[8] 삭제 — 행은 남고 목록에서만 사라진다 기대");
    await caller.adminProduct.remove({ productIds: [single.productId] });
    const afterDelete = await caller.adminProduct.list({ keyword: SUFFIX });
    check(
      !afterDelete.cards.some((card) => card.productId === single.productId),
      "삭제된 상품은 목록에 없다",
    );
    const [deletedRow] = await db
      .select({ deletedAt: product.deletedAt })
      .from(product)
      .where(eq(product.id, single.productId));
    check(
      deletedRow?.deletedAt !== null,
      "행은 남아 있다 — 주문·리뷰 이력이 참조한다",
      deletedRow,
    );
    const deletedVariants = await readLiveVariants(single.productId);
    check(deletedVariants.length === 0, "판매 단위도 함께 내려간다 — 장바구니에 담기지 않는다");

    console.log("\n[9] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let listForbidden = false;
    let saveForbidden = false;
    try {
      await anonymous.adminProduct.list({});
    } catch (error) {
      listForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminProduct.remove({ productIds: [created.productId] });
    } catch (error) {
      saveForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(listForbidden, "관리자 세션 없이는 상품 목록 조회 불가");
    check(saveForbidden, "관리자 세션 없이는 상품 삭제 불가");
  } finally {
    if (createdProductIds.length > 0) {
      const variantIds = await db
        .select({ id: productVariant.id })
        .from(productVariant)
        .where(inArray(productVariant.productId, createdProductIds));
      if (variantIds.length > 0) {
        await db.delete(inventoryLog).where(
          inArray(
            inventoryLog.variantId,
            variantIds.map((row) => row.id),
          ),
        );
      }
      // 검증용으로 새로 만든 상품이라 참조가 없다 — 하드 삭제해 흔적을 남기지 않는다
      await db.delete(product).where(inArray(product.id, createdProductIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
