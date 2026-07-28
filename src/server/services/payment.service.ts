import "server-only";

import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import {
  cart,
  cartItem,
  orderItem,
  orderItemAddon,
  orders,
  payment,
  paymentCancellation,
} from "@/db/schema";
import { planStockDeductions, type OrderLineForStock } from "@/domain/inventory";
import { assertPaidAmountMatches, type OrderStatus } from "@/domain/order";

import {
  PaymentRejectedError,
  type GatewayApproval,
  type GatewayCancelResult,
  type PaymentGateway,
} from "../payments/payment-gateway";
import type { DatabaseClient, TransactionClient } from "./db-client";
import {
  deductStock,
  StockShortageError,
  type StockFailure,
} from "./inventory.service";
import { applyOrderTransition, serializeActor } from "./order-status.service";

/**
 * 결제 승인 서비스 — 주문 도메인에서 가장 위험한 지점.
 *
 * 돈(토스)과 재고(우리 DB)는 한 트랜잭션으로 묶을 수 없다. 그래서 3단으로 나눈다:
 *   ① 사전검증 + 결제키 선점 — 금액 불일치·비승인 상태를 외부 호출 전에 거르고,
 *      payment.payment_key를 조건부 UPDATE로 선점해 "주문당 승인 시도 1키"를 강제한다.
 *      두 번째 키는 돈이 캡처되기 전에 거절된다 → 이중 청구 원천 차단.
 *   ② 토스 승인(외부) — 트랜잭션 밖. 안에서 부르면 커넥션·행 잠금을 외부 응답
 *      시간만큼 붙잡는다. 이 순간부터 "돈은 이미 넘어온 상태"다.
 *   ③ 확정 트랜잭션 — 재고 차감 + pending→paid + payment paid + 카트 소비.
 *
 * ③이 실패하면 보상(refundCapturedPayment)이 돈을 되돌린다. 보상 순서는
 * "주문 종결(잠금 하 커밋) → 토스 취소 → 결제 기록"이다 — 주문을 먼저 종결해야
 * 환불과 동시에 중복 confirm이 paid를 만드는 경합("토스는 환불했는데 DB는 출고")이
 * 원천적으로 불가능해진다. 토스 취소가 실패하면 '주문 cancelled + 결제 ready'라는
 * 비정상 조합이 DB에 표식으로 남아 스위퍼·CS가 발견한다 — 조용히 사라지는 돈이 없다.
 */

const STOCK_SHORTAGE_CANCEL_REASON = "재고 부족 자동 취소";
const CANCELLED_ORDER_REFUND_REASON = "취소된 주문 승인 환불";

export type ConfirmPaymentInput = {
  orderNo: string;
  paymentKey: string;
  /** successUrl로 돌아온 금액 — 서버 grand_total과 다르면 외부 호출 전에 거절(위변조 차단) */
  amount: number;
  /** 승인 성공 시 비울 장바구니 토큰 — 웹훅 경로처럼 알 수 없으면 null */
  cartToken?: string | null;
};

export type ConfirmPaymentResult = {
  orderId: number;
  orderNo: string;
  grandTotal: number;
  /** 중복 confirm(콜백 재도착)이 멱등 처리된 경우 true */
  alreadyConfirmed: boolean;
};

