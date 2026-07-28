import "server-only";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import {
  cart,
  orderItem,
  orderItemAddon,
  orders,
  orderStatusHistory,
  payment,
  termsAgreement,
  termsDocument,
} from "@/db/schema";
import {
  buildOrderDraft,
  type OrderDraftLine,
} from "@/domain/order";
import { normalizePhone } from "@/domain/phone";

import { getCartWithItems, type CartLine } from "./cart.service";
import type { DatabaseClient, TransactionClient } from "./db-client";
import { loadShippingPolicy } from "./shipping-policy.service";
import { getRequiredTermsDocumentIds } from "./terms.service";
import { serializeActor } from "./order-status.service";
import { allocateOrderNo } from "./order-number.service";

/**
 * 주문 서비스 — 생성(체크아웃) 트랜잭션.
 *
 * 설계 확정(§2 단계1): 이 시점에는 **재고를 차감하지 않고 카트도 비우지 않는다.**
 * "재고 차감됨 ⇔ 결제 완료(paid)"라는 불변식을 지키기 위해서다. 결제창에서 이탈하거나
 * 결제가 거절되는 흔한 경우에 재고가 묶이지 않고, 되돌리는 청소 로직도 필요 없다.
 *
 * 금액은 트랜잭션 안에서 다시 계산한다(RULE-11) — 클라이언트가 보낸 금액은 신뢰하지 않고,
 * 카트 화면을 본 뒤 가격이 바뀌었을 수 있으므로 결제 직전 값으로 확정한다.
 */

/** 카트 라인 → 도메인 입력. 주문 가능 여부 판정은 카트 서비스가 이미 계산한 값을 따른다 */
function toDraftLine(line: CartLine): OrderDraftLine {
  return {
    variantId: line.variantId,
    productId: line.productId,
    productName: line.productName,
    makerName: line.makerName,
    variantName: line.optionLabel,
    listPrice: line.listPrice,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    thumbnailPath: line.thumbnailPath,
    thumbnailAlt: line.thumbnailAlt,
    addons: line.addons.map((addon) => ({
      addonId: addon.addonId,
      addonName: addon.addonName,
      addonPrice: addon.addonPrice,
      addonQuantity: addon.addonQuantity,
    })),
    orderable:
      !line.unavailable &&
      !line.soldOut &&
      line.quantity <= line.stock &&
      line.addons.every(
        (addon) =>
          !addon.addonSoldOut &&
          !addon.addonUnavailable &&
          addon.addonQuantity <= addon.addonStock,
      ),
  };
}

export type OrdererInput = {
  name: string;
  phone: string;
  email?: string | null;
};

export type ShippingAddressInput = {
  recipient: string;
  phone: string;
  zipcode: string;
  addr1: string;
  addr2?: string | null;
  deliveryMemo?: string | null;
};

export type CreatePendingOrderInput = {
  cartToken: string;
  customerId: number | null;
  orderer: OrdererInput;
  shippingAddress: ShippingAddressInput;
  /**
   * 주문할 카트 라인 — 장바구니에서 체크한 것만 결제로 넘어온다.
   * 생략하면 카트 전체. 품절 상품을 장바구니에 남겨둔 사용자가 결제 자체를 못 하는 일을 막는다.
   */
  cartItemIds?: number[];
  /** 동의한 약관 문서 id — 필수 문서를 모두 포함해야 한다(서버가 검증) */
  agreedTermsDocumentIds: number[];
  /** 동의 증빙에 남길 요청 IP — 알 수 없으면 null */
  agreementIp: string | null;
};

export type CreatePendingOrderResult = {
  orderId: number;
  orderNo: string;
  /** 비회원 주문조회용 — 회원 주문이면 null */
  guestToken: string | null;
  grandTotal: number;
};

export class CartNotFoundError extends Error {
  constructor() {
    super("장바구니를 찾을 수 없습니다.");
    this.name = "CartNotFoundError";
  }
}

/** 필수 약관에 동의하지 않은 주문 — 화면만 막으면 API 직접 호출로 뚫린다 */
export class TermsNotAgreedError extends Error {
  constructor(readonly missingDocumentIds: number[]) {
    super("필수 약관에 모두 동의해야 주문할 수 있습니다.");
    this.name = "TermsNotAgreedError";
  }
}

/**
 * 지금 유효한 필수 약관 전부에 동의했는지 확인하고, 동의 이력을 남긴다.
 * 필수 문서 집합은 클라이언트가 아니라 terms_document.is_required가 정한다.
 */
async function recordTermsAgreements(
  tx: TransactionClient,
  args: {
    orderId: number;
    customerId: number | null;
    agreedDocumentIds: number[];
    ip: string | null;
  },
): Promise<void> {
  // 필수 판정은 terms.service가 소유한다 — "코드별 최신 1건"이라는 규칙이 갈리면
  // 약관 개정 시 구버전 동의를 요구해 주문이 통째로 막힌다(RULE-14 단일 진실원)
  const requiredDocumentIds = await getRequiredTermsDocumentIds(tx);

  const agreed = new Set(args.agreedDocumentIds);
  const missing = requiredDocumentIds.filter((documentId) => !agreed.has(documentId));
  if (missing.length > 0) throw new TermsNotAgreedError(missing);

  if (args.agreedDocumentIds.length === 0) return;

  // 존재하지 않는 문서 id가 섞여 오면 FK 위반으로 트랜잭션이 죽는다 — 실재하는 것만 남긴다
  const knownDocs = await tx
    .select({ id: termsDocument.id })
    .from(termsDocument)
    .where(inArray(termsDocument.id, args.agreedDocumentIds));
  if (knownDocs.length === 0) return;

  await tx.insert(termsAgreement).values(
    knownDocs.map((doc) => ({
      customerId: args.customerId,
      orderId: args.orderId,
      termsDocumentId: doc.id,
      ip: args.ip,
    })),
  );
}

