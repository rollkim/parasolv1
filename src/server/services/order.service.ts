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
import { checkPointUse } from "@/domain/point";

import { getCartWithItems, type CartLine } from "./cart.service";
import {
  calcCouponScopeTarget,
  CouponUseRejectedError,
  loadCouponIssueForOrder,
  resolveCouponDiscount,
  useCouponForOrder,
} from "./coupon.service";
import { rememberOrderAddress } from "./customer.service";
import type { DatabaseClient, TransactionClient } from "./db-client";
import { getUsablePointBalance, usePoints } from "./point.service";
import { loadPointPolicy } from "./point-policy.service";
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
  /**
   * 사용할 적립금. 회원만 쓸 수 있다(비회원은 귀속할 잔액이 없다).
   * 값은 서버가 정책·잔액으로 다시 검증한다 — 화면이 계산한 최대치를 믿지 않는다.
   */
  pointToUse?: number;
  /**
   * 사용할 쿠폰 발급건. 회원만 쓸 수 있다(쿠폰은 회원에게 발급된다).
   * **할인액은 화면이 아니라 서버가 계산한다** — 화면이 보낸 금액을 믿으면
   * 5천원 쿠폰으로 5만원을 깎을 수 있다.
   */
  couponIssueId?: number;
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

/** 정책·잔액 위반 — 문구는 도메인(checkPointUse)이 만든 것을 그대로 전달한다 */
export class PointUseRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointUseRejectedError";
  }
}

export class GuestCouponUseError extends Error {
  constructor() {
    super("쿠폰은 로그인 후 사용할 수 있어요.");
    this.name = "GuestCouponUseError";
  }
}

