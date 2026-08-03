import { describe, expect, it } from "vitest";

import {
  calcCouponDiscount,
  calcCouponRefundDeduction,
  canIssueMoreToCustomer,
  checkCouponUsable,
  remainingIssueQuantity,
  type CouponRule,
} from "./coupon";

const FIXED_5000: CouponRule = {
  discountKind: "fixed",
  discountValue: 5000,
  maxDiscountAmount: null,
  minOrderAmount: 30000,
};

/** 10% · 최대 5천원 · 최소주문 없음 */
const PERCENT_10: CouponRule = {
  discountKind: "percent",
  discountValue: 100,
  maxDiscountAmount: 5000,
  minOrderAmount: 0,
};

const NOW = new Date("2026-08-03T12:00:00+09:00");

describe("calcCouponDiscount", () => {
  it("정액 쿠폰은 액면 그대로 깎는다", () => {
    expect(calcCouponDiscount(FIXED_5000, 30000)).toBe(5000);
  });

  it("정액이 대상 금액보다 크면 대상 금액까지만 깎는다", () => {
    // 넘치면 결제액이 음수가 된다 — 차액을 현금으로 주는 쿠폰이 되면 안 된다
    expect(calcCouponDiscount(FIXED_5000, 3000)).toBe(3000);
  });

  it("정률은 0.1% 단위 정수로 읽고 원 단위로 내린다", () => {
    expect(calcCouponDiscount(PERCENT_10, 30000)).toBe(3000); // 10%
    expect(calcCouponDiscount(PERCENT_10, 19999)).toBe(1999); // 1999.9 → 1999
    expect(calcCouponDiscount(PERCENT_10, 9)).toBe(0); // 0.9 → 0
  });

  it("정률은 최대 할인액을 넘지 않는다", () => {
    // 10만원의 10%는 1만원이지만 상한이 5천원이다
    expect(calcCouponDiscount(PERCENT_10, 100000)).toBe(5000);
  });

  it("최대 할인액이 없으면 상한 없이 계산한다", () => {
    const noCap: CouponRule = { ...PERCENT_10, maxDiscountAmount: null };
    expect(calcCouponDiscount(noCap, 100000)).toBe(10000);
  });

  it("대상 금액이 0 이하면 할인도 0", () => {
    expect(calcCouponDiscount(FIXED_5000, 0)).toBe(0);
    expect(calcCouponDiscount(PERCENT_10, -1000)).toBe(0);
  });
});

describe("checkCouponUsable", () => {
  const BASE = {
    rule: FIXED_5000,
    startsAt: null,
    endsAt: null,
    issueExpiresAt: null,
    usedAt: null,
    targetAmount: 30000,
    hasScopeMatch: true,
    now: NOW,
  };

  it("조건을 모두 만족하면 사용 가능", () => {
    expect(checkCouponUsable(BASE)).toEqual({ usable: true });
  });

  it("이미 쓴 쿠폰은 거절한다", () => {
    const result = checkCouponUsable({ ...BASE, usedAt: new Date("2026-08-01") });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("already_used");
  });

  it("시작 전 쿠폰은 거절한다", () => {
    const result = checkCouponUsable({ ...BASE, startsAt: new Date("2026-09-01") });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("not_started");
  });

  it("쿠폰 종료일이 지나면 거절한다", () => {
    const result = checkCouponUsable({ ...BASE, endsAt: new Date("2026-07-31") });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("expired");
  });

  it("쿠폰은 살아 있어도 내 발급건이 만료면 거절한다", () => {
    // 한쪽만 보면 놓치는 경우 — 발급일 기준 유효일수가 쿠폰 종료일보다 먼저 온다
    const result = checkCouponUsable({
      ...BASE,
      endsAt: new Date("2026-12-31"),
      issueExpiresAt: new Date("2026-08-01"),
    });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("expired");
  });

  it("범위에 걸리는 상품이 없으면 거절한다", () => {
    const result = checkCouponUsable({ ...BASE, hasScopeMatch: false });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("out_of_scope");
  });

  it("최소 주문 금액에 못 미치면 거절한다", () => {
    const result = checkCouponUsable({ ...BASE, targetAmount: 29999 });
    expect(result.usable).toBe(false);
    if (!result.usable) {
      expect(result.rejection).toBe("below_min_order");
      expect(result.message).toContain("30,000원");
    }
  });

  it("고칠 수 없는 사유를 고칠 수 있는 사유보다 먼저 알린다", () => {
    // 이미 쓴 쿠폰에 "3만원 이상 구매하세요"라고 하면 3만원을 채우고 다시 막힌다
    const result = checkCouponUsable({
      ...BASE,
      usedAt: new Date("2026-08-01"),
      targetAmount: 1000,
    });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("already_used");
  });

  it("범위 불일치를 최소금액보다 먼저 알린다", () => {
    // 쓸 수 있는 상품이 아예 없는데 "3만원 이상"이라고 하면 금액을 채워도 안 된다
    const result = checkCouponUsable({ ...BASE, hasScopeMatch: false, targetAmount: 1000 });
    expect(result.usable).toBe(false);
    if (!result.usable) expect(result.rejection).toBe("out_of_scope");
  });
});

