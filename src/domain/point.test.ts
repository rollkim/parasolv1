import { describe, expect, it } from "vitest";

import {
  calcExpiresAt,
  calcMaxUsablePoint,
  calcPointClawbackAmount,
  calcPointRestoreAmount,
  calcPurchaseEarnAmount,
  calcReviewEarnAmount,
  checkPointUse,
  planFifoDeduction,
  type PointPolicy,
} from "./point";

const POLICY: PointPolicy = {
  earnRatePerMille: 10, // 1.0%
  expiryDays: 365,
  useUnitPoint: 10,
  minUsePoint: 1000,
  signupBonusPoint: 2000,
  reviewBonusPoint: 500,
  photoReviewBonusPoint: 200,
};

describe("calcPurchaseEarnAmount", () => {
  it("실결제 상품금액의 1%를 원 단위로 내린다", () => {
    expect(calcPurchaseEarnAmount(20000, POLICY)).toBe(200);
    expect(calcPurchaseEarnAmount(19999, POLICY)).toBe(199); // 199.99 → 199
    expect(calcPurchaseEarnAmount(99, POLICY)).toBe(0); // 0.99 → 0
  });

  it("0 이하는 적립하지 않는다", () => {
    expect(calcPurchaseEarnAmount(0, POLICY)).toBe(0);
    expect(calcPurchaseEarnAmount(-5000, POLICY)).toBe(0);
  });

  it("적립률을 바꾸면 그대로 따라온다 — 코드에 1%가 박혀 있지 않다", () => {
    expect(calcPurchaseEarnAmount(20000, { earnRatePerMille: 50 })).toBe(1000); // 5%
    expect(calcPurchaseEarnAmount(20000, { earnRatePerMille: 0 })).toBe(0);
  });
});

describe("calcReviewEarnAmount", () => {
  it("포토리뷰는 기본 적립에 추가분이 더해진다", () => {
    expect(calcReviewEarnAmount(false, POLICY)).toBe(500);
    expect(calcReviewEarnAmount(true, POLICY)).toBe(700);
  });
});

describe("calcExpiresAt", () => {
  it("적립일 + 정책 일수", () => {
    const earnedAt = new Date("2026-07-29T10:00:00+09:00");
    const expiresAt = calcExpiresAt(earnedAt, POLICY);
    expect(expiresAt.getFullYear()).toBe(2027);
    // 365일 뒤 = 같은 날짜(2027은 윤년 아님)
    expect(expiresAt.getMonth()).toBe(earnedAt.getMonth());
    expect(expiresAt.getDate()).toBe(earnedAt.getDate());
  });

  it("원본 날짜를 변형하지 않는다", () => {
    const earnedAt = new Date("2026-07-29T10:00:00Z");
    const before = earnedAt.getTime();
    calcExpiresAt(earnedAt, POLICY);
    expect(earnedAt.getTime()).toBe(before);
  });
});

describe("calcMaxUsablePoint", () => {
  it("잔액과 주문금액 중 작은 쪽을 사용 단위로 내린다", () => {
    expect(calcMaxUsablePoint(5555, 20000, POLICY)).toBe(5550); // 잔액 제한 + 10원 내림
    expect(calcMaxUsablePoint(50000, 12345, POLICY)).toBe(12340); // 주문금액 제한
  });

  it("최소 사용액에 못 미치면 0 — '전액 사용'이 실패하는 상황을 만들지 않는다", () => {
    expect(calcMaxUsablePoint(999, 20000, POLICY)).toBe(0);
    expect(calcMaxUsablePoint(1000, 20000, POLICY)).toBe(1000);
  });

  it("잔액·주문금액이 0이거나 음수면 0", () => {
    expect(calcMaxUsablePoint(0, 20000, POLICY)).toBe(0);
    expect(calcMaxUsablePoint(-100, 20000, POLICY)).toBe(0);
    expect(calcMaxUsablePoint(50000, 0, POLICY)).toBe(0);
  });
});

describe("checkPointUse", () => {
  it("0원(안 씀)은 언제나 통과 — 최소 사용액은 '반드시 써라'가 아니다", () => {
    expect(checkPointUse(0, 0, 20000, POLICY)).toEqual({ usable: true });
  });

  it("정상 사용", () => {
    expect(checkPointUse(1500, 5000, 20000, POLICY)).toEqual({ usable: true });
  });

  it("최소액 미만·단위 불일치·잔액 초과·주문금액 초과를 각각 구분한다", () => {
    const below = checkPointUse(500, 5000, 20000, POLICY);
    expect(below.usable).toBe(false);
    expect(below.usable === false && below.rejection).toBe("below_minimum");

    const notUnit = checkPointUse(1005, 5000, 20000, POLICY);
    expect(notUnit.usable === false && notUnit.rejection).toBe("not_unit");

    const overBalance = checkPointUse(6000, 5000, 20000, POLICY);
    expect(overBalance.usable === false && overBalance.rejection).toBe("over_balance");

    const overOrder = checkPointUse(30000, 50000, 20000, POLICY);
    expect(overOrder.usable === false && overOrder.rejection).toBe("over_order_amount");
  });

  it("거절 문구는 원인과 다음 행동을 함께 담는다", () => {
    const below = checkPointUse(500, 5000, 20000, POLICY);
    expect(below.usable === false && below.message).toContain("1,000원부터");
  });
});

