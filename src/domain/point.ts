/**
 * 적립금 규칙 — 순수 함수만. DB·tRPC를 모른다.
 *
 * 원장(point_transaction)은 append-only이고 customer.point_balance는 캐시다.
 * 이 모듈은 "얼마를 적립/사용/복원하는가"만 정하고, 원장에 쓰는 일은 서비스가 한다(RULE-14).
 *
 * 금액은 전부 원 단위 정수다(RULE-11). 나눗셈이 끼는 계산은 **항상 내림**하고,
 * 내림으로 생긴 잔여는 마지막 정산에서 몰아준다 — 반올림을 쓰면 여러 번 나눌 때 합계가
 * 원본을 넘을 수 있고, 넘은 만큼은 몰이 손해를 본다.
 */

export type PointPolicy = {
  /** 적립률 — 0.1% 단위 정수. 10 = 1.0% (site_setting의 earnRate) */
  earnRatePerMille: number;
  /** 적립일로부터 소멸까지 일수 */
  expiryDays: number;
  /** 사용 단위 — 이 배수로만 쓸 수 있다 */
  useUnitPoint: number;
  /** 최소 사용 금액 — 이보다 적으면 아예 못 쓴다 */
  minUsePoint: number;
  signupBonusPoint: number;
  reviewBonusPoint: number;
  /** 포토리뷰 **추가** 적립 — reviewBonusPoint에 더해진다 */
  photoReviewBonusPoint: number;
};

// ── 적립 ──────────────────────────────────────────────

/**
 * 구매 적립액.
 *
 * 기준은 **실제로 돈이 오간 상품 금액**이다 — 배송비와 적립금 사용분을 뺀 금액.
 *  - 배송비 제외: 배송비에까지 적립을 주면 저가 상품을 여러 번 나눠 사는 게 이득이 된다.
 *  - 적립금 사용분 제외: 적립금으로 산 금액에 또 적립을 주면 적립금이 스스로 불어난다.
 */
export function calcPurchaseEarnAmount(
  paidProductAmount: number,
  policy: Pick<PointPolicy, "earnRatePerMille">,
): number {
  if (paidProductAmount <= 0) return 0;
  return Math.floor((paidProductAmount * policy.earnRatePerMille) / 1000);
}

/** 리뷰 적립액 — 포토리뷰는 기본 리뷰 적립에 추가분이 더해진다 */
export function calcReviewEarnAmount(
  hasPhoto: boolean,
  policy: Pick<PointPolicy, "reviewBonusPoint" | "photoReviewBonusPoint">,
): number {
  return policy.reviewBonusPoint + (hasPhoto ? policy.photoReviewBonusPoint : 0);
}

/** 소멸 예정일 — 적립 시각 기준 */
export function calcExpiresAt(earnedAt: Date, policy: Pick<PointPolicy, "expiryDays">): Date {
  const expiresAt = new Date(earnedAt.getTime());
  expiresAt.setDate(expiresAt.getDate() + policy.expiryDays);
  return expiresAt;
}

// ── 사용 ──────────────────────────────────────────────

export type PointUseRejection =
  | "below_minimum"
  | "not_unit"
  | "over_balance"
  | "over_order_amount";

export type PointUseCheck =
  | { usable: true }
  | { usable: false; rejection: PointUseRejection; message: string };

/**
 * 이 주문에 쓸 수 있는 최대 적립금.
 *
 * 잔액과 주문금액 중 작은 쪽을 사용 단위로 내린 값이다. 최소 사용액에 못 미치면 0 —
 * 화면이 "1,000원부터 사용"이라고 안내하면서 900원 잔액에 '전액 사용' 버튼을 주면 안 된다.
 */
export function calcMaxUsablePoint(
  balance: number,
  orderAmount: number,
  policy: Pick<PointPolicy, "useUnitPoint" | "minUsePoint">,
): number {
  const cap = Math.min(Math.max(balance, 0), Math.max(orderAmount, 0));
  const unitFloored = Math.floor(cap / policy.useUnitPoint) * policy.useUnitPoint;
  return unitFloored >= policy.minUsePoint ? unitFloored : 0;
}

/**
 * 사용 요청 검증 — 서버가 판정한다.
 *
 * 화면이 최대치를 계산해 주더라도 요청은 조작될 수 있으므로 같은 규칙을 여기서 다시 본다.
 * 0원(안 씀)은 언제나 통과다 — 최소 사용액은 '쓰려면 얼마부터'이지 '반드시 써야 한다'가 아니다.
 */
