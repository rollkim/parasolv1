/**
 * 클레임 환불 쿠폰·적립금 정산 검증 (C4).
 * 실행: npm run check:coupon-claim   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **카드로 나가는 돈이 결제수단별 몫과 정확히 맞는다.**
 *  - 취소: 환불액 = 실결제액. 쿠폰·적립금을 안 빼면 카드 결제액보다 큰 환불을 시도해
 *    잔액 불변식에 막힌다(이 검증이 없던 동안 잠복해 있던 결함).
 *  - 반품: 카드 환불 = 상품몫 − 쿠폰 차감 몫 − 적립금 복원 몫. 복원 몫을 안 빼면
 *    상품값을 카드로 다 주고 적립금도 복원해 이중 지급이다(역시 잠복 결함).
 *
 * 시나리오: [0]★coupon_deduction 컬럼 [1]취소 전액 정산 [2]반품 절반 비례 정산
 *           [3]나머지 반품 잔여 정리(합계 일치) [4]쿠폰·적립금 없는 주문 회귀
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  claim,
  coupon,
  couponIssue,
  customer,
  orderItem,
  orders,
  productVariant,
} from "@/db/schema";
import { calcExpiresAt } from "@/domain/point";

import { createStubPaymentGateway } from "../../payments/stub-payment-gateway";
import { requestClaim } from "../claim.service";
import { markCollected, approveClaim } from "../claim-process.service";
import { refundClaim } from "../claim-refund.service";
import { issueCouponToCustomer } from "../coupon.service";
import { applyOrderTransition, type TransitionActor } from "../order-status.service";
import { createPendingOrder } from "../order.service";
import { confirmPayment } from "../payment.service";
import { earnPoints, getPointBalance } from "../point.service";
import { loadPointPolicy } from "../point-policy.service";
import { getRequiredTermsDocumentIds } from "../terms.service";

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

const SUFFIX = randomUUID().slice(0, 8);
const ADMIN: TransitionActor = { role: "admin", id: 1 };
const COUPON_VALUE = 6000;
const POINT_TO_USE = 2000;

type Leftovers = { orderIds: number[]; cartIds: number[]; customerIds: number[]; couponIds: number[] };

async function main() {
  console.log("PaRaSOL 클레임 쿠폰·적립금 정산 검증 (임시 데이터는 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id, price: productVariant.price })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], customerIds: [], couponIds: [] };

  /** 쿠폰+적립금을 쓴 **결제 완료** 주문 — 정산 검증의 공통 출발점 */
  async function setupPaidOrderWithDiscounts(args: {
    customerId: number;
    couponIssueId?: number;
    pointToUse?: number;
  }) {
    const cartToken = `CPC-${randomUUID()}`;
    const [cartRow] = await db
      .insert(cart)
      .values({ sessionToken: cartToken, customerId: args.customerId })
      .returning({ id: cart.id });
    leftovers.cartIds.push(cartRow.id);
    await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: 2 });

    const created = await createPendingOrder(db, {
      cartToken,
      customerId: args.customerId,
      orderer: { name: `정산검증${SUFFIX}`, phone: "010-2323-4545", email: `cpc-${SUFFIX}@example.com` },
      shippingAddress: {
        recipient: `정산검증${SUFFIX}`,
        phone: "010-2323-4545",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        addr2: null,
      },
      agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
      agreementIp: "127.0.0.1",
      couponIssueId: args.couponIssueId,
      pointToUse: args.pointToUse,
    });
    leftovers.orderIds.push(created.orderId);

    const { gateway } = createStubPaymentGateway();
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: `STUB-${randomUUID()}`,
      amount: created.grandTotal,
      cartToken,
    });

    const [orderRow] = await db
      .select({
        subtotal: orders.subtotal,
        shippingFee: orders.shippingFee,
        couponDiscount: orders.couponDiscount,
        pointUsed: orders.pointUsed,
        grandTotal: orders.grandTotal,
      })
      .from(orders)
      .where(eq(orders.id, created.orderId));
    return { ...created, amounts: orderRow };
  }

  async function advanceToDelivered(orderId: number) {
    for (const nextStatus of ["preparing", "shipping", "delivered"] as const) {
      await db.transaction((tx) =>
        applyOrderTransition(tx, { orderId, toStatus: nextStatus, actor: ADMIN, memo: "C4 정산 검증" }),
      );
    }
  }

  async function firstOrderItemId(orderId: number): Promise<number> {
    const [row] = await db
      .select({ id: orderItem.id })
      .from(orderItem)
      .where(eq(orderItem.orderId, orderId));
    return row.id;
  }

  try {
    console.log("\n[0] ★coupon_deduction 컬럼이 실제로 있는가 (SQL 적용 확인)");
    await db.select({ probe: claim.couponDeduction }).from(claim).limit(1);
    check(true, "claim.coupon_deduction 조회 가능");

    const [buyer] = await db
      .insert(customer)
      .values({ name: `정산검증${SUFFIX}`, email: `cpc-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    leftovers.customerIds.push(buyer.id);

    const policy = await loadPointPolicy(db);
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: POINT_TO_USE,
        title: "검증용 사전 적립",
        tagCode: "manual",
        expiresAt: calcExpiresAt(new Date(), policy),
        dedupeKey: `check:${SUFFIX}:claim-seed`,
      }),
    );

    const [flatCoupon] = await db
      .insert(coupon)
      .values({
        name: `정산쿠폰${SUFFIX}`,
        type: "fixed",
        value: COUPON_VALUE,
        minOrderAmount: 0,
        scope: "all",
        issueMethod: "download",
        perCustomerLimit: 5,
        isActive: true,
      })
      .returning({ id: coupon.id });
    leftovers.couponIds.push(flatCoupon.id);
    const issued = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: flatCoupon.id, customerId: buyer.id }),
    );

    console.log("\n[1] 취소 — 환불액이 실결제액과 정확히 같다");
    const cancelOrder = await setupPaidOrderWithDiscounts({
      customerId: buyer.id,
      couponIssueId: issued.couponIssueId,
      pointToUse: POINT_TO_USE,
    });
    check(
      cancelOrder.amounts.couponDiscount === COUPON_VALUE &&
        cancelOrder.amounts.pointUsed === POINT_TO_USE,
      "쿠폰·적립금이 주문에 반영된 상태",
      cancelOrder.amounts,
    );

    const cancelClaim = await requestClaim(db, {
      orderNo: cancelOrder.orderNo,
      claimType: "cancel",
      reasonCode: "change_mind",
      customerId: buyer.id,
      guestToken: null,
    });
    check(
      cancelClaim.refundAmount === cancelOrder.amounts.grandTotal,
      `★취소 환불액 == 실결제액 (${cancelClaim.refundAmount}) — 쿠폰·적립금을 안 빼면 잔액 초과로 환불이 실패한다`,
      { refund: cancelClaim.refundAmount, paid: cancelOrder.amounts.grandTotal },
    );

    const balanceBeforeCancelRefund = await getPointBalance(db, buyer.id);
    const { gateway: cancelGateway } = createStubPaymentGateway();
    const cancelRefund = await refundClaim(db, cancelGateway, {
      claimId: cancelClaim.claimId,
      actor: ADMIN,
    });
    check(
      cancelRefund.refundedAmount === cancelOrder.amounts.grandTotal &&
        cancelRefund.remainingBalance === 0,
      "카드 환불 전액 + 잔액 0 — 예전 계산이면 여기서 ExceedsBalance로 죽었다",
      cancelRefund,
    );
    const [restoredIssue] = await db
      .select({ usedAt: couponIssue.usedAt })
      .from(couponIssue)
      .where(eq(couponIssue.id, issued.couponIssueId));
    check(restoredIssue.usedAt === null, "쿠폰이 복원됐다(초크포인트)");
    check(
      (await getPointBalance(db, buyer.id)) === balanceBeforeCancelRefund + POINT_TO_USE,
      "적립금도 전액 복원됐다(초크포인트)",
    );

    console.log("\n[2] 반품 절반 — 카드 환불 = 상품몫 − 쿠폰 몫 − 적립금 몫");
    // 취소가 되돌려 준 같은 쿠폰·적립금으로 새 주문 — 복원분이 실제로 재사용 가능한지도 함께 본다
    const returnOrder = await setupPaidOrderWithDiscounts({
      customerId: buyer.id,
      couponIssueId: issued.couponIssueId,
      pointToUse: POINT_TO_USE,
    });
    await advanceToDelivered(returnOrder.orderId);
    const orderItemId = await firstOrderItemId(returnOrder.orderId);

    const subtotal = returnOrder.amounts.subtotal;
    const halfGoods = subtotal / 2; // 같은 variant 2개 중 1개 — 정확히 절반
    const expectedCouponShare = Math.floor((COUPON_VALUE * halfGoods) / subtotal);
    const expectedPointShare = Math.floor((POINT_TO_USE * halfGoods) / subtotal);

    const firstReturn = await requestClaim(db, {
      orderNo: returnOrder.orderNo,
      claimType: "return",
      reasonCode: "damaged", // 판매자 귀책 — 클레임 배송비 0으로 상품몫만 남긴다
      targets: [{ orderItemId, quantity: 1 }],
      customerId: buyer.id,
      guestToken: null,
    });
    await approveClaim(db, { claimId: firstReturn.claimId, actor: ADMIN });
    await markCollected(db, { claimId: firstReturn.claimId, actor: ADMIN });

    const balanceBeforeFirstReturn = await getPointBalance(db, buyer.id);
    const { gateway: returnGateway } = createStubPaymentGateway();
    const firstRefund = await refundClaim(db, returnGateway, {
      claimId: firstReturn.claimId,
      actor: ADMIN,
      restockable: true,
    });

    check(
      firstRefund.refundedAmount === halfGoods - expectedCouponShare - expectedPointShare,
      `★카드 환불 ${firstRefund.refundedAmount} = 상품 ${halfGoods} − 쿠폰 ${expectedCouponShare} − 적립금 ${expectedPointShare}`,
      firstRefund,
    );
    check(
      firstRefund.couponDeducted === expectedCouponShare &&
        firstRefund.pointRestored === expectedPointShare,
      "정산 내역이 결과에 남는다 — 관리자가 '왜 스냅샷과 다른지' 답할 수 있다",
      firstRefund,
    );
    const [firstClaimRow] = await db
      .select({ couponDeduction: claim.couponDeduction })
      .from(claim)
      .where(eq(claim.id, firstReturn.claimId));
    check(
      firstClaimRow.couponDeduction === expectedCouponShare,
      "쿠폰 차감이 원장(claim.coupon_deduction)에 기록됐다",
    );
    check(
      (await getPointBalance(db, buyer.id)) === balanceBeforeFirstReturn + expectedPointShare,
      "적립금은 카드가 아니라 적립금으로 돌아왔다(이중 지급 없음)",
    );

    console.log("\n[3] 나머지 반품 — 잔여 정리로 합계가 정확히 맞는다");
    const secondReturn = await requestClaim(db, {
      orderNo: returnOrder.orderNo,
      claimType: "return",
      reasonCode: "damaged",
      targets: [{ orderItemId, quantity: 1 }],
      customerId: buyer.id,
      guestToken: null,
    });
    await approveClaim(db, { claimId: secondReturn.claimId, actor: ADMIN });
    await markCollected(db, { claimId: secondReturn.claimId, actor: ADMIN });
    const secondRefund = await refundClaim(db, returnGateway, {
      claimId: secondReturn.claimId,
      actor: ADMIN,
      restockable: true,
    });

    check(
      firstRefund.couponDeducted + secondRefund.couponDeducted === COUPON_VALUE,
      `나눠 반품해도 쿠폰 차감 합계 == 쿠폰 할인액 (${firstRefund.couponDeducted} + ${secondRefund.couponDeducted})`,
    );
    check(
      firstRefund.pointRestored + secondRefund.pointRestored === POINT_TO_USE,
      `적립금 복원 합계 == 사용액 (${firstRefund.pointRestored} + ${secondRefund.pointRestored})`,
    );
    check(
      firstRefund.refundedAmount + secondRefund.refundedAmount ===
        subtotal - COUPON_VALUE - POINT_TO_USE,
      "★카드 환불 합계 == 카드로 낸 상품값 — 전량 반품이 곧 상품분 전액 환불이다",
      {
        cards: firstRefund.refundedAmount + secondRefund.refundedAmount,
        paidGoods: subtotal - COUPON_VALUE - POINT_TO_USE,
      },
    );
    check(
      secondRefund.remainingBalance === returnOrder.amounts.shippingFee,
      "남은 결제 잔액 == 주문 배송비 — 반품은 원 배송비를 돌려주지 않는다",
      { remaining: secondRefund.remainingBalance, shipping: returnOrder.amounts.shippingFee },
    );

    console.log("\n[4] 쿠폰·적립금 없는 주문 — 기존 동작 그대로(회귀)");
    const [plainBuyer] = await db
      .insert(customer)
      .values({ name: `정산회귀${SUFFIX}`, email: `cpc2-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    leftovers.customerIds.push(plainBuyer.id);
    const plainOrder = await setupPaidOrderWithDiscounts({ customerId: plainBuyer.id });
    await advanceToDelivered(plainOrder.orderId);
    const plainItemId = await firstOrderItemId(plainOrder.orderId);
    const plainReturn = await requestClaim(db, {
      orderNo: plainOrder.orderNo,
      claimType: "return",
      reasonCode: "change_mind", // 구매자 귀책 — 배송비 차감까지 기존 그대로인지
      targets: [{ orderItemId: plainItemId, quantity: 1 }],
      customerId: plainBuyer.id,
      guestToken: null,
    });
    await approveClaim(db, { claimId: plainReturn.claimId, actor: ADMIN });
    await markCollected(db, { claimId: plainReturn.claimId, actor: ADMIN });
    const plainRefund = await refundClaim(db, returnGateway, {
      claimId: plainReturn.claimId,
      actor: ADMIN,
      restockable: true,
    });
    check(
      plainRefund.refundedAmount === plainReturn.refundAmount &&
        plainRefund.couponDeducted === 0 &&
        plainRefund.pointRestored === 0,
      "정산할 것이 없으면 접수 시 확정액 그대로 환불된다",
      plainRefund,
    );
  } finally {
    if (leftovers.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.couponIds.length > 0) {
      await db.delete(coupon).where(inArray(coupon.id, leftovers.couponIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    if (leftovers.customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, leftovers.customerIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
