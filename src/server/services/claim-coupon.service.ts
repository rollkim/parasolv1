import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { claim, orders } from "@/db/schema";
import { calcCouponRefundDeduction } from "@/domain/coupon";

import type { DatabaseClient, TransactionClient } from "./db-client";

/**
 * 클레임 확정 시 쿠폰 비례 차감 (C4) — 설계 결정 ④.
 *
 * 전체 취소는 여기 오지 않는다. 취소는 환불액 스냅샷이 이미 쿠폰을 뺀 실결제액이고,
 * 쿠폰 원본은 주문 취소 초크포인트(restoreOrderCoupon)가 되돌린다.
 *
 * 부분 반품은 쿠폰을 복원하지 않는다 — 쿠폰은 한 장이라 '절반 복원'이 없다.
 * 대신 **환불액에서 반품 비율만큼 차감**한다. 안 하면 고객이 이득을 본다:
 * 2만원 주문·5천원 쿠폰(카드 1만5천)에서 1만원어치를 반품하며 1만원을 돌려주면,
 * 남은 상품은 1만원인데 결제는 5천원만 남는다 — 차액 2,500원이 판매자 손실이다.
 *
 * 차감 이력은 claim.coupon_deduction 컬럼이 원장이다. 원장 없이 재계산만 하면
 * 내림 잔여가 어디서 정리됐는지 알 수 없어 나눠 반품할 때 합계가 어긋난다.
 */

/**
 * 이 클레임이 환불액에서 차감할 쿠폰 몫을 **계산만** 한다(기록 없음).
 *
 * 환불 실행(claim-refund)이 PG 호출 전에 카드 환불액을 정하는 데 쓴다.
 * 실제 기록(settleClaimCoupon)도 같은 계산을 쓰므로 두 값이 갈리지 않는다.
 */
export async function computeClaimCouponDeduction(
  client: TransactionClient | DatabaseClient,
  input: { claimId: number; orderId: number },
): Promise<number> {
  const [orderRow] = await client
    .select({
      subtotal: orders.subtotal,
      couponDiscount: orders.couponDiscount,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .limit(1);
  if (!orderRow || orderRow.couponDiscount <= 0) return 0;

  const [claimRow] = await client
    .select({
      goodsAmount: claim.goodsAmount,
      couponDeduction: claim.couponDeduction,
    })
    .from(claim)
    .where(eq(claim.id, input.claimId))
    .limit(1);
  if (!claimRow) return 0;

  // 이미 정산된 클레임 — 기록된 값이 진실이다(재실행이 값을 두 번 만들면 안 된다)
  if (claimRow.couponDeduction > 0) return claimRow.couponDeduction;

  /* 지금까지 차감된 누적과 남는 상품 금액 — 완료된 클레임만 센다(적립금 정산과 같은 규칙).
     자기 자신은 제외한다: 이 클레임의 coupon_deduction은 아직 0이지만,
     goods 합계에는 포함시켜야 '이번 반품 뒤 남는 금액'이 맞는다 */
  const [historyRow] = await client
    .select({
      deductedTotal: sql<number>`coalesce(sum(${claim.couponDeduction}), 0)::int`,
    })
    .from(claim)
    .where(
      and(
        eq(claim.orderId, input.orderId),
        eq(claim.status, "done"),
        ne(claim.id, input.claimId),
        inArray(claim.type, ["cancel", "return"]),
      ),
    );

  const [remainingRow] = await client
    .select({
      settledGoods: sql<number>`coalesce(sum(${claim.goodsAmount}), 0)::int`,
    })
    .from(claim)
    .where(
      and(
        eq(claim.orderId, input.orderId),
        sql`(${claim.status} = 'done' or ${claim.id} = ${input.claimId})`,
        inArray(claim.type, ["cancel", "return"]),
      ),
    );

  return calcCouponRefundDeduction({
    orderCouponDiscount: orderRow.couponDiscount,
    // 비례 기준은 상품금액(subtotal) — goods_amount와 같은 스케일(적립금 정산과 동일)
    orderClaimableAmount: orderRow.subtotal,
    alreadyDeductedAmount: Number(historyRow?.deductedTotal ?? 0),
    refundBaseAmount: claimRow.goodsAmount,
    remainingAfterClaim: Math.max(
      0,
      orderRow.subtotal - Number(remainingRow?.settledGoods ?? 0),
    ),
  });
}

/**
 * 반품 확정 시 쿠폰 차감을 원장(claim.coupon_deduction)에 기록한다.
 * 환불 확정 트랜잭션 안에서 호출한다 — 환불이 롤백되면 차감 기록도 함께 되돌아간다.
 */
export async function settleClaimCoupon(
  tx: TransactionClient,
  input: { claimId: number; orderId: number },
): Promise<{ couponDeducted: number }> {
  const deduction = await computeClaimCouponDeduction(tx, input);
  if (deduction <= 0) return { couponDeducted: 0 };

  // 조건부 UPDATE — 이미 기록된 클레임에 다시 쓰지 않는다(환불 재시도 방어)
  const updated = await tx
    .update(claim)
    .set({ couponDeduction: deduction })
    .where(and(eq(claim.id, input.claimId), eq(claim.couponDeduction, 0)))
    .returning({ id: claim.id });

  return { couponDeducted: updated.length > 0 ? deduction : 0 };
}
