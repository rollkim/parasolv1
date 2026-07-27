/**
 * Phase 4 검증 — 결제 confirm(스텁 게이트웨이) + 재고 차감 + 자동 보상을 실제 DB에서 확인한다.
 * 실행: npm run check:order4   (SSH 터널 켠 상태)
 *
 * 시나리오: [1]정상승인 [2]멱등 [3]금액위변조 [4]재고부족 보상(2타깃 롤백) [5]확정거절+재시도
 *           [6]보상실패 표식 [7]모호실패 키선점 유지 [8]승인 사이 취소 → 캡처 환불
 * 한계: 보상 ⓐ의 finalized_by_duplicate(동시 중복 confirm 경합)는 순차 스크립트로 재현
 *       불가 — 잠금 논리 검토로만 검증된 경로다.
 *
 * `tsx --conditions=react-server`로 도는 이유는 order-phase2.check.ts 주석 참조.
 * 전제: 활성 variant 2종 이상, 1번째 재고 ≥4 · 2번째 재고 ≥2 (시작 시 검사).
 * 검증 잔여물(주문·카트·재고 원장)은 끝나면 삭제하고 재고를 시작값으로 원복한다.
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  inventoryLog,
  orders,
  orderStatusHistory,
  payment,
  paymentCancellation,
  productVariant,
} from "@/db/schema";
import { OrderAmountMismatchError } from "@/domain/order";
import {
  PaymentGatewayError,
  PaymentRejectedError,
  type PaymentGateway,
} from "../../payments/payment-gateway";
import { createStubPaymentGateway } from "../../payments/stub-payment-gateway";

import { applyOrderTransition } from "../order-status.service";
import { createPendingOrder } from "../order.service";
import {
  confirmPayment,
  OrderNotPayableError,
  PaymentCompensationFailedError,
  PaymentStateConflictError,
  StockShortageCompensatedError,
} from "../payment.service";
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

const ORDERER = { name: "검증테스터", phone: "01000000000", email: "check@example.com" };
const ADDRESS = {
  recipient: "검증테스터",
  phone: "01000000000",
  zipcode: "04000",
  addr1: "서울 마포구 만리재로 1",
  addr2: "3층",
};

type VariantSnapshot = { id: number; price: number; stock: number };
type Leftovers = { orderIds: number[]; orderNos: string[]; cartIds: number[] };

/** 활성 variant 2종 + 시작 재고 스냅샷. 재고 전제 미달이면 즉시 중단(공허 통과 방지) */
async function pickVariants(): Promise<[VariantSnapshot, VariantSnapshot]> {
  const rows = await db
    .select({ id: productVariant.id, price: productVariant.price, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(2);
  if (rows.length < 2) throw new Error("활성 variant 2종 필요 — npm run db:seed:dev 먼저 실행");
  if (rows[0].stock < 4 || rows[1].stock < 2) {
    throw new Error(
      `재고 전제 미달 (v1=${rows[0].stock}<4 또는 v2=${rows[1].stock}<2) — 재고 보충 후 재실행`,
    );
  }
  return [rows[0], rows[1]];
}

/** 필수 약관 id — 서비스와 같은 규칙(코드별 최신 1건)을 써야 검증이 정직하다 */
const loadRequiredTermsIds = () => getRequiredTermsDocumentIds(db);

async function readStock(variantId: number): Promise<number> {
  const [row] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return row.stock;
}

/**
 * 시나리오 공통 준비 — 카트 생성 + pending 주문 생성.
 * 카트 id는 주문 생성 '전'에 leftovers에 등록한다 — 생성 도중 실패해도 정리가 닿도록.
 */
async function setupPendingOrder(
  lines: { variantId: number; quantity: number }[],
  leftovers: Leftovers,
) {
  const cartToken = `CHECK4-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db
    .insert(cartItem)
    .values(lines.map((line) => ({ cartId: cartRow.id, variantId: line.variantId, quantity: line.quantity })));

  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await loadRequiredTermsIds(),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  leftovers.orderNos.push(created.orderNo);
  return { cartToken, cartId: cartRow.id, created };
}

/** ①② 정상 승인 + 멱등 재도착 */
async function checkHappyPathAndIdempotency(
  v1: VariantSnapshot,
  v2: VariantSnapshot,
  leftovers: Leftovers,
) {
  console.log("\n[1] 정상 승인 — 재고 차감·paid 전이·카트 소비 기대");
  const stockBefore = await readStock(v1.id);
  const { cartToken, cartId, created } = await setupPendingOrder(
    [{ variantId: v1.id, quantity: 2 }],
    leftovers,
  );

  // 결제창이 떠 있는 사이 '다른 상품'을 담은 상황 — 이 라인은 소비되면 안 된다
  await db.insert(cartItem).values({ cartId, variantId: v2.id, quantity: 1 });

  const { gateway, calls } = createStubPaymentGateway();
  const paymentKey = `STUB-${randomUUID()}`;

  const confirmed = await confirmPayment(db, gateway, {
    orderNo: created.orderNo,
    paymentKey,
    amount: created.grandTotal,
    cartToken,
  });
  check(!confirmed.alreadyConfirmed, "최초 승인 alreadyConfirmed=false");

  const stockAfter = await readStock(v1.id);
  check(stockAfter === stockBefore - 2, `재고 차감 (${stockBefore} → ${stockAfter})`);

  const [orderAfter] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  check(orderAfter.status === "paid", "주문 paid 전이");

  const [payAfter] = await db
    .select({
      status: payment.status,
      paymentKey: payment.paymentKey,
      method: payment.method,
      approvedAt: payment.approvedAt,
    })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(
    payAfter.status === "paid" && payAfter.paymentKey === paymentKey && payAfter.approvedAt !== null,
    "결제행 paid + paymentKey·approvedAt 기록",
    payAfter,
  );

  const cartLinesAfter = await db
    .select({ variantId: cartItem.variantId })
    .from(cartItem)
    .where(eq(cartItem.cartId, cartId));
  check(
    cartLinesAfter.length === 1 && cartLinesAfter[0].variantId === v2.id,
    "카트 소비 — 주문 라인만 제거, 결제 중 담은 다른 상품 보존",
    cartLinesAfter,
  );

  const deductionLogs = await db
    .select({ delta: inventoryLog.delta, reason: inventoryLog.reason })
    .from(inventoryLog)
    .where(eq(inventoryLog.refId, created.orderNo));
  check(
    deductionLogs.length === 1 && deductionLogs[0].delta === -2 && deductionLogs[0].reason === "order",
    "재고 원장 기록 (delta -2, reason order)",
    deductionLogs,
  );

  const historyRows = await db
    .select({ to: orderStatusHistory.toStatus })
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, created.orderId));
  check(historyRows.length === 2, `이력 2건 (생성 + paid) — 실제 ${historyRows.length}`);

  check(
    calls.filter((c) => c.kind === "confirm").length === 1 &&
      calls.filter((c) => c.kind === "cancel").length === 0,
    "외부 호출: confirm 1회 · cancel 0회",
  );

  console.log("\n[2] 멱등 — 같은 승인 콜백 재도착 기대");
  const callCountBefore = calls.length;
  const again = await confirmPayment(db, gateway, {
    orderNo: created.orderNo,
    paymentKey,
    amount: created.grandTotal,
    cartToken,
  });
  check(again.alreadyConfirmed, "재도착 alreadyConfirmed=true");
  check(calls.length === callCountBefore, "토스 재호출 없음(사전검증 지름길)");
  check((await readStock(v1.id)) === stockAfter, "재고 추가 차감 없음");
  const historyAgain = await db
    .select({ id: orderStatusHistory.id })
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, created.orderId));
  check(historyAgain.length === 2, "이력 증가 없음");
}

/** ③ 금액 위변조 — 외부 호출 전 거절 */
async function checkAmountMismatch(v1: VariantSnapshot, leftovers: Leftovers) {
  console.log("\n[3] 금액 불일치 — 토스 호출 전 거절 기대");
  const stockBefore = await readStock(v1.id);
  const { cartToken, created } = await setupPendingOrder(
    [{ variantId: v1.id, quantity: 1 }],
    leftovers,
  );

  const { gateway, calls } = createStubPaymentGateway();
  let rejected = false;
  try {
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: `STUB-${randomUUID()}`,
      amount: created.grandTotal + 1000, // 위변조된 금액
      cartToken,
    });
  } catch (error) {
    rejected = error instanceof OrderAmountMismatchError;
  }
  check(rejected, "OrderAmountMismatchError 거절");
  check(calls.length === 0, "외부 호출 0회(승인 전 차단)");

  const [orderAfter] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  check(orderAfter.status === "pending", "주문 pending 유지(재시도 가능)");
  check((await readStock(v1.id)) === stockBefore, "재고 무변동");
}

/** ④ 재고 부족(2타깃 — 부분 차감 후 실패) — 승인 후 자동 보상(취소) */
async function checkShortageCompensation(
  v1: VariantSnapshot,
  v2: VariantSnapshot,
  leftovers: Leftovers,
) {
  console.log("\n[4] 재고 부족 — 부분 차감 롤백 + 승인 후 자동 취소(보상) 기대");
  const v1StockBefore = await readStock(v1.id);
  const v2StockBefore = await readStock(v2.id);
  // v1(선차감)은 충분, v2(후차감)를 부족하게 만들어 "일부는 성공한 뒤 실패"를 강제한다
  const { cartToken, cartId, created } = await setupPendingOrder(
    [
      { variantId: v1.id, quantity: 1 },
      { variantId: v2.id, quantity: 2 },
    ],
    leftovers,
  );

  // 결제창이 떠 있는 사이 다른 고객이 v2 재고를 쓸어간 상황 재현
  await db.update(productVariant).set({ stock: 1 }).where(eq(productVariant.id, v2.id));

  const { gateway, calls } = createStubPaymentGateway();
  const paymentKey = `STUB-${randomUUID()}`;
  let compensated = false;
  let shortageDetail: unknown;
  try {
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey,
      amount: created.grandTotal,
      cartToken,
    });
  } catch (error) {
    compensated = error instanceof StockShortageCompensatedError;
    if (compensated) shortageDetail = (error as StockShortageCompensatedError).failures;
  }
  check(compensated, "StockShortageCompensatedError", shortageDetail);
  check(
    calls.filter((c) => c.kind === "confirm").length === 1 &&
      calls.filter((c) => c.kind === "cancel").length === 1,
    "외부 호출: confirm 1회 + cancel 1회(돈 되돌림)",
    calls,
  );

  const [orderAfter] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  check(orderAfter.status === "cancelled", "주문 자동 취소(cancelled)");

  const [payAfter] = await db
    .select({ status: payment.status, paymentKey: payment.paymentKey })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(
    payAfter.status === "cancelled" && payAfter.paymentKey === paymentKey,
    "결제행 cancelled + paymentKey 기록",
    payAfter,
  );

  const cancellations = await db
    .select({ amount: paymentCancellation.amount, reason: paymentCancellation.reason })
    .from(paymentCancellation)
    .innerJoin(payment, eq(paymentCancellation.paymentId, payment.id))
    .where(eq(payment.orderId, created.orderId));
  check(
    cancellations.length === 1 && cancellations[0].amount === created.grandTotal,
    "취소 원장 1건 (전액)",
    cancellations,
  );

  // ★핵심: v1은 트랜잭션 안에서 실제로 차감됐다가 롤백됐다 — 부분 차감 잔여가 없어야 한다
  check(
    (await readStock(v1.id)) === v1StockBefore,
    `선차감 v1 롤백 (재고 ${v1StockBefore} 유지)`,
  );
  check((await readStock(v2.id)) === 1, "부족 v2 무변동 (재고 1 유지)");

  const shortageLogs = await db
    .select({ id: inventoryLog.id })
    .from(inventoryLog)
    .where(eq(inventoryLog.refId, created.orderNo));
  check(shortageLogs.length === 0, "재고 원장 잔여물 없음(v1 차감 로그까지 롤백)");

  const cartLinesAfter = await db
    .select({ id: cartItem.id })
    .from(cartItem)
    .where(eq(cartItem.cartId, cartId));
  check(cartLinesAfter.length === 2, "실패 시 카트 보존(재시도 가능)");

  // 다음 시나리오를 위해 v2 재고 원복
  await db.update(productVariant).set({ stock: v2StockBefore }).where(eq(productVariant.id, v2.id));
}

/** ⑤ 승인 거절 — 무변동 + 키 선점 해제 → 새 키 재시도 성공 */
async function checkGatewayRejectAndRetry(v1: VariantSnapshot, leftovers: Leftovers) {
  console.log("\n[5] 승인 거절 — 무변동·키 선점 해제·재시도 성공 기대");
  const stockBefore = await readStock(v1.id);
  const { cartToken, created } = await setupPendingOrder(
    [{ variantId: v1.id, quantity: 1 }],
    leftovers,
  );

  const { gateway } = createStubPaymentGateway();
  let gatewayRejected = false;
  try {
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: `FAIL-${randomUUID()}`, // 스텁 규약: 확정 거절
      amount: created.grandTotal,
      cartToken,
    });
  } catch (error) {
    gatewayRejected = error instanceof PaymentRejectedError;
  }
  check(gatewayRejected, "확정 거절(PaymentRejectedError) 전파");

  const [orderAfter] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  const [payAfter] = await db
    .select({ status: payment.status, paymentKey: payment.paymentKey })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(orderAfter.status === "pending", "주문 pending 유지");
  check(payAfter.status === "ready", "결제행 ready 유지");
  check(payAfter.paymentKey === null, "키 선점 해제(재시도 열림)", payAfter);
  check((await readStock(v1.id)) === stockBefore, "재고 무변동");

  // 고객이 새 결제수단으로 재시도 — 선점이 풀렸으니 성공해야 한다
  const retryKey = `STUB-${randomUUID()}`;
  const retried = await confirmPayment(db, gateway, {
    orderNo: created.orderNo,
    paymentKey: retryKey,
    amount: created.grandTotal,
    cartToken,
  });
  check(!retried.alreadyConfirmed, "새 키 재시도 승인 성공");
  check((await readStock(v1.id)) === stockBefore - 1, "재시도 재고 차감");
}

/** ⑥ 보상 실패(최악 경로) — 취소 실패 시 표식이 남아야 한다 */
async function checkCompensationFailure(
  v1: VariantSnapshot,
  v2: VariantSnapshot,
  leftovers: Leftovers,
) {
  console.log("\n[6] 보상 실패 — 수동 개입 오류 + 표식(주문 cancelled·결제 ready) 기대");
  const v1StockBefore = await readStock(v1.id);
  const v2StockBefore = await readStock(v2.id);
  const { cartToken, created } = await setupPendingOrder(
    [
      { variantId: v1.id, quantity: 1 },
      { variantId: v2.id, quantity: 2 },
    ],
    leftovers,
  );
  await db.update(productVariant).set({ stock: 1 }).where(eq(productVariant.id, v2.id));

  const { gateway } = createStubPaymentGateway();
  const paymentKey = `CANCELFAIL-${randomUUID()}`; // 스텁 규약: 승인은 성공, 취소가 실패
  let compensationFailed = false;
  try {
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey,
      amount: created.grandTotal,
      cartToken,
    });
  } catch (error) {
    compensationFailed = error instanceof PaymentCompensationFailedError;
  }
  check(compensationFailed, "PaymentCompensationFailedError(수동 개입 필요)");

  // "주문 cancelled + 결제 ready + 키 선점" = 스위퍼·CS가 찾는 미환불 표식
  const [orderAfter] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  const [payAfter] = await db
    .select({ status: payment.status, paymentKey: payment.paymentKey })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(orderAfter.status === "cancelled", "주문은 종결(cancelled) — 이후 출고 경로 차단");
  check(
    payAfter.status === "ready" && payAfter.paymentKey === paymentKey,
    "결제행 ready + 키 유지 = 미환불 표식",
    payAfter,
  );

  const cancellations = await db
    .select({ id: paymentCancellation.id })
    .from(paymentCancellation)
    .innerJoin(payment, eq(paymentCancellation.paymentId, payment.id))
    .where(eq(payment.orderId, created.orderId));
  check(cancellations.length === 0, "취소 원장 없음(환불 미완이므로)");

  check((await readStock(v1.id)) === v1StockBefore, "v1 재고 롤백 유지");

  await db.update(productVariant).set({ stock: v2StockBefore }).where(eq(productVariant.id, v2.id));
}

/** ⑦ 모호 실패(타임아웃) — 키 선점 유지 + 새 키 이중 캡처 차단 */
async function checkAmbiguousFailureKeepsClaim(v1: VariantSnapshot, leftovers: Leftovers) {
  console.log("\n[7] 모호 실패(타임아웃) — 키 선점 유지·새 키 차단 기대");
  const stockBefore = await readStock(v1.id);
  const { cartToken, created } = await setupPendingOrder(
    [{ variantId: v1.id, quantity: 1 }],
    leftovers,
  );

  const { gateway, calls } = createStubPaymentGateway();
  const timeoutKey = `TIMEOUT-${randomUUID()}`; // 스텁 규약: 캡처 여부 불명 실패
  let ambiguousFailure = false;
  try {
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: timeoutKey,
      amount: created.grandTotal,
      cartToken,
    });
  } catch (error) {
    ambiguousFailure =
      error instanceof PaymentGatewayError && !(error instanceof PaymentRejectedError);
  }
  check(ambiguousFailure, "모호 실패 전파(확정 거절 아님)");

  const [payAfter] = await db
    .select({ status: payment.status, paymentKey: payment.paymentKey })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(
    payAfter.status === "ready" && payAfter.paymentKey === timeoutKey,
    "키 선점 유지(캡처 가능성 표식 보존)",
    payAfter,
  );

  // 캡처됐을지 모르는 돈이 있는 상태 — 새 키는 토스 호출 전에 거절돼야 한다(이중 캡처 차단)
  const confirmCallsBefore = calls.filter((c) => c.kind === "confirm").length;
  let newKeyBlocked = false;
  try {
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: `STUB-${randomUUID()}`,
      amount: created.grandTotal,
      cartToken,
    });
  } catch (error) {
    newKeyBlocked = error instanceof PaymentStateConflictError;
  }
  check(newKeyBlocked, "새 키 선점 거절(PaymentStateConflictError)");
  check(
    calls.filter((c) => c.kind === "confirm").length === confirmCallsBefore,
    "새 키는 토스 호출 전 차단(캡처 0회)",
  );
  check((await readStock(v1.id)) === stockBefore, "재고 무변동");
}

/** ⑧ 승인 사이 주문 취소 — 캡처된 돈 환불(보상 경로) */
async function checkCancelledDuringConfirm(v1: VariantSnapshot, leftovers: Leftovers) {
  console.log("\n[8] 승인 사이 주문 취소 — 캡처 환불 기대");
  const stockBefore = await readStock(v1.id);
  const { cartToken, created } = await setupPendingOrder(
    [{ variantId: v1.id, quantity: 1 }],
    leftovers,
  );

  const { gateway, calls } = createStubPaymentGateway();
  // 게이트웨이 승인(캡처) '직후', 확정 트랜잭션이 잠금을 잡기 '전'에 고객이 다른 창에서
  // 주문을 취소한 상황을 결정적으로 재현한다 — confirm 훅에서 주문을 취소해 버린다
  const cancelDuringConfirm: PaymentGateway = {
    confirm: async (confirmInput) => {
      const approval = await gateway.confirm(confirmInput);
      await db.transaction((tx) =>
        applyOrderTransition(tx, {
          orderId: created.orderId,
          toStatus: "cancelled",
          actor: { role: "customer", id: 0 },
          memo: "고객 취소(검증 재현)",
        }),
      );
      return approval;
    },
    cancel: (cancelInput) => gateway.cancel(cancelInput),
  };

  const paymentKey = `STUB-${randomUUID()}`;
  let notPayable = false;
  try {
    await confirmPayment(db, cancelDuringConfirm, {
      orderNo: created.orderNo,
      paymentKey,
      amount: created.grandTotal,
      cartToken,
    });
  } catch (error) {
    notPayable = error instanceof OrderNotPayableError;
  }
  check(notPayable, "OrderNotPayableError(cancelled) 전파");
  check(
    calls.filter((c) => c.kind === "confirm").length === 1 &&
      calls.filter((c) => c.kind === "cancel").length === 1,
    "캡처된 돈 환불 실행(confirm 1 + cancel 1)",
    calls,
  );

  const [payAfter] = await db
    .select({ status: payment.status, paymentKey: payment.paymentKey })
    .from(payment)
    .where(eq(payment.orderId, created.orderId));
  check(
    payAfter.status === "cancelled" && payAfter.paymentKey === paymentKey,
    "결제행 cancelled + paymentKey 기록",
    payAfter,
  );

  const cancellations = await db
    .select({ amount: paymentCancellation.amount })
    .from(paymentCancellation)
    .innerJoin(payment, eq(paymentCancellation.paymentId, payment.id))
    .where(eq(payment.orderId, created.orderId));
  check(
    cancellations.length === 1 && cancellations[0].amount === created.grandTotal,
    "취소 원장 1건 (전액)",
    cancellations,
  );
  check((await readStock(v1.id)) === stockBefore, "재고 무변동(차감 전 차단)");
}

async function main() {
  console.log("PaRaSOL 주문 Phase 4 검증 (잔여물은 종료 시 삭제·재고 원복)");
  const [v1, v2] = await pickVariants();
  const leftovers: Leftovers = { orderIds: [], orderNos: [], cartIds: [] };

  try {
    await checkHappyPathAndIdempotency(v1, v2, leftovers);
    await checkAmountMismatch(v1, leftovers);
    await checkShortageCompensation(v1, v2, leftovers);
    await checkGatewayRejectAndRetry(v1, leftovers);
    await checkCompensationFailure(v1, v2, leftovers);
    await checkAmbiguousFailureKeepsClaim(v1, leftovers);
    await checkCancelledDuringConfirm(v1, leftovers);
  } finally {
    // 정리 단계는 각각 독립 실행 — 앞 단계가 실패해도 재고 원복까지 반드시 시도한다
    const cleanupSteps: [string, () => Promise<unknown>][] = [
      ["재고 원장", () => db.delete(inventoryLog).where(inArray(inventoryLog.refId, leftovers.orderNos))],
      ["주문(cascade)", () => db.delete(orders).where(inArray(orders.id, leftovers.orderIds))],
      ["카트", () => db.delete(cart).where(inArray(cart.id, leftovers.cartIds))],
      ["v1 재고 원복", () => db.update(productVariant).set({ stock: v1.stock }).where(eq(productVariant.id, v1.id))],
      ["v2 재고 원복", () => db.update(productVariant).set({ stock: v2.stock }).where(eq(productVariant.id, v2.id))],
    ];
    for (const [label, step] of cleanupSteps) {
      if (label === "재고 원장" && leftovers.orderNos.length === 0) continue;
      if (label === "주문(cascade)" && leftovers.orderIds.length === 0) continue;
      if (label === "카트" && leftovers.cartIds.length === 0) continue;
      try {
        await step();
      } catch (cleanupError) {
        console.error(`  ! 정리 실패(${label}):`, cleanupError);
      }
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