export class GuestPointUseError extends Error {
  constructor() {
    super("적립금은 로그인 후 사용할 수 있어요.");
    this.name = "GuestPointUseError";
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
  const created = await createPendingOrderInTransaction(database, input);

  // 회원이면 이 배송지를 주소록에 남긴다 — 가입 때 주소를 받지 않으므로 첫 주문이 유일한 계기다.
  // **주문 트랜잭션 밖**에서, 실패해도 삼킨다: 주소록 사정 때문에 이미 만들어진 주문이
  // 되돌아가면 안 된다(고객은 결제 직전인데 "주소를 저장하지 못했다"로 막히는 셈).
  if (input.customerId !== null) {
    try {
      await rememberOrderAddress(database, {
        customerId: input.customerId,
        recipient: input.shippingAddress.recipient,
        phone: input.shippingAddress.phone,
        zipcode: input.shippingAddress.zipcode,
        addr1: input.shippingAddress.addr1,
        addr2: input.shippingAddress.addr2 ?? null,
      });
    } catch {
      // 저장 실패는 주문에 영향을 주지 않는다 — 고객은 마이페이지에서 직접 추가할 수 있다
    }
  }

  return created;
}

async function createPendingOrderInTransaction(
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
    // 배송지 우편번호를 함께 넘긴다 — 도서·산간 추가비가 여기서 확정된다.
    // 체크아웃 화면도 같은 도메인 함수로 계산하므로 보인 금액과 결제액이 갈리지 않는다.
    // ① 적립금을 빼기 전 금액을 먼저 구한다 — "얼마까지 쓸 수 있나"의 기준이 이 값이다.
    //    순수 계산이라 두 번 불러도 비용이 없다.
    const draftLines = selectedLines.map(toDraftLine);
    const draftBeforeDiscount = buildOrderDraft(draftLines, shippingPolicy, {
      shippingZipcode: input.shippingAddress.zipcode,
    });

    /* ② 쿠폰 검증 — 화면이 보낸 쿠폰을 기간·범위·최소금액으로 다시 판정한다.
          할인액도 여기서 계산한다: 화면이 보낸 금액을 믿으면 5천원 쿠폰으로 5만원을 깎을 수 있다.
          비회원은 대상이 아니다 — 쿠폰은 회원에게 발급된다. */
    if (input.couponIssueId !== undefined && input.customerId === null) {
      throw new GuestCouponUseError();
    }
    let couponDiscount = 0;
    if (input.couponIssueId !== undefined && input.customerId !== null) {
      const issueForOrder = await loadCouponIssueForOrder(tx, {
        couponIssueId: input.couponIssueId,
        customerId: input.customerId,
      });
      const scopeTarget = await calcCouponScopeTarget(tx, {
        scopeKind: issueForOrder.scopeKind,
        scopeRefId: issueForOrder.scopeRefId,
        lines: draftBeforeDiscount.items.map((item) => ({
          productId: item.productId,
          lineTotal: item.lineTotal,
        })),
      });
      const resolved = resolveCouponDiscount({ issueForOrder, scopeTarget });
      if (!resolved.usable) throw new CouponUseRejectedError(resolved.message);
      couponDiscount = resolved.discountAmount;
    }

    // 적립금 상한의 기준은 **쿠폰을 뺀 뒤** 결제 금액이다. 쿠폰 전 금액을 기준으로 하면
    // 쿠폰과 적립금을 합쳐 결제액을 음수로 만들 수 있다
    const draftAfterCoupon =
      couponDiscount === 0
        ? draftBeforeDiscount
        : buildOrderDraft(draftLines, shippingPolicy, {
            shippingZipcode: input.shippingAddress.zipcode,
            couponDiscount,
          });

    // ③ 적립금 사용 검증 — 화면이 보낸 값을 정책·잔액으로 다시 판정한다(RULE-11 금액 무결성).
    //    비회원은 아예 대상이 아니다: 잔액이 귀속될 회원이 없는데 금액만 깎이면 그대로 손실이다.
    const requestedPoint = Math.max(0, Math.trunc(input.pointToUse ?? 0));
    if (requestedPoint > 0 && input.customerId === null) {
      throw new GuestPointUseError();
    }
    let pointToUse = 0;
    if (requestedPoint > 0 && input.customerId !== null) {
      const pointPolicy = await loadPointPolicy(tx);
      // 캐시 잔액이 아니라 **쓸 수 있는 금액**으로 판정한다 — 캐시에는 만료분이 섞여 있어
      // 그걸로 통과시키면 아래 usePoints에서 뒤늦게 막힌다(고객은 이유를 알 수 없다)
      const balance = await getUsablePointBalance(tx, input.customerId);
      const useCheck = checkPointUse(
        requestedPoint,
        balance,
        draftAfterCoupon.grandTotal,
        pointPolicy,
      );
      if (!useCheck.usable) throw new PointUseRejectedError(useCheck.message);
      pointToUse = requestedPoint;
    }

    const draft =
      pointToUse === 0
        ? draftAfterCoupon
        : buildOrderDraft(draftLines, shippingPolicy, {
            shippingZipcode: input.shippingAddress.zipcode,
            couponDiscount,
            pointUsed: pointToUse,
          });

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

    // 적립금 차감 — 주문 행이 생긴 뒤라야 원장이 어느 주문에 쓴 건지 가리킬 수 있다.
    // 검증 시점과 여기 사이에 다른 주문이 잔액을 써버렸으면 조건부 UPDATE가 0행이 되어
    // 던지고, 주문 전체가 롤백된다 — 잔액 없이 할인만 받은 주문이 남지 않는다.
    // 쿠폰 사용 처리 — 주문이 롤백되면 쿠폰도 미사용으로 돌아간다(같은 트랜잭션)
    if (input.couponIssueId !== undefined && input.customerId !== null && couponDiscount > 0) {
      await useCouponForOrder(tx, {
        couponIssueId: input.couponIssueId,
        customerId: input.customerId,
        orderId: orderRow.id,
        discountAmount: couponDiscount,
      });
    }

    if (pointToUse > 0 && input.customerId !== null) {
      await usePoints(tx, {
        customerId: input.customerId,
        amount: pointToUse,
        title: `주문 사용 (${orderNo})`,
        orderId: orderRow.id,
      });
    }

    // 결제 대기 행 — 승인 시 confirmPayment가 paid로 전이시킨다.
    // amount는 적립금을 뺀 실제 청구액이다(토스에 넘기는 금액과 같아야 한다)
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