export class OrderNotFoundError extends Error {
  constructor(readonly orderNo: string) {
    super(`주문을 찾을 수 없습니다: ${orderNo}`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotPayableError extends Error {
  constructor(
    readonly orderNo: string,
    readonly orderStatus: OrderStatus,
  ) {
    super(`결제할 수 없는 주문 상태입니다: ${orderNo} (${orderStatus})`);
    this.name = "OrderNotPayableError";
  }
}

export class PaymentStateConflictError extends Error {
  constructor(readonly orderNo: string, conflictDetail: string) {
    super(`결제 상태 충돌: ${orderNo} — ${conflictDetail}`);
    this.name = "PaymentStateConflictError";
  }
}

/** 승인은 됐지만 재고 부족 → 전액 자동 취소(보상)까지 완료된 상태 — 고객 돈은 돌아갔다 */
export class StockShortageCompensatedError extends Error {
  constructor(readonly failures: StockFailure[]) {
    super("재고가 부족하여 결제가 자동 취소되었습니다. 장바구니를 확인해 주세요.");
    this.name = "StockShortageCompensatedError";
  }
}

/** ★수동 개입 필요 — 고객 돈은 넘어왔는데 취소(보상)까지 실패한 최악 상태 */
export class PaymentCompensationFailedError extends Error {
  constructor(
    readonly orderNo: string,
    readonly paymentKey: string,
    cause: unknown,
  ) {
    super(
      `결제 보상(취소) 실패 — 수동 확인 필요: 주문 ${orderNo}, paymentKey ${paymentKey}`,
      { cause },
    );
    this.name = "PaymentCompensationFailedError";
  }
}

/**
 * 결제 승인 진입점. 토스 successUrl 콜백·웹훅이 이 함수 하나로 들어온다.
 *
 * 멱등: 같은 paymentKey로 이미 승인된 주문이면 토스를 다시 부르지 않고
 * alreadyConfirmed:true를 돌려준다 — 콜백·웹훅 중복 도착이 정상 상황이기 때문이다.
 */
export async function confirmPayment(
  database: DatabaseClient,
  gateway: PaymentGateway,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  // ── ① 사전검증 — 외부(토스) 호출 전에 거를 수 있는 것은 전부 거른다
  const [orderRow] = await database
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(eq(orders.orderNo, input.orderNo))
    .limit(1);
  if (!orderRow) throw new OrderNotFoundError(input.orderNo);

  // 유효 결제행(실패 제외)은 payment_order_active_uq가 주문당 1건을 보장한다
  const [paymentRow] = await database
    .select({
      id: payment.id,
      status: payment.status,
      paymentKey: payment.paymentKey,
    })
    .from(payment)
    .where(and(eq(payment.orderId, orderRow.id), ne(payment.status, "failed")))
    .limit(1);
  if (!paymentRow) {
    throw new PaymentStateConflictError(orderRow.orderNo, "유효한 결제 대기 건이 없습니다");
  }

  if (orderRow.status !== "pending") {
    // 멱등 지름길: 같은 paymentKey로 이미 승인 완료 — 토스 재호출 없이 성공 반환
    if (
      orderRow.status === "paid" &&
      paymentRow.status === "paid" &&
      paymentRow.paymentKey === input.paymentKey
    ) {
      return {
        orderId: orderRow.id,
        orderNo: orderRow.orderNo,
        grandTotal: orderRow.grandTotal,
        alreadyConfirmed: true,
      };
    }
    throw new OrderNotPayableError(orderRow.orderNo, orderRow.status);
  }
  assertPaidAmountMatches(orderRow.grandTotal, input.amount);

  // 결제키 선점 — 조건부 UPDATE 한 문장이라 원자적이다. 이미 다른 키가 선점했다면
  // 여기서 거절되므로 두 번째 키는 토스 승인(캡처)까지 가지 못한다(이중 청구 차단).
  // 같은 키의 재선점은 허용 — 콜백 중복·크래시 후 재시도가 이 조건으로 복구된다.
  const claimedRows = await database
    .update(payment)
    .set({ paymentKey: input.paymentKey })
    .where(
      and(
        eq(payment.id, paymentRow.id),
        eq(payment.status, "ready"),
        or(isNull(payment.paymentKey), eq(payment.paymentKey, input.paymentKey)),
      ),
    )
    .returning({ id: payment.id });
  if (claimedRows.length === 0) {
    throw new PaymentStateConflictError(
      orderRow.orderNo,
      "다른 결제 시도가 진행 중인 주문입니다",
    );
  }

  // ── ② 토스 승인 — 이 순간부터 돈은 넘어온 상태. 이후 실패는 반드시 보상 대상
  let approval: GatewayApproval;
  try {
    approval = await gateway.confirm({
      paymentKey: input.paymentKey,
      orderNo: orderRow.orderNo,
      amount: orderRow.grandTotal,
    });
  } catch (confirmError) {
    // 선점 해제는 '확정 거절'(캡처 안 됨 확실)일 때만 한다. 타임아웃 같은 모호 실패는
    // 토스가 실제로 캡처했을 수 있다 — 그때 선점을 풀면 캡처 표식이 지워지고 새 키로
    // 이중 캡처가 열린다. 모호 실패의 선점 잔류는 스위퍼(Phase 6)가
    // "pending + ready + 키 선점" 조합을 토스와 대사해 해소한다.
    if (confirmError instanceof PaymentRejectedError) {
      try {
        await database
          .update(payment)
          .set({ paymentKey: null })
          .where(
            and(
              eq(payment.id, paymentRow.id),
              eq(payment.status, "ready"),
              eq(payment.paymentKey, input.paymentKey),
            ),
          );
      } catch {
        // 원인 오류(승인 거절)를 그대로 전달하는 것이 우선
      }
    }
    throw confirmError;
  }

  // ── ③ 확정 트랜잭션 — 실패 유형에 따라 보상한다
  try {
    return await database.transaction((tx) =>
      finalizeConfirmedPayment(tx, { orderRow, paymentRow, approval, input }),
    );
  } catch (finalizeError) {
    const refundContext = {
      orderId: orderRow.id,
      orderNo: orderRow.orderNo,
      paymentId: paymentRow.id,
      paymentKey: input.paymentKey,
      grandTotal: orderRow.grandTotal,
    };

    if (finalizeError instanceof StockShortageError) {
      const refundOutcome = await refundCapturedPayment(database, gateway, {
        ...refundContext,
        cancelReason: STOCK_SHORTAGE_CANCEL_REASON,
      });
      if (refundOutcome === "finalized_by_duplicate") {
        // 우리 롤백 직후 같은 키의 중복 confirm이 확정에 성공 — 캡처는 정당한 결제가 됐다
        return {
          orderId: orderRow.id,
          orderNo: orderRow.orderNo,
          grandTotal: orderRow.grandTotal,
          alreadyConfirmed: true,
        };
      }
      throw new StockShortageCompensatedError(finalizeError.failures);
    }

    // 승인(캡처) 사이에 주문이 취소돼 있던 경우 — 확정할 수 없으니 캡처된 돈을 환불한다
    if (
      finalizeError instanceof OrderNotPayableError &&
      finalizeError.orderStatus === "cancelled"
    ) {
      await refundCapturedPayment(database, gateway, {
        ...refundContext,
        cancelReason: CANCELLED_ORDER_REFUND_REASON,
      });
      throw finalizeError;
    }

    // 그 밖의 실패(일시적 DB 오류 등)는 자동 취소하지 않는다 — "pending + 키 선점" 상태로
    // 남아 스위퍼(Phase 6)가 paymentKey로 토스 상태를 대사해 재확정하거나 취소한다.
    throw finalizeError;
  }
}

async function finalizeConfirmedPayment(
  tx: TransactionClient,
  args: {
    orderRow: { id: number; orderNo: string; grandTotal: number };
    paymentRow: { id: number };
    approval: GatewayApproval;
    input: ConfirmPaymentInput;
  },
): Promise<ConfirmPaymentResult> {
  const { orderRow, paymentRow, approval, input } = args;

  // 주문 행 잠금 — 동시 중복 confirm을 직렬화한다. 후착은 아래 paid 분기에서 멱등 반환
  const [lockedOrder] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderRow.id))
    .for("update")
    .limit(1);
  if (!lockedOrder) throw new OrderNotFoundError(orderRow.orderNo);

  if (lockedOrder.status !== "pending") {
    if (lockedOrder.status === "paid") {
      const [paidRow] = await tx
        .select({ paymentKey: payment.paymentKey })
        .from(payment)
        .where(and(eq(payment.id, paymentRow.id), eq(payment.status, "paid")))
        .limit(1);
      if (paidRow?.paymentKey === input.paymentKey) {
        return {
          orderId: orderRow.id,
          orderNo: orderRow.orderNo,
          grandTotal: orderRow.grandTotal,
          alreadyConfirmed: true,
        };
      }
      // 키 선점이 있어 정상 경로로는 도달 불가 — 도달하면 데이터가 비정상이라는 뜻
      throw new PaymentStateConflictError(orderRow.orderNo, "다른 결제로 이미 승인된 주문입니다");
    }
    // cancelled 등 — 호출자(confirmPayment)의 catch가 캡처된 돈을 환불한다
    throw new OrderNotPayableError(orderRow.orderNo, lockedOrder.status);
  }

  // 차감 계획은 order_item(스냅샷)이 진실 — 카트는 그사이 바뀌었을 수 있다
  const itemRows = await tx
    .select({
      orderItemId: orderItem.id,
      variantId: orderItem.variantId,
      quantity: orderItem.quantity,
    })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderRow.id));

  const addonRows = await tx
    .select({
      orderItemId: orderItemAddon.orderItemId,
      addonId: orderItemAddon.addonId,
      quantity: orderItemAddon.quantity,
    })
    .from(orderItemAddon)
    .innerJoin(orderItem, eq(orderItemAddon.orderItemId, orderItem.id))
    .where(eq(orderItem.orderId, orderRow.id));

  // 주문~승인 사이 상품이 하드 삭제된 극단 케이스 — FK가 null이 되어 차감 대상이
  // 사라졌다. 유령 상품에 돈을 받을 수 없으니 재고 부족과 동일하게(자동 취소) 처리한다.
  // id 0 = 삭제되어 식별 불가.
  const vanishedTargets: StockFailure[] = [];
  const lines: OrderLineForStock[] = [];
  for (const item of itemRows) {
    if (item.variantId === null) {
      vanishedTargets.push({ kind: "variant", id: 0, requested: item.quantity, available: 0 });
      continue;
    }
    const lineAddons: { addonId: number; quantity: number }[] = [];
    for (const addonRow of addonRows) {
      if (addonRow.orderItemId !== item.orderItemId) continue;
      if (addonRow.addonId === null) {
        vanishedTargets.push({ kind: "addon", id: 0, requested: addonRow.quantity, available: 0 });
        continue;
      }
      lineAddons.push({ addonId: addonRow.addonId, quantity: addonRow.quantity });
    }
    lines.push({ variantId: item.variantId, quantity: item.quantity, addons: lineAddons });
  }
  if (vanishedTargets.length > 0) throw new StockShortageError(vanishedTargets);

  const deductionTargets = planStockDeductions(lines);
  await deductStock(tx, {
    targets: deductionTargets,
    refId: orderRow.orderNo,
    actor: serializeActor({ role: "system" }),
  });

  // 전이표(pending→paid)의 부작용 deduct_stock·consume_cart를 이 트랜잭션이 수행한다
  await applyOrderTransition(tx, {
    orderId: orderRow.id,
    toStatus: "paid",
    actor: { role: "system" },
    memo: "결제 승인",
  });

  // ready → paid. WHERE에 status='ready'를 두어 이상 상태(이미 취소된 결제 등) 덮어쓰기를 막는다
  const paidRows = await tx
    .update(payment)
    .set({
      status: "paid",
      paymentKey: input.paymentKey,
      method: approval.paymentMethodLabel,
      approvedAt: approval.approvedAt ?? new Date(),
      raw: approval.raw,
    })
    .where(and(eq(payment.id, paymentRow.id), eq(payment.status, "ready")))
    .returning({ id: payment.id });
  if (paidRows.length === 0) {
    throw new PaymentStateConflictError(
      orderRow.orderNo,
      "결제 대기 상태가 아니어서 승인 기록에 실패했습니다",
    );
  }

  await consumeCartLines(tx, input.cartToken ?? null, lines.map((line) => line.variantId));

  return {
    orderId: orderRow.id,
    orderNo: orderRow.orderNo,
    grandTotal: orderRow.grandTotal,
    alreadyConfirmed: false,
  };
}