describe("canIssueMoreToCustomer", () => {
  it("한도 미만이면 받을 수 있다", () => {
    expect(canIssueMoreToCustomer({ perCustomerLimit: 1, alreadyIssuedCount: 0 })).toBe(true);
    expect(canIssueMoreToCustomer({ perCustomerLimit: 3, alreadyIssuedCount: 2 })).toBe(true);
  });

  it("한도에 닿으면 더 받을 수 없다", () => {
    expect(canIssueMoreToCustomer({ perCustomerLimit: 1, alreadyIssuedCount: 1 })).toBe(false);
    expect(canIssueMoreToCustomer({ perCustomerLimit: 3, alreadyIssuedCount: 3 })).toBe(false);
  });

  it("한도가 0이나 음수여도 최소 1매는 허용한다", () => {
    // 설정 실수로 0이 들어와 아무도 못 받는 쿠폰이 되는 것을 막는다
    expect(canIssueMoreToCustomer({ perCustomerLimit: 0, alreadyIssuedCount: 0 })).toBe(true);
    expect(canIssueMoreToCustomer({ perCustomerLimit: 0, alreadyIssuedCount: 1 })).toBe(false);
  });
});

describe("remainingIssueQuantity", () => {
  it("총 수량이 없으면 무제한(null)", () => {
    expect(remainingIssueQuantity({ totalQuantity: null, issuedCount: 500 })).toBeNull();
  });

  it("남은 수량을 돌려준다", () => {
    expect(remainingIssueQuantity({ totalQuantity: 100, issuedCount: 30 })).toBe(70);
  });

  it("초과 발급됐어도 음수를 돌려주지 않는다", () => {
    expect(remainingIssueQuantity({ totalQuantity: 100, issuedCount: 120 })).toBe(0);
  });
});

describe("calcCouponRefundDeduction", () => {
  it("절반 반품이면 쿠폰 할인의 절반을 환불액에서 뺀다", () => {
    // 2만원 주문 · 5천원 쿠폰 → 1만원 반품 시 2,500원 차감(환불 7,500원)
    expect(
      calcCouponRefundDeduction({
        orderCouponDiscount: 5000,
        orderClaimableAmount: 20000,
        alreadyDeductedAmount: 0,
        refundBaseAmount: 10000,
        remainingAfterClaim: 10000,
      }),
    ).toBe(2500);
  });

  it("나눠 반품해도 차감 합계가 쿠폰 할인액과 정확히 맞는다", () => {
    const first = calcCouponRefundDeduction({
      orderCouponDiscount: 5000,
      orderClaimableAmount: 20000,
      alreadyDeductedAmount: 0,
      refundBaseAmount: 10000,
      remainingAfterClaim: 10000,
    });
    const second = calcCouponRefundDeduction({
      orderCouponDiscount: 5000,
      orderClaimableAmount: 20000,
      alreadyDeductedAmount: first,
      refundBaseAmount: 10000,
      remainingAfterClaim: 0,
    });
    expect(first + second).toBe(5000);
  });

  it("마지막 반품이면 내림으로 흘린 잔여까지 전액 차감한다", () => {
    // 3등분: 3333 + 3333 + 나머지 3334 = 10000
    const orderCouponDiscount = 10000;
    const first = calcCouponRefundDeduction({
      orderCouponDiscount,
      orderClaimableAmount: 30000,
      alreadyDeductedAmount: 0,
      refundBaseAmount: 10000,
      remainingAfterClaim: 20000,
    });
    const second = calcCouponRefundDeduction({
      orderCouponDiscount,
      orderClaimableAmount: 30000,
      alreadyDeductedAmount: first,
      refundBaseAmount: 10000,
      remainingAfterClaim: 10000,
    });
    const third = calcCouponRefundDeduction({
      orderCouponDiscount,
      orderClaimableAmount: 30000,
      alreadyDeductedAmount: first + second,
      refundBaseAmount: 10000,
      remainingAfterClaim: 0,
    });
    expect(first).toBe(3333);
    expect(second).toBe(3333);
    expect(third).toBe(3334);
    expect(first + second + third).toBe(orderCouponDiscount);
  });

  it("쿠폰을 안 쓴 주문은 차감할 것이 없다", () => {
    expect(
      calcCouponRefundDeduction({
        orderCouponDiscount: 0,
        orderClaimableAmount: 20000,
        alreadyDeductedAmount: 0,
        refundBaseAmount: 10000,
        remainingAfterClaim: 10000,
      }),
    ).toBe(0);
  });

  it("이미 전액 차감했으면 더 빼지 않는다", () => {
    // 환불 재시도가 두 번 차감하면 고객이 손해를 본다
    expect(
      calcCouponRefundDeduction({
        orderCouponDiscount: 5000,
        orderClaimableAmount: 20000,
        alreadyDeductedAmount: 5000,
        refundBaseAmount: 10000,
        remainingAfterClaim: 0,
      }),
    ).toBe(0);
  });

  it("주문 상품금액이 0이면 비율을 낼 수 없어 0", () => {
    expect(
      calcCouponRefundDeduction({
        orderCouponDiscount: 5000,
        orderClaimableAmount: 0,
        alreadyDeductedAmount: 0,
        refundBaseAmount: 10000,
        remainingAfterClaim: 0,
      }),
    ).toBe(0);
  });
});