describe("planFifoDeduction", () => {
  const lots = [
    { transactionId: 1, remainingAmount: 300 },
    { transactionId: 2, remainingAmount: 500 },
    { transactionId: 3, remainingAmount: 1000 },
  ];

  it("먼저 소멸할 것부터 차감한다", () => {
    expect(planFifoDeduction(lots, 700)).toEqual([
      { transactionId: 1, deductAmount: 300 },
      { transactionId: 2, deductAmount: 400 },
    ]);
  });

  it("정확히 맞아떨어지면 그만큼만", () => {
    expect(planFifoDeduction(lots, 300)).toEqual([
      { transactionId: 1, deductAmount: 300 },
    ]);
  });

  it("전액이면 전부 소진", () => {
    const plan = planFifoDeduction(lots, 1800);
    expect(plan.reduce((sum, row) => sum + row.deductAmount, 0)).toBe(1800);
    expect(plan).toHaveLength(3);
  });

  it("0 이하는 차감 계획이 없다", () => {
    expect(planFifoDeduction(lots, 0)).toEqual([]);
  });

  it("잔여가 0인 적립분은 건너뛴다", () => {
    const withEmpty = [
      { transactionId: 1, remainingAmount: 0 },
      { transactionId: 2, remainingAmount: 500 },
    ];
    expect(planFifoDeduction(withEmpty, 500)).toEqual([
      { transactionId: 2, deductAmount: 500 },
    ]);
  });

  it("잔여가 모자라면 던진다 — 조용히 덜 차감하면 원장과 잔액이 갈라진다", () => {
    expect(() => planFifoDeduction(lots, 2000)).toThrow(/부족/);
  });
});

describe("calcPointRestoreAmount", () => {
  // 2만원 주문 · 적립금 2천원 사용 · 카드 1만8천원
  const base = { orderPointUsed: 2000, orderClaimableAmount: 20000, alreadyRestoredPoint: 0 };

  it("절반 반품이면 적립금도 절반", () => {
    expect(
      calcPointRestoreAmount({ ...base, refundBaseAmount: 10000, remainingAfterClaim: 10000 }),
    ).toBe(1000);
  });

  it("전량 반품이면 전액", () => {
    expect(
      calcPointRestoreAmount({ ...base, refundBaseAmount: 20000, remainingAfterClaim: 0 }),
    ).toBe(2000);
  });

  it("나눠서 반품해도 합계가 사용액과 정확히 맞는다 — 내림 잔여는 마지막에 정리된다", () => {
    // 3등분: 6667 + 6667 + 6666
    const first = calcPointRestoreAmount({
      ...base,
      refundBaseAmount: 6667,
      remainingAfterClaim: 13333,
    });
    const second = calcPointRestoreAmount({
      ...base,
      alreadyRestoredPoint: first,
      refundBaseAmount: 6667,
      remainingAfterClaim: 6666,
    });
    const third = calcPointRestoreAmount({
      ...base,
      alreadyRestoredPoint: first + second,
      refundBaseAmount: 6666,
      remainingAfterClaim: 0,
    });
    expect(first + second + third).toBe(2000);
  });

  it("이미 전액 복원했으면 더 주지 않는다", () => {
    expect(
      calcPointRestoreAmount({
        ...base,
        alreadyRestoredPoint: 2000,
        refundBaseAmount: 10000,
        remainingAfterClaim: 0,
      }),
    ).toBe(0);
  });

  it("적립금을 안 쓴 주문은 복원도 없다", () => {
    expect(
      calcPointRestoreAmount({
        orderPointUsed: 0,
        orderClaimableAmount: 20000,
        alreadyRestoredPoint: 0,
        refundBaseAmount: 20000,
        remainingAfterClaim: 0,
      }),
    ).toBe(0);
  });
});

describe("calcPointClawbackAmount", () => {
  const base = { earnedPoint: 200, orderClaimableAmount: 20000, alreadyClawedBackPoint: 0 };

  it("절반 반품이면 적립분도 절반 회수", () => {
    expect(
      calcPointClawbackAmount({ ...base, refundBaseAmount: 10000, remainingAfterClaim: 10000 }),
    ).toBe(100);
  });

  it("전량 반품이면 전액 회수 — '적립받고 반품' 반복을 막는다", () => {
    expect(
      calcPointClawbackAmount({ ...base, refundBaseAmount: 20000, remainingAfterClaim: 0 }),
    ).toBe(200);
  });

  it("적립이 없던 주문은 회수도 없다", () => {
    expect(
      calcPointClawbackAmount({
        earnedPoint: 0,
        orderClaimableAmount: 20000,
        alreadyClawedBackPoint: 0,
        refundBaseAmount: 20000,
        remainingAfterClaim: 0,
      }),
    ).toBe(0);
  });

  it("이미 전액 회수했으면 두 번 걷지 않는다", () => {
    expect(
      calcPointClawbackAmount({
        ...base,
        alreadyClawedBackPoint: 200,
        refundBaseAmount: 20000,
        remainingAfterClaim: 0,
      }),
    ).toBe(0);
  });
});
