import "server-only";

import { and, count, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { claim, orders, payment, paymentCancellation } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import type { PaymentGateway } from "../payments/payment-gateway";
import { confirmPayment } from "./payment.service";

/**
 * 결제 대사(Phase 6) — **돈이 묶인 흔적을 찾아내는 일**.
 *
 * 결제는 "PG에 승인 요청 → 우리 DB 확정" 두 걸음이라, 사이에서 끊기면
 * **토스에는 돈이 빠졌는데 우리 주문은 pending**인 상태가 남는다. 고객은 결제됐다고 알고
 * 우리는 주문이 없다고 안다 — 가장 나쁜 종류의 불일치다.
 *
 * 이 모듈은 **새로운 돈 경로를 만들지 않는다.** 대사는 confirmPayment를 다시 부르는 것이
 * 전부다. confirmPayment는 멱등이고(결제키 선점 + ALREADY_PROCESSED 재조회) 재고 차감·
 * 자동 환불 보상까지 이미 안에 있다. 배치가 별도 로직을 갖는 순간 두 경로가 갈라진다.
 *
 * 자동으로 고치는 것은 **①(미확정 결제)뿐**이다. 나머지는 사람이 판단해야 하는 불일치라
 * 보고만 한다 — 배치가 환불이나 상태 되돌리기를 스스로 하면 사고가 조용히 커진다.
 */

/** 승인 시도 후 이 시간이 지나도 pending이면 끊긴 것으로 본다(결제창 체류 시간 여유) */
const STUCK_PAYMENT_MINUTES = 15;

export type ReconcileOutcome = "confirmed" | "notPaid" | "failed";

export type ReconcileResultItem = {
  orderNo: string;
  outcome: ReconcileOutcome;
  /** 실패했을 때의 원인 — 운영자가 읽고 판단한다 */
  message: string | null;
};

export type ReconcileAnomalyReport = {
  /** 환불(전액 취소)됐는데 주문이 아직 진행 중 — 돈은 돌려줬는데 상품이 나간다 */
  refundedButActiveOrders: { orderNo: string; orderStatus: string; paymentStatus: string }[];
  /** 클레임은 종결됐는데 환불 원장이 없다 — refundClaim 확정 트랜잭션이 끊긴 흔적 */
  settledClaimsWithoutRefund: { claimNo: string; refundAmount: number }[];
  /** 주문은 결제완료인데 결제 건이 없다 — 수동 조작이나 데이터 사고 */
  paidOrdersWithoutPayment: { orderNo: string }[];
};

export type ReconcileReport = {
  scannedCount: number;
  items: ReconcileResultItem[];
  anomalies: ReconcileAnomalyReport;
};

/**
 * 미확정 결제 대사.
 *
 * 대상: 주문 pending + 결제 ready + **결제키가 있는** 건. 결제키가 있다는 건
 * 승인을 시도했다는 뜻이다(confirmPayment가 호출 직전에 선점해 기록한다) — 그 흔적이
 * 없으면 애초에 결제창에 가지 않은 주문이라 대사 대상이 아니다.
 */
export async function reconcilePendingPayments(
  database: DatabaseClient,
  gateway: PaymentGateway,
  options: { stuckMinutes?: number; limit?: number } = {},
): Promise<ReconcileReport> {
  const stuckMinutes = options.stuckMinutes ?? STUCK_PAYMENT_MINUTES;
  const limit = options.limit ?? 50;

  const targets = await database
    .select({
      orderNo: orders.orderNo,
      paymentKey: payment.paymentKey,
      amount: payment.amount,
    })
    .from(orders)
    .innerJoin(payment, eq(payment.orderId, orders.id))
    .where(
      and(
        eq(orders.status, "pending"),
        eq(payment.status, "ready"),
        isNotNull(payment.paymentKey),
        isNull(payment.claimId),
        lt(payment.createdAt, sql`now() - ${sql.raw(`interval '${stuckMinutes} minutes'`)}`),
      ),
    )
    .orderBy(payment.createdAt)
    .limit(limit);

  const items: ReconcileResultItem[] = [];
  for (const target of targets) {
    try {
      // 멱등 재시도 — 토스에 이미 승인된 건이면 확정되고, 아니면 거절로 끝난다.
      // cartToken은 넘기지 않는다: 대사 시점에 장바구니는 이미 비워졌거나 사라졌고,
      // 주문은 생성 시점 스냅샷으로 이미 완결돼 있다.
      await confirmPayment(database, gateway, {
        orderNo: target.orderNo,
        paymentKey: target.paymentKey as string,
        amount: target.amount,
      });
      items.push({ orderNo: target.orderNo, outcome: "confirmed", message: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 확정 거절 = PG에 결제가 없다는 뜻이라 정상 종료다(고객이 결제창을 닫은 경우)
      const isDefinitiveReject =
        error instanceof Error && error.name === "PaymentRejectedError";
      items.push({
        orderNo: target.orderNo,
        outcome: isDefinitiveReject ? "notPaid" : "failed",
        message,
      });
    }
  }

  return {
    scannedCount: targets.length,
    items,
    anomalies: await findReconcileAnomalies(database),
  };
}

/**
 * 사람이 봐야 하는 불일치 — **자동으로 고치지 않는다.**
 * 배치가 환불이나 상태 되돌리기를 스스로 하면 사고가 조용히 커진다.
 */
export async function findReconcileAnomalies(
  database: DatabaseClient,
): Promise<ReconcileAnomalyReport> {
  const refundedButActiveOrders = await database
    .select({
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      paymentStatus: payment.status,
    })
    .from(orders)
    .innerJoin(payment, and(eq(payment.orderId, orders.id), isNull(payment.claimId)))
    .where(
      and(
        eq(payment.status, "cancelled"),
        sql`${orders.status} in ('paid','preparing','shipping','delivered','confirmed')`,
      ),
    )
    .limit(50);

  // 종결 클레임인데 환불 원장이 없는 건 — 환불액이 0인 교환은 정상이라 제외한다
  const settledClaimsWithoutRefund = await database
    .select({ claimNo: claim.claimNo, refundAmount: claim.refundAmount })
    .from(claim)
    .where(
      and(
        eq(claim.status, "done"),
        sql`${claim.refundAmount} > 0`,
        sql`not exists (
          select 1 from ${paymentCancellation} pc
          join ${payment} p on p.id = pc.payment_id
          where p.order_id = ${claim.orderId}
        )`,
      ),
    )
    .limit(50);

  const paidOrdersWithoutPayment = await database
    .select({ orderNo: orders.orderNo })
    .from(orders)
    .where(
      and(
        sql`${orders.status} in ('paid','preparing','shipping','delivered','confirmed')`,
        sql`not exists (
          select 1 from ${payment} p
          where p.order_id = ${orders.id} and p.claim_id is null and p.status <> 'failed'
        )`,
      ),
    )
    .limit(50);

  return { refundedButActiveOrders, settledClaimsWithoutRefund, paidOrdersWithoutPayment };
}

/** 대사 대상이 얼마나 쌓였는지 — 대시보드 경고에 쓸 수 있다 */
export async function countStuckPayments(
  database: DatabaseClient,
  options: { stuckMinutes?: number } = {},
): Promise<number> {
  const stuckMinutes = options.stuckMinutes ?? STUCK_PAYMENT_MINUTES;
  const [row] = await database
    .select({ total: count() })
    .from(orders)
    .innerJoin(payment, eq(payment.orderId, orders.id))
    .where(
      and(
        eq(orders.status, "pending"),
        eq(payment.status, "ready"),
        isNotNull(payment.paymentKey),
        isNull(payment.claimId),
        lt(payment.createdAt, sql`now() - ${sql.raw(`interval '${stuckMinutes} minutes'`)}`),
      ),
    );
  return row?.total ?? 0;
}
