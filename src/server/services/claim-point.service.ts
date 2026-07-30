import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { claim, orders, pointTransaction } from "@/db/schema";
import { calcExpiresAt, calcPointClawbackAmount, calcPointRestoreAmount } from "@/domain/point";

import type { TransactionClient } from "./db-client";
import { clawbackPoints, restoreUsedPoints } from "./point.service";
import { loadPointPolicy } from "./point-policy.service";

/**
 * 클레임 확정 시 적립금 정산 (P5) — 부분 반품의 비례 배분.
 *
 * 전체 취소는 여기 오지 않는다. 주문이 `cancelled`로 전이하면서
 * applyOrderTransition의 restoreOrderPoints가 전액을 되돌린다(초크포인트).
 * 반품은 주문 상태를 건드리지 않으므로(클레임은 별도 축) 이 함수가 필요하다.
 *
 * 두 방향을 함께 처리한다:
 *  - **사용분 복원**: 반품 비율만큼 적립금을 되돌린다. 안 하면 고객이 물건도 돌려주고 적립금도 잃는다.
 *  - **적립분 회수**: 확정 후 반품이면 이미 준 적립을 걷는다. 안 하면 '적립받고 반품'이 반복 가능하다.
 *
 * 비례 기준은 **상품 금액**(claim.goods_amount / 주문 상품금액)이다. 순환불액을 쓰면 반품
 * 배송비가 섞여 비율이 틀어진다 — 배송비는 적립금과 무관한 별도 정산이다.
 */

export type ClaimPointSettlement = {
  restoredPoint: number;
  clawedBackPoint: number;
};

/** 이 주문에서 지금까지 오간 적립금 — 같은 주문에 클레임이 여러 번 걸릴 수 있어 누적을 본다 */
async function loadOrderPointHistory(
  tx: TransactionClient,
  orderId: number,
): Promise<{ earned: number; restored: number; clawedBack: number }> {
  const [row] = await tx
    .select({
      // 구매 적립(확정 시 지급) — 회수의 상한이다
      earned: sql<number>`coalesce(sum(${pointTransaction.amount}) filter (
        where ${pointTransaction.type} = 'earn' and ${pointTransaction.tagCode} = 'purchase'
      ), 0)::int`,
      // 복원(+) — 사용분을 되돌린 누적
      restored: sql<number>`coalesce(sum(${pointTransaction.amount}) filter (
        where ${pointTransaction.type} = 'cancel' and ${pointTransaction.amount} > 0
      ), 0)::int`,
      // 회수(−) — 부호를 뒤집어 양수로 센다
      clawedBack: sql<number>`coalesce(-sum(${pointTransaction.amount}) filter (
        where ${pointTransaction.type} = 'cancel' and ${pointTransaction.amount} < 0
      ), 0)::int`,
    })
    .from(pointTransaction)
    .where(eq(pointTransaction.orderId, orderId));

  return {
    earned: Number(row?.earned ?? 0),
    restored: Number(row?.restored ?? 0),
    clawedBack: Number(row?.clawedBack ?? 0),
  };
}

/**
 * 이번 클레임까지 반영했을 때 **주문에 남는 상품 금액**.
 *
 * 0이면 마지막 반품이라, 내림으로 흘린 잔여를 전액 정리해야 한다(도메인 규칙).
 * 완료된 클레임(done)만 센다 — 접수·반려 상태를 세면 아직 처리되지 않은 신청이 금액을 깎는다.
 */
async function calcRemainingAfterClaim(
  tx: TransactionClient,
  input: { orderId: number; claimId: number; orderClaimableAmount: number },
): Promise<number> {
  const [row] = await tx
    .select({
      settledGoods: sql<number>`coalesce(sum(${claim.goodsAmount}), 0)::int`,
    })
    .from(claim)
    .where(
      and(
        eq(claim.orderId, input.orderId),
        // 이번 클레임은 아직 done 전이 전일 수 있어 id로 함께 포함시킨다
        sql`(${claim.status} = 'done' or ${claim.id} = ${input.claimId})`,
        inArray(claim.type, ["cancel", "return"]),
      ),
    );
  const settled = Number(row?.settledGoods ?? 0);
  return Math.max(0, input.orderClaimableAmount - settled);
}