export function checkPointUse(
  requestedPoint: number,
  balance: number,
  orderAmount: number,
  policy: Pick<PointPolicy, "useUnitPoint" | "minUsePoint">,
): PointUseCheck {
  if (requestedPoint === 0) return { usable: true };

  if (requestedPoint < policy.minUsePoint) {
    return {
      usable: false,
      rejection: "below_minimum",
      message: `적립금은 ${policy.minUsePoint.toLocaleString()}원부터 사용할 수 있어요.`,
    };
  }
  if (requestedPoint % policy.useUnitPoint !== 0) {
    return {
      usable: false,
      rejection: "not_unit",
      message: `적립금은 ${policy.useUnitPoint}원 단위로 사용할 수 있어요.`,
    };
  }
  if (requestedPoint > balance) {
    return {
      usable: false,
      rejection: "over_balance",
      message: "보유한 적립금보다 많이 사용할 수 없어요. 잔액을 다시 확인해 주세요.",
    };
  }
  if (requestedPoint > orderAmount) {
    return {
      usable: false,
      rejection: "over_order_amount",
      message: "결제 금액보다 많은 적립금을 사용할 수 없어요.",
    };
  }
  return { usable: true };
}

// ── FIFO 차감 ─────────────────────────────────────────

/** 적립 원장 한 건의 미사용 잔여 — 서비스가 만료 임박순으로 정렬해 넘긴다 */
export type PointLot = { transactionId: number; remainingAmount: number };

export type PointDeduction = { transactionId: number; deductAmount: number };

/**
 * 어느 적립분에서 얼마씩 뺄지 계산 (FIFO).
 *
 * 먼저 소멸할 것부터 쓴다 — 나중 것부터 쓰면 곧 소멸할 적립금이 그대로 사라져서
 * 고객이 "쓸 수 있었는데 날아갔다"를 겪는다. 정렬은 호출자가 책임진다.
 *
 * 잔여 합계가 요청액보다 적으면 던진다. 조용히 덜 차감하면 원장 합계와
 * 잔액 캐시가 갈라지고, 그 차이는 나중에 어디서 났는지 찾을 수 없다.
 */
export function planFifoDeduction(
  lots: readonly PointLot[],
  requestedPoint: number,
): PointDeduction[] {
  if (requestedPoint <= 0) return [];

  const deductions: PointDeduction[] = [];
  let unassigned = requestedPoint;

  for (const lot of lots) {
    if (unassigned === 0) break;
    if (lot.remainingAmount <= 0) continue;
    const deductAmount = Math.min(lot.remainingAmount, unassigned);
    deductions.push({ transactionId: lot.transactionId, deductAmount });
    unassigned -= deductAmount;
  }

  if (unassigned > 0) {
    throw new Error(
      `적립금 잔여가 부족합니다: 요청 ${requestedPoint}, 부족 ${unassigned}`,
    );
  }
  return deductions;
}

// ── 클레임 복원 ───────────────────────────────────────

/**
 * 부분 반품 시 돌려줄 적립금 (비례 배분).
 *
 * 예) 2만원 주문 · 적립금 2천원 사용 · 카드 1만8천원 → 절반 반품이면 적립금 1천 + 카드 9천.
 *
 * 내림 때문에 마지막 반품에서 적립금이 몇 원 남을 수 있어, **남은 항목이 없으면 잔여를 전액**
 * 돌려준다. 이 처리가 없으면 전부 반품했는데도 적립금이 원장에 묶여 영영 안 돌아온다.
 *
 * @param remainingAfterClaim 이번 반품 뒤에도 살아남는 주문 금액. 0이면 마지막 반품이다
 */
export function calcPointRestoreAmount(input: {
  orderPointUsed: number;
  orderClaimableAmount: number;
  alreadyRestoredPoint: number;
  refundBaseAmount: number;
  remainingAfterClaim: number;
}): number {
  const restorable = input.orderPointUsed - input.alreadyRestoredPoint;
  if (restorable <= 0) return 0;
  if (input.orderClaimableAmount <= 0) return 0;

  // 남는 게 없으면 잔여 전액 — 내림으로 흘린 몇 원까지 여기서 정리된다
  if (input.remainingAfterClaim <= 0) return restorable;

  const proportional = Math.floor(
    (input.orderPointUsed * input.refundBaseAmount) / input.orderClaimableAmount,
  );
  return Math.min(Math.max(proportional, 0), restorable);
}

/**
 * 확정 후 반품으로 회수할 적립금 (이미 적립해 준 구매 적립).
 *
 * 잔액이 모자라도 **회수는 그대로 한다** — 음수 잔액을 허용한다는 뜻이다.
 * 회수를 포기하면 "적립받고 반품"이 무한 반복 가능한 구멍이 된다. 대신 음수 잔액은
 * 다음 적립으로 자연히 메워지고, 그동안 사용은 잔액 검사에서 막힌다.
 */
export function calcPointClawbackAmount(input: {
  earnedPoint: number;
  alreadyClawedBackPoint: number;
  refundBaseAmount: number;
  orderClaimableAmount: number;
  remainingAfterClaim: number;
}): number {
  const clawbackable = input.earnedPoint - input.alreadyClawedBackPoint;
  if (clawbackable <= 0) return 0;
  if (input.orderClaimableAmount <= 0) return 0;

  if (input.remainingAfterClaim <= 0) return clawbackable;

  const proportional = Math.floor(
    (input.earnedPoint * input.refundBaseAmount) / input.orderClaimableAmount,
  );
  return Math.min(Math.max(proportional, 0), clawbackable);
}