/**
 * 주문에 들어간 variant의 카트 라인을 제거한다(최신 카트 기준 — findCartByToken 규약과 동일).
 * cart_item id를 주문에 스냅샷하지 않으므로 variant 단위로 지운다 — 결제 사이 같은
 * variant를 다른 조합·수량으로 다시 담은 라인도 함께 제거된다(다른 variant 라인은 보존).
 */
async function consumeCartLines(
  tx: TransactionClient,
  cartToken: string | null,
  orderedVariantIds: number[],
): Promise<void> {
  if (!cartToken || orderedVariantIds.length === 0) return;
  const [cartRow] = await tx
    .select({ id: cart.id })
    .from(cart)
    .where(eq(cart.sessionToken, cartToken))
    .orderBy(desc(cart.id))
    .limit(1);
  if (!cartRow) return;
  await tx
    .delete(cartItem)
    .where(and(eq(cartItem.cartId, cartRow.id), inArray(cartItem.variantId, orderedVariantIds)));
}

type RefundOutcome = "refunded" | "finalized_by_duplicate";

/**
 * 캡처된 돈의 보상(전액 환불). 순서가 생명이다:
 *
 * ⓐ 주문 종결 먼저(잠금 하 커밋) — 이 커밋 이후에는 어떤 confirm도 paid를 만들 수 없어
 *    "토스는 환불했는데 DB는 paid로 출고"라는 경합이 원천 차단된다. 잠금을 잡았을 때
 *    이미 같은 키로 paid가 확정돼 있으면(중복 confirm 승리) 환불하지 않고 물러난다.
 * ⓑ 토스 취소(돈). 실패하면 '주문 cancelled + 결제 ready' 비정상 조합이 표식으로 남아
 *    스위퍼·CS가 발견한다 — PaymentCompensationFailedError로 크게 알린다.
 * ⓒ 결제 기록 — ready→cancelled 조건부 UPDATE에 성공한 흐름만 취소 원장을 쓴다.
 *    중복 보상 흐름이 겹쳐도 원장은 정확히 1건이다(멱등).
 */