/**
 * 결제 전 주문(pending)을 만든다. 토스 결제위젯에 넘길 orderId·amount의 출처다.
 *
 * 카트 행을 FOR UPDATE로 잠가 같은 카트의 동시 체크아웃(더블 클릭 포함)을 직렬화한다.
 * 잠그지 않으면 두 요청이 같은 카트로 각각 주문을 만들 수 있다.
 */
export async function createPendingOrder(
  database: DatabaseClient,
  input: CreatePendingOrderInput,
): Promise<CreatePendingOrderResult> {
  return database.transaction(async (tx) => {
    const [cartRow] = await tx
      .select({ id: cart.id })
      .from(cart)
      .where(eq(cart.sessionToken, input.cartToken))
      .for("update")
      .limit(1);
    if (!cartRow) throw new CartNotFoundError();

    // 트랜잭션 안에서 재조회 — 카트 화면을 본 뒤 가격·재고가 바뀌었을 수 있다.
    // 트랜잭션은 커넥션 하나를 쓰므로 Promise.all로 겹쳐 보내면 안 된다(pg가 쿼리 충돌 경고,
    // pg@9부터는 오류). 트랜잭션 안에서는 항상 순차 실행한다.
    const cartView = await getCartWithItems(tx, input.cartToken);
    const shippingPolicy = await loadShippingPolicy(tx);

    // 장바구니에서 체크한 라인만 주문한다 — 나머지(품절 상품 포함)는 카트에 남는다
    const selectedIds = input.cartItemIds;
    const selectedLines =
      selectedIds === undefined || selectedIds.length === 0
        ? cartView.lines
        : cartView.lines.filter((line) => selectedIds.includes(line.cartItemId));

    // 선택 라인 중 주문 불가가 있으면 도메인이 throw — 부분 진행 금지(설계 D6)
    const draft = buildOrderDraft(selectedLines.map(toDraftLine), shippingPolicy);

    const orderNo = await allocateOrderNo(tx);
    const guestToken = input.customerId === null ? randomUUID() : null;
    const actorText = serializeActor(
      input.customerId === null
        ? { role: "system" }
        : { role: "customer", id: input.customerId },
    );

    const [orderRow] = await tx
      .insert(orders)
      .values({
        orderNo,
        customerId: input.customerId,
        guestToken,
        status: "pending",
        channel: "web",
        ordererName: input.orderer.name,
        // 정규화(숫자만) 저장 — 비회원 주문조회가 이 값으로 대조한다(domain/phone)
        ordererPhone: normalizePhone(input.orderer.phone),
        ordererEmail: input.orderer.email ?? null,
        recipient: input.shippingAddress.recipient,
        phone: normalizePhone(input.shippingAddress.phone),
        zipcode: input.shippingAddress.zipcode,
        addr1: input.shippingAddress.addr1,
        addr2: input.shippingAddress.addr2 ?? null,
        deliveryMemo: input.shippingAddress.deliveryMemo ?? null,
        subtotal: draft.subtotal,
        shippingFee: draft.shippingFee,
        couponDiscount: draft.couponDiscount,
        pointUsed: draft.pointUsed,
        grandTotal: draft.grandTotal,
      })
      .returning({ id: orders.id });

    // 품목·추가상품 스냅샷 — 상품이 바뀌거나 삭제돼도 주문은 불변(RULE-11)
    for (const item of draft.items) {
      const [itemRow] = await tx
        .insert(orderItem)
        .values({
          orderId: orderRow.id,
          variantId: item.variantId,
          productId: item.productId,
          productName: item.productName,
          makerName: item.makerName,
          variantName: item.variantName,
          listPrice: item.listPrice,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
          thumbnailPath: item.thumbnailPath,
          thumbnailAlt: item.thumbnailAlt,
        })
        .returning({ id: orderItem.id });

      if (item.addons.length > 0) {
        await tx.insert(orderItemAddon).values(
          item.addons.map((addon) => ({
            orderItemId: itemRow.id,
            addonId: addon.addonId,
            addonName: addon.addonName,
            unitPrice: addon.unitPrice,
            quantity: addon.quantity,
            lineTotal: addon.lineTotal,
          })),
        );
      }
    }

    // 결제 대기 행 — 승인 시 confirmPayment가 paid로 전이시킨다
    await tx.insert(payment).values({
      orderId: orderRow.id,
      provider: "tosspayments",
      amount: draft.grandTotal,
      status: "ready",
    });

    // 약관 동의 증빙 — 필수 문서 누락이면 여기서 throw되어 주문 전체가 롤백된다
    await recordTermsAgreements(tx, {
      orderId: orderRow.id,
      customerId: input.customerId,
      agreedDocumentIds: input.agreedTermsDocumentIds,
      ip: input.agreementIp,
    });

    // 생성 이력(null→pending)은 초크포인트를 거치지 않고 직접 남긴다 —
    // applyOrderTransition은 '기존 상태에서의 변경'을 다루므로 최초 진입은 여기서 기록한다
    await tx.insert(orderStatusHistory).values({
      orderId: orderRow.id,
      fromStatus: null,
      toStatus: "pending",
      actor: actorText,
      memo: "주문 생성",
    });

    return {
      orderId: orderRow.id,
      orderNo,
      guestToken,
      grandTotal: draft.grandTotal,
    };
  });
}
