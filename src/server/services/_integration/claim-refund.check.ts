/**
 * 클레임 C4 검증 — 환불 실행(채널 3종)과 잔액 불변식을 실제 DB에서 확인한다.
 * 실행: npm run check:claim4   (SSH 터널 켠 상태)
 *
 * 이 스크립트의 존재 이유: 설계 D10("PG API가 막혀도 클레임이 멈추지 않는다")이 코드로
 * 지켜지는지, 그리고 채널이 달라도 **종결 결과가 동일한지**는 실측해야 알 수 있다.
 *
 * 시나리오: [1]취소 환불(pg_api) — 전액·재고복원·주문취소 [2]반품 부분환불 — 배송비 차감·수취완료
 *           [3]수동 채널(pg_console) — 게이트웨이 미호출·결과 동일 [4]잔액 초과 차단
 *           [5]참조 누락 차단 [6]교환·잘못된 단계 차단
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  claim,
  inventoryLog,
  orderItem,
  orders,
  payment,
  paymentCancellation,
  productVariant,
} from "@/db/schema";
import { ManualRefundReferenceRequiredError } from "@/domain/claim";
import { createStubPaymentGateway } from "../../payments/stub-payment-gateway";

import {
  ClaimNotRefundableError,
  ClaimRefundExceedsBalanceError,
  refundClaim,
} from "../claim-refund.service";
import { markCollected, approveClaim } from "../claim-process.service";
import { requestClaim } from "../claim.service";
import { confirmPayment } from "../payment.service";
import { createPendingOrder } from "../order.service";
import { applyOrderTransition } from "../order-status.service";
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

const ADMIN = { role: "admin" as const, id: 1 };
const ORDERER = { name: "C4테스터", phone: "010-9999-0000", email: "c4@example.com" };
const ADDRESS = {
  recipient: "C4테스터",
  phone: "010-9999-0000",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
};

type Leftovers = { orderIds: number[]; cartIds: number[]; refIds: string[] };

async function readStock(variantId: number): Promise<number> {
  const [row] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return row.stock;
}

/**
 * **결제까지 완료된** 주문 — 클레임 환불은 실제 결제 건이 있어야 한다.
 * 결제 승인 시 재고가 차감되므로, 복원 검증의 기준선이 여기서 만들어진다.
 */