async function refundCapturedPayment(
  database: DatabaseClient,
  gateway: PaymentGateway,
  args: {
    orderId: number;
    orderNo: string;
    paymentId: number;
    paymentKey: string;
    grandTotal: number;
    cancelReason: string;
  },
): Promise<RefundOutcome> {
  const orderResolution = await database.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, args.orderId))
      .for("update")
      .limit(1);
    if (!locked) throw new OrderNotFoundError(args.orderNo);

    if (locked.status === "pending") {
      await applyOrderTransition(tx, {
        orderId: args.orderId,
        toStatus: "cancelled",
        actor: { role: "system" },
        memo: args.cancelReason,
      });
      return "proceed" as const;
    }
    // 다른 중복 흐름이 이미 종결 — 환불은 아래에서 멱등으로 이어간다
    if (locked.status === "cancelled") return "proceed" as const;

    // paid 또는 그 이후(preparing…): 같은 키의 중복 confirm이 그사이 확정에 성공한
    // 경우다 — 캡처는 정당한 결제가 됐으니 환불하면 안 된다. 판정 기준은 주문 상태가
    // 아니라 "payment가 같은 키로 paid인가" — 관리자가 곧바로 배송준비로 진행시켰어도
    // 캡처의 정당성은 그대로다.
    const [paidRow] = await tx
      .select({ status: payment.status, paymentKey: payment.paymentKey })
      .from(payment)
      .where(eq(payment.id, args.paymentId))
      .limit(1);
    if (paidRow?.status === "paid" && paidRow.paymentKey === args.paymentKey) {
      return "finalized" as const;
    }
    throw new PaymentStateConflictError(
      args.orderNo,
      `보상 중 예기치 못한 주문 상태(${locked.status}) — 수동 확인 필요`,
    );
  });
  if (orderResolution === "finalized") return "finalized_by_duplicate";

  let cancelResult: GatewayCancelResult;
  try {
    cancelResult = await gateway.cancel({
      paymentKey: args.paymentKey,
      cancelReason: args.cancelReason,
    });
  } catch (cancelError) {
    throw new PaymentCompensationFailedError(args.orderNo, args.paymentKey, cancelError);
  }

  await database.transaction(async (tx) => {
    const cancelledRows = await tx
      .update(payment)
      .set({ status: "cancelled", paymentKey: args.paymentKey, raw: cancelResult.raw })
      .where(and(eq(payment.id, args.paymentId), eq(payment.status, "ready")))
      .returning({ id: payment.id });
    // 0행 = 중복 보상 흐름이 이미 기록을 마쳤다 — 원장 이중 적재 금지
    if (cancelledRows.length === 0) return;
    await tx.insert(paymentCancellation).values({
      paymentId: args.paymentId,
      amount: args.grandTotal,
      reason: args.cancelReason,
      raw: cancelResult.raw,
      createdBy: serializeActor({ role: "system" }),
    });
  });

  return "refunded";
}
