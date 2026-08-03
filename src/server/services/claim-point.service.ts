import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { claim, orders, pointTransaction } from "@/db/schema";
import { calcExpiresAt, calcPointClawbackAmount, calcPointRestoreAmount } from "@/domain/point";

import type { DatabaseClient, TransactionClient } from "./db-client";
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
  tx: TransactionClient | DatabaseClient,
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
  tx: TransactionClient | DatabaseClient,
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

export type ClaimPointComputation = {
  /** 비회원 주문이면 null — 정산할 것이 없다 */
  customerId: number | null;
  restoreAmount: number;
  clawbackAmount: number;
};

/**
 * 이 클레임이 확정될 때 오갈 적립금을 **계산만** 한다(원장 기록 없음).
 *
 * 환불 실행(claim-refund)이 PG 호출 **전에** 카드 환불액에서 복원 몫을 빼기 위해 쓴다 —
 * 복원 몫을 빼지 않으면 상품값은 카드로 다 돌려주고 적립금도 또 복원해 이중 지급이 된다.
 * 실제 기록(settleClaimPoints)도 같은 계산을 쓰므로 두 값이 갈리지 않는다.
 */
export async function computeClaimPointSettlement(
  client: TransactionClient | DatabaseClient,
  input: { claimId: number; orderId: number },
): Promise<ClaimPointComputation> {
  const [orderRow] = await client
    .select({
      customerId: orders.customerId,
      subtotal: orders.subtotal,
      pointUsed: orders.pointUsed,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);

  // 비회원 주문은 적립금이 오갈 수 없다
  if (!orderRow || orderRow.customerId === null) {
    return { customerId: null, restoreAmount: 0, clawbackAmount: 0 };
  }

  const [claimRow] = await client
    .select({ goodsAmount: claim.goodsAmount })
    .from(claim)
    .where(eq(claim.id, input.claimId))
    .limit(1);
  if (!claimRow) return { customerId: orderRow.customerId, restoreAmount: 0, clawbackAmount: 0 };

  /* 비례 기준은 **상품금액(subtotal)** — 클레임의 goods_amount와 같은 스케일이어야 한다.
     이전에는 쿠폰을 뺀 금액을 기준으로 삼았는데, goods_amount는 쿠폰을 모르는 상품가격
     스케일이라 분모만 작아져 비율이 부풀었다(쿠폰 있는 주문에서 과복원).
     쿠폰이 0이면 두 기준이 같아 지금까지는 드러나지 않았다. */
  const orderClaimableAmount = orderRow.subtotal;
  const history = await loadOrderPointHistory(client, input.orderId);
  const remainingAfterClaim = await calcRemainingAfterClaim(client, {
    orderId: input.orderId,
    claimId: input.claimId,
    orderClaimableAmount,
  });

  const restoreAmount = calcPointRestoreAmount({
    orderPointUsed: orderRow.pointUsed,
    orderClaimableAmount,
    alreadyRestoredPoint: history.restored,
    refundBaseAmount: claimRow.goodsAmount,
    remainingAfterClaim,
  });
  const clawbackAmount = calcPointClawbackAmount({
    earnedPoint: history.earned,
    alreadyClawedBackPoint: history.clawedBack,
    refundBaseAmount: claimRow.goodsAmount,
    orderClaimableAmount,
    remainingAfterClaim,
  });

  return { customerId: orderRow.customerId, restoreAmount, clawbackAmount };
}

/**
 * 반품 확정 시 적립금 정산. 환불 확정 트랜잭션 안에서 호출한다 —
 * 환불이 롤백되면 적립금도 함께 되돌아가야 한다.
 */
export async function settleClaimPoints(
  tx: TransactionClient,
  input: { claimId: number; claimNo: string; orderId: number },
): Promise<ClaimPointSettlement> {
  const computed = await computeClaimPointSettlement(tx, {
    claimId: input.claimId,
    orderId: input.orderId,
  });
  if (computed.customerId === null) {
    return { restoredPoint: 0, clawedBackPoint: 0 };
  }

  const policy = await loadPointPolicy(tx);
  let restoredPoint = 0;
  let clawedBackPoint = 0;

  // ── 사용분 복원
  if (computed.restoreAmount > 0) {
    const result = await restoreUsedPoints(tx, {
      customerId: computed.customerId,
      amount: computed.restoreAmount,
      title: `반품 적립금 반환 (${input.claimNo})`,
      orderId: input.orderId,
      expiresAt: calcExpiresAt(new Date(), policy),
      // 같은 클레임을 두 번 확정해도 복원은 한 번 — 환불 재시도가 돈을 늘리면 안 된다
      dedupeKey: `claim:${input.claimId}:point-restore`,
    });
    if (result.earned) restoredPoint = computed.restoreAmount;
  }

  // ── 적립분 회수 (확정 후 반품)
  // 확정 전 반품은 애초에 적립이 없어 earned가 0이므로 자연히 0이 된다
  if (computed.clawbackAmount > 0) {
    const result = await clawbackPoints(tx, {
      customerId: computed.customerId,
      amount: computed.clawbackAmount,
      title: `반품 적립 회수 (${input.claimNo})`,
      orderId: input.orderId,
      dedupeKey: `claim:${input.claimId}:point-clawback`,
    });
    if (result.earned) clawedBackPoint = computed.clawbackAmount;
  }

  return { restoredPoint, clawedBackPoint };
}
