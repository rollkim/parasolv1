import "server-only";

import { eq } from "drizzle-orm";

import { orders } from "@/db/schema";
import {
  calcExpiresAt,
  calcPurchaseEarnAmount,
  calcReviewEarnAmount,
} from "@/domain/point";

import type { TransactionClient } from "./db-client";
import { earnPoints, restoreUsedPoints, type PointEarnResult } from "./point.service";
import { loadPointPolicy } from "./point-policy.service";

/**
 * 적립이 실제로 발생하는 지점들 — 구매확정·가입·리뷰.
 *
 * 원장 쓰기는 point.service가 하고, 여기는 **"얼마를 왜 적립하는가"**만 정한다.
 * 세 경로가 각자 금액을 계산하면 적립률·정책이 갈리므로 한 모듈에 모은다(RULE-14).
 *
 * 세 경로 모두 dedupe_key를 반드시 채운다 — 키를 안 주면 배치 재실행·재시도에
 * 적립이 두 번 들어가고, 늘어난 돈은 조용히 남는다.
 */

/**
 * 구매 적립 — applyOrderTransition이 `confirmed`로 바뀔 때 호출한다.
 *
 * 기준은 **실제로 돈이 오간 상품 금액**(subtotal − 쿠폰할인 − 적립금사용)이다.
 * 배송비는 뺀다: 배송비에까지 적립을 주면 저가 상품을 여러 번 나눠 사는 게 이득이 된다.
 * 적립금 사용분도 뺀다: 적립금으로 산 금액에 또 적립을 주면 적립금이 스스로 불어난다.
 *
 * dedupe_key = `order:{id}:purchase` — 같은 주문은 몇 번을 확정해도 한 번만 적립된다.
 */
export async function earnPurchasePoints(
  tx: TransactionClient,
  orderId: number,
): Promise<PointEarnResult> {
  const [orderRow] = await tx
    .select({
      customerId: orders.customerId,
      orderNo: orders.orderNo,
      subtotal: orders.subtotal,
      couponDiscount: orders.couponDiscount,
      pointUsed: orders.pointUsed,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  // 비회원 주문은 적립할 대상이 없다 — 귀속할 회원이 없으면 조용히 넘어간다
  if (!orderRow || orderRow.customerId === null) {
    return { earned: false, reason: "zero_amount" };
  }

  const policy = await loadPointPolicy(tx);
  const paidProductAmount = Math.max(
    0,
    orderRow.subtotal - orderRow.couponDiscount - orderRow.pointUsed,
  );
  const earnAmount = calcPurchaseEarnAmount(paidProductAmount, policy);
  if (earnAmount <= 0) return { earned: false, reason: "zero_amount" };

  return earnPoints(tx, {
    customerId: orderRow.customerId,
    amount: earnAmount,
    // 적립률을 문구에 박아 두면 정책을 바꿔도 옛 내역의 설명이 그대로 남는다(그게 맞다)
    title: `구매 확정 적립 (${policy.earnRatePerMille / 10}%)`,
    tagCode: "purchase",
    orderId,
    expiresAt: calcExpiresAt(new Date(), policy),
    dedupeKey: `order:${orderId}:purchase`,
  });
}

/**
 * 주문 전체 취소 시 사용 적립금 복원 — applyOrderTransition이 `cancelled`로 바뀔 때 호출한다.
 *
 * 여기 없으면 결제 실패·주문 취소로 적립금만 사라진다. 고객은 돈도 안 냈는데 적립금을 잃는다.
 *
 * dedupe_key = `order:{id}:point-restore` — 한 주문의 전체 취소는 한 번뿐이다.
 * 부분 반품의 비례 복원은 이 경로가 아니라 클레임 쪽에서 처리한다(주문은 cancelled가 안 된다).
 */
export async function restoreOrderPoints(
  tx: TransactionClient,
  orderId: number,
): Promise<PointEarnResult> {
  const [orderRow] = await tx
    .select({
      customerId: orders.customerId,
      orderNo: orders.orderNo,
      pointUsed: orders.pointUsed,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow || orderRow.customerId === null || orderRow.pointUsed <= 0) {
    return { earned: false, reason: "zero_amount" };
  }

  const policy = await loadPointPolicy(tx);
  return restoreUsedPoints(tx, {
    customerId: orderRow.customerId,
    amount: orderRow.pointUsed,
    title: `주문 취소 적립금 반환 (${orderRow.orderNo})`,
    orderId,
    expiresAt: calcExpiresAt(new Date(), policy),
    dedupeKey: `order:${orderId}:point-restore`,
  });
}

/**
 * 가입 축하 적립.
 *
 * dedupe_key = `signup:{customerId}` — 회원 하나당 한 번. 탈퇴 후 재가입은 새 customerId라
 * 다시 받는데, 이건 탈퇴/재가입 자체를 막는 문제이지 적립금 쪽에서 볼 문제가 아니다.
 */
export async function earnSignupBonus(
  tx: TransactionClient,
  customerId: number,
): Promise<PointEarnResult> {
  const policy = await loadPointPolicy(tx);
  if (policy.signupBonusPoint <= 0) return { earned: false, reason: "zero_amount" };

  return earnPoints(tx, {
    customerId,
    amount: policy.signupBonusPoint,
    title: "회원가입 축하 적립",
    tagCode: "event",
    expiresAt: calcExpiresAt(new Date(), policy),
    dedupeKey: `signup:${customerId}`,
  });
}

/**
 * 리뷰 적립 — 포토리뷰는 추가분이 붙는다.
 *
 * dedupe_key는 리뷰 id가 아니라 **주문 항목 id**를 쓴다. 리뷰 id로 잡으면 지웠다 다시 쓸 때마다
 * 새 id가 나와 계속 적립된다. 주문 항목당 리뷰는 하나뿐이므로(유니크 제약) 항목 id로 잡으면
 * "산 물건 하나당 리뷰 적립 한 번"이 영구히 보장된다.
 */
export async function earnReviewPoints(
  tx: TransactionClient,
  input: { customerId: number; orderItemId: number; hasPhoto: boolean },
): Promise<PointEarnResult> {
  const policy = await loadPointPolicy(tx);
  const earnAmount = calcReviewEarnAmount(input.hasPhoto, policy);
  if (earnAmount <= 0) return { earned: false, reason: "zero_amount" };

  return earnPoints(tx, {
    customerId: input.customerId,
    amount: earnAmount,
    title: input.hasPhoto ? "포토리뷰 작성 적립" : "리뷰 작성 적립",
    tagCode: input.hasPhoto ? "photo_review" : "review",
    expiresAt: calcExpiresAt(new Date(), policy),
    dedupeKey: `review:orderItem:${input.orderItemId}`,
  });
}