/**
 * 반품 확정 시 적립금 정산. 환불 확정 트랜잭션 안에서 호출한다 —
 * 환불이 롤백되면 적립금도 함께 되돌아가야 한다.
 */
export async function settleClaimPoints(
  tx: TransactionClient,
  input: { claimId: number; claimNo: string; orderId: number },
): Promise<ClaimPointSettlement> {
  const [orderRow] = await tx
    .select({
      customerId: orders.customerId,
      orderNo: orders.orderNo,
      subtotal: orders.subtotal,
      couponDiscount: orders.couponDiscount,
      pointUsed: orders.pointUsed,
      orderStatus: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  // 비회원 주문은 적립금이 오갈 수 없다
  if (!orderRow || orderRow.customerId === null) {
    return { restoredPoint: 0, clawedBackPoint: 0 };
  }

  const [claimRow] = await tx
    .select({ goodsAmount: claim.goodsAmount })
    .from(claim)
    .where(eq(claim.id, input.claimId))
    .limit(1);
  if (!claimRow) return { restoredPoint: 0, clawedBackPoint: 0 };

  // 적립금이 적용된 기준 금액 — 배송비는 제외한다(적립·사용 모두 상품 금액 기준)
  const orderClaimableAmount = Math.max(
    0,
    orderRow.subtotal - orderRow.couponDiscount,
  );
  const history = await loadOrderPointHistory(tx, input.orderId);
  const remainingAfterClaim = await calcRemainingAfterClaim(tx, {
    orderId: input.orderId,
    claimId: input.claimId,
    orderClaimableAmount,
  });

  const policy = await loadPointPolicy(tx);
  let restoredPoint = 0;
  let clawedBackPoint = 0;

  // ── 사용분 복원
  const restoreAmount = calcPointRestoreAmount({
    orderPointUsed: orderRow.pointUsed,
    orderClaimableAmount,
    alreadyRestoredPoint: history.restored,
    refundBaseAmount: claimRow.goodsAmount,
    remainingAfterClaim,
  });
  if (restoreAmount > 0) {
    const result = await restoreUsedPoints(tx, {
      customerId: orderRow.customerId,
      amount: restoreAmount,
      title: `반품 적립금 반환 (${input.claimNo})`,
      orderId: input.orderId,
      expiresAt: calcExpiresAt(new Date(), policy),
      // 같은 클레임을 두 번 확정해도 복원은 한 번 — 환불 재시도가 돈을 늘리면 안 된다
      dedupeKey: `claim:${input.claimId}:point-restore`,
    });
    if (result.earned) restoredPoint = restoreAmount;
  }

  // ── 적립분 회수 (확정 후 반품)
  // 확정 전 반품은 애초에 적립이 없어 history.earned가 0이므로 자연히 0이 된다
  const clawbackAmount = calcPointClawbackAmount({
    earnedPoint: history.earned,
    alreadyClawedBackPoint: history.clawedBack,
    refundBaseAmount: claimRow.goodsAmount,
    orderClaimableAmount,
    remainingAfterClaim,
  });
  if (clawbackAmount > 0) {
    const result = await clawbackPoints(tx, {
      customerId: orderRow.customerId,
      amount: clawbackAmount,
      title: `반품 적립 회수 (${input.claimNo})`,
      orderId: input.orderId,
      dedupeKey: `claim:${input.claimId}:point-clawback`,
    });
    if (result.earned) clawedBackPoint = clawbackAmount;
  }

  return { restoredPoint, clawedBackPoint };
}