async function setupPaidOrder(variantId: number, quantity: number, leftovers: Leftovers) {
  const cartToken = `C4-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  leftovers.refIds.push(created.orderNo);

  const { gateway } = createStubPaymentGateway();
  await confirmPayment(db, gateway, {
    orderNo: created.orderNo,
    paymentKey: `STUB-${randomUUID()}`,
    amount: created.grandTotal,
    cartToken,
  });
  return created;
}

async function advanceToDelivered(orderId: number) {
  for (const status of ["preparing", "shipping", "delivered"] as const) {
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId,
        toStatus: status,
        actor: ADMIN,
        memo: "C4 준비",
      }),
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

/** ① 취소 환불(pg_api) — 전액 환불·재고 복원·주문 취소가 한 트랜잭션에서 */
async function checkCancelRefund(variantId: number, leftovers: Leftovers) {
  console.log("\n[1] 취소 환불(pg_api) — 전액·재고복원·주문취소 기대");
  const created = await setupPaidOrder(variantId, 2, leftovers);
  const stockAfterPayment = await readStock(variantId);

  const claimResult = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "cancel",
    reasonCode: "change_mind",
    customerId: null,
    guestToken: created.guestToken,
  });
  leftovers.refIds.push(claimResult.claimNo);

  const { gateway, calls } = createStubPaymentGateway();
  const refund = await refundClaim(db, gateway, { claimId: claimResult.claimId, actor: ADMIN });

  check(
    refund.refundedAmount === created.grandTotal,
    `전액 환불 (${refund.refundedAmount} / 결제 ${created.grandTotal})`,
  );
  check(refund.remainingBalance === 0, "환불 후 잔액 0");
  check(refund.orderCancelled, "주문 취소 전이");

  const cancelCalls = calls.filter((call) => call.kind === "cancel");
  check(cancelCalls.length === 1, "게이트웨이 취소 1회 호출", calls);

  const stockAfterRefund = await readStock(variantId);
  check(
    stockAfterRefund === stockAfterPayment + 2,
    `재고 복원 (${stockAfterPayment} → ${stockAfterRefund})`,
  );

  const [orderRow] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  check(orderRow.status === "cancelled", "주문 상태 cancelled");

  const [payRow] = await db
    .select({ status: payment.status })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(payRow.status === "cancelled", "전액 환불이므로 결제 cancelled", payRow);

  const ledger = await db
    .select({ amount: paymentCancellation.amount, channel: paymentCancellation.refundChannel })
    .from(paymentCancellation)
    .innerJoin(payment, eq(paymentCancellation.paymentId, payment.id))
    .where(eq(payment.orderId, created.orderId));
  check(
    ledger.length === 1 && ledger[0].channel === "pg_api",
    "환불 원장 1건 · 채널 pg_api",
    ledger,
  );

  const [claimRow] = await db
    .select({ status: claim.status })
    .from(claim)
    .where(eq(claim.id, claimResult.claimId));
  check(claimRow.status === "done", "클레임 종결");
}

/** ② 반품 부분 환불 — 배송비 차감분이 곧 수취 완료 */
async function checkPartialReturnRefund(variantId: number, leftovers: Leftovers) {
  console.log("\n[2] 반품 부분 환불 — 배송비 차감·부분취소 상태 기대");
  const created = await setupPaidOrder(variantId, 3, leftovers);
  await advanceToDelivered(created.orderId);
  const orderItemId = await firstOrderItemId(created.orderId);
  const stockBefore = await readStock(variantId);

  const claimResult = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "return",
    reasonCode: "change_mind", // 구매자 귀책 → 배송비 3,000 차감
    targets: [{ orderItemId, quantity: 1 }],
    customerId: null,
    guestToken: created.guestToken,
  });
  leftovers.refIds.push(claimResult.claimNo);

  await approveClaim(db, { claimId: claimResult.claimId, actor: ADMIN });
  await markCollected(db, { claimId: claimResult.claimId, actor: ADMIN });

  const { gateway } = createStubPaymentGateway();
  const refund = await refundClaim(db, gateway, {
    claimId: claimResult.claimId,
    actor: ADMIN,
    restockable: true,
  });

  check(
    refund.refundedAmount === claimResult.refundAmount,
    `환불액 = 접수 시 확정액 (${refund.refundedAmount})`,
  );
  check(refund.remainingBalance > 0, `부분 환불이라 잔액 남음 (${refund.remainingBalance})`);
  check(!refund.orderCancelled, "부분 반품은 주문을 취소하지 않는다");

  const [orderRow] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  check(orderRow.status === "delivered", "주문 상태 유지(delivered)", orderRow);

  const [payRow] = await db
    .select({ status: payment.status })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(payRow.status === "partial_cancelled", "결제 partial_cancelled", payRow);

  const [claimRow] = await db
    .select({ feeSettledAt: claim.feeSettledAt, shippingFee: claim.shippingFee })
    .from(claim)
    .where(eq(claim.id, claimResult.claimId));
  check(
    claimRow.shippingFee === 3000 && claimRow.feeSettledAt !== null,
    "배송비 차감 = 수취 완료 기록",
    claimRow,
  );

  check((await readStock(variantId)) === stockBefore + 1, "재입고 1개");
  return { created, orderItemId };
}

/** ③ 수동 채널(pg_console) — 게이트웨이를 부르지 않지만 결과는 같다 */
async function checkManualRefund(variantId: number, leftovers: Leftovers) {
  console.log("\n[3] 수동 채널(pg_console) — 게이트웨이 미호출·결과 동일 기대");
  const created = await setupPaidOrder(variantId, 1, leftovers);
  const claimResult = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "cancel",
    reasonCode: "change_mind",
    customerId: null,
    guestToken: created.guestToken,
  });
  leftovers.refIds.push(claimResult.claimNo);

  const { gateway, calls } = createStubPaymentGateway();
  const refund = await refundClaim(db, gateway, {
    claimId: claimResult.claimId,
    actor: ADMIN,
    refundChannel: "pg_console",
    refundReference: "toss-console-cancel-98765",
  });

  check(calls.length === 0, "게이트웨이 호출 0회 — 관리자가 외부에서 이미 환불", calls);
  check(refund.refundChannel === "pg_console", "채널 기록");
  check(refund.orderCancelled, "주문 취소 — 자동 경로와 동일");

  const ledger = await db
    .select({
      channel: paymentCancellation.refundChannel,
      raw: paymentCancellation.raw,
    })
    .from(paymentCancellation)
    .innerJoin(payment, eq(paymentCancellation.paymentId, payment.id))
    .where(eq(payment.orderId, created.orderId));
  check(ledger.length === 1 && ledger[0].channel === "pg_console", "원장에 수동 채널 기록", ledger);
  check(
    JSON.stringify(ledger[0]?.raw ?? {}).includes("toss-console-cancel-98765"),
    "참조 정보가 원장에 남는다(감사 근거)",
  );

  const [claimRow] = await db
    .select({ status: claim.status })
    .from(claim)
    .where(eq(claim.id, claimResult.claimId));
  check(claimRow.status === "done", "클레임 종결 — 자동 경로와 동일");
}

/** ④⑤⑥ 방어 — 잔액 초과·참조 누락·유형/단계 */
async function checkGuards(
  variantId: number,
  returnCase: { created: { orderNo: string; orderId: number; guestToken: string | null } ; orderItemId: number },
  leftovers: Leftovers,
) {
  console.log("\n[4] 잔액 초과 — 이미 환불한 금액 재환불 차단 기대");
  // [2]에서 부분 환불한 주문에 남은 2개를 반품 신청 후, 잔액을 넘는 상황을 만든다
  const secondClaim = await requestClaim(db, {
    orderNo: returnCase.created.orderNo,
    claimType: "return",
    reasonCode: "damaged", // 판매자 귀책 → 배송비 0
    targets: [{ orderItemId: returnCase.orderItemId, quantity: 2 }],
    customerId: null,
    guestToken: returnCase.created.guestToken,
  });
  leftovers.refIds.push(secondClaim.claimNo);
  await approveClaim(db, { claimId: secondClaim.claimId, actor: ADMIN });
  await markCollected(db, { claimId: secondClaim.claimId, actor: ADMIN });

  // ★ 같은 결제에 대한 2회차 부분 환불이 되는지 먼저 확인한다 —
  //   1회차가 payment.status를 partial_cancelled로 바꾸므로 조회 조건이 좁으면 여기서 막힌다
  const { gateway: secondGateway } = createStubPaymentGateway();
  const secondRefund = await refundClaim(db, secondGateway, {
    claimId: secondClaim.claimId,
    actor: ADMIN,
    restockable: true,
  });
  check(
    secondRefund.refundedAmount === secondClaim.refundAmount,
    `2회차 부분 환불 성공 (${secondRefund.refundedAmount}) — 부분 환불은 여러 번 가능해야 한다`,
  );

  const [payAfterSecond] = await db
    .select({ status: payment.status })
    .from(payment)
    .where(eq(payment.orderId, returnCase.created.orderId));
  check(
    payAfterSecond.status === "cancelled" || payAfterSecond.status === "partial_cancelled",
    `2회차 후 결제 상태 (${payAfterSecond.status})`,
  );

  // 잔액 초과는 별도 주문으로 — 원장에 큰 금액을 넣어 잔액을 소진시킨다
  const exhausted = await setupPaidOrder(variantId, 1, leftovers);
  await advanceToDelivered(exhausted.orderId);
  const exhaustedItemId = await firstOrderItemId(exhausted.orderId);
  const exhaustedClaim = await requestClaim(db, {
    orderNo: exhausted.orderNo,
    claimType: "return",
    reasonCode: "damaged",
    targets: [{ orderItemId: exhaustedItemId, quantity: 1 }],
    customerId: null,
    guestToken: exhausted.guestToken,
  });
  leftovers.refIds.push(exhaustedClaim.claimNo);
  await approveClaim(db, { claimId: exhaustedClaim.claimId, actor: ADMIN });
  await markCollected(db, { claimId: exhaustedClaim.claimId, actor: ADMIN });

  const [payRow] = await db
    .select({ id: payment.id })
    .from(payment)
    .where(eq(payment.orderId, exhausted.orderId));
  await db.insert(paymentCancellation).values({
    paymentId: payRow.id,
    amount: 999999,
    refundChannel: "bank_transfer",
    reason: "검증용 잔액 소진",
    createdBy: "system",
  });

  const { gateway } = createStubPaymentGateway();
  let exceeded = false;
  try {
    await refundClaim(db, gateway, { claimId: exhaustedClaim.claimId, actor: ADMIN });
  } catch (error) {
    exceeded = error instanceof ClaimRefundExceedsBalanceError;
  }
  check(exceeded, "잔액 초과 환불 차단 — 채널 무관 원장 합산");

  console.log("\n[5] 수동 채널 참조 누락 — 차단 기대");
  let referenceRequired = false;
  try {
    await refundClaim(db, gateway, {
      claimId: exhaustedClaim.claimId,
      actor: ADMIN,
      refundChannel: "bank_transfer",
      refundReference: "   ",
    });
  } catch (error) {
    referenceRequired = error instanceof ManualRefundReferenceRequiredError;
  }
  check(referenceRequired, "참조 없는 수동 환불 차단");

  console.log("\n[6] 유형·단계 가드 — 교환/잘못된 단계 차단 기대");
  const exchangeOrder = await setupPaidOrder(variantId, 1, leftovers);
  await advanceToDelivered(exchangeOrder.orderId);
  const exchangeItemId = await firstOrderItemId(exchangeOrder.orderId);
  const exchangeClaim = await requestClaim(db, {
    orderNo: exchangeOrder.orderNo,
    claimType: "exchange",
    reasonCode: "damaged",
    targets: [{ orderItemId: exchangeItemId, quantity: 1 }],
    customerId: null,
    guestToken: exchangeOrder.guestToken,
  });
  leftovers.refIds.push(exchangeClaim.claimNo);

  let exchangeBlocked = false;
  try {
    await refundClaim(db, gateway, { claimId: exchangeClaim.claimId, actor: ADMIN });
  } catch (error) {
    exchangeBlocked = error instanceof ClaimNotRefundableError;
  }
  check(exchangeBlocked, "교환은 환불 대상 아님");

  // 반품인데 검수 전(requested)이면 환불 불가
  const earlyOrder = await setupPaidOrder(variantId, 1, leftovers);
  await advanceToDelivered(earlyOrder.orderId);
  const earlyItemId = await firstOrderItemId(earlyOrder.orderId);
  const earlyClaim = await requestClaim(db, {
    orderNo: earlyOrder.orderNo,
    claimType: "return",
    reasonCode: "damaged",
    targets: [{ orderItemId: earlyItemId, quantity: 1 }],
    customerId: null,
    guestToken: earlyOrder.guestToken,
  });
  leftovers.refIds.push(earlyClaim.claimNo);

  let stageBlocked = false;
  try {
    await refundClaim(db, gateway, { claimId: earlyClaim.claimId, actor: ADMIN });
  } catch (error) {
    stageBlocked = error instanceof ClaimNotRefundableError;
  }
  check(stageBlocked, "검수 전 반품 환불 차단 — 회수·검수를 건너뛸 수 없다");
}

async function main() {
  console.log("PaRaSOL 클레임 C4 검증 (임시 주문·클레임은 종료 시 삭제)");
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], refIds: [] };
  try {
    await checkCancelRefund(variant.id, leftovers);
    const returnCase = await checkPartialReturnRefund(variant.id, leftovers);
    await checkManualRefund(variant.id, leftovers);
    await checkGuards(variant.id, returnCase, leftovers);
  } finally {
    if (leftovers.refIds.length > 0) {
      await db.delete(inventoryLog).where(inArray(inventoryLog.refId, leftovers.refIds));
    }
    if (leftovers.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    await db
      .update(productVariant)
      .set({ stock: variant.stock })
      .where(eq(productVariant.id, variant.id));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
