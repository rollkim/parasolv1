/**
 * 쿠폰 도메인 규칙 — 순수 계산. DB·프레임워크 의존 없음.
 *
 * 적립금(domain/point.ts)과 같은 자리에 있다. 화면·서버·배치가 **같은 함수**를 써야
 * 보인 금액과 결제액이 갈리지 않는다.
 *
 * 금액은 전부 원 단위 정수, 내림(RULE-11). 정률은 **0.1% 단위 정수**다 —
 * 100 = 10%. 적립률(earnRatePerMille)과 같은 규약을 쓴다: 저장 형태가 갈리면
 * 관리자가 한 화면에서 배운 감각이 다른 화면에서 틀린다.
 */

export type CouponDiscountKind = "fixed" | "percent";

/** 쿠폰이 정한 할인 규칙 — coupon 행에서 계산에 필요한 것만 추린다 */
export type CouponRule = {
  discountKind: CouponDiscountKind;
  /** fixed = 원 / percent = 0.1% 단위 정수(100 = 10%) */
  discountValue: number;
  /** 정률형 최대 할인액. null이면 상한 없음 */
  maxDiscountAmount: number | null;
  /** 이 금액 미만이면 쓸 수 없다. 0이면 제한 없음 */
  minOrderAmount: number;
};

// ── 할인액 계산 ───────────────────────────────────────

/**
 * 쿠폰 할인액.
 *
 * `targetAmount`는 **쿠폰이 적용되는 상품 금액**이다. 전체 쿠폰이면 주문 상품금액,
 * 카테고리·상품 한정 쿠폰이면 그 범위에 속한 라인의 합계다(설계 결정 ⑥).
 *
 * **배송비는 여기 들어오지 않는다.** 정률 쿠폰이 배송비까지 깎으면 무료배송 기준을
 * 넘겼는지 판정이 흔들린다 — 배송비 할인은 별도 쿠폰 종류의 몫이다.
 *
 * 할인액은 대상 금액을 넘지 않는다. 정액 5천원 쿠폰을 3천원짜리에 쓰면 3천원만 깎인다 —
 * 넘치면 결제액이 음수가 되고, 차액을 현금으로 돌려주는 쿠폰이 되어 버린다.
 */
export function calcCouponDiscount(rule: CouponRule, targetAmount: number): number {
  if (targetAmount <= 0) return 0;

  const rawDiscount =
    rule.discountKind === "fixed"
      ? rule.discountValue
      : Math.floor((targetAmount * rule.discountValue) / 1000);

  const cappedDiscount =
    rule.maxDiscountAmount !== null
      ? Math.min(rawDiscount, rule.maxDiscountAmount)
      : rawDiscount;

  return Math.max(0, Math.min(cappedDiscount, targetAmount));
}

/**
 * 관리자 등록 화면 미리보기 — 이 조건이 이 주문액에서 실제로 얼마를 깎는지.
 *
 * 최소 주문 금액에 못 미치면 0이다. 이걸 빼면 "3만원 이상 쿠폰"이 1만원 주문에서도
 * 깎이는 것처럼 보여 관리자가 조건을 잘못 이해한다.
 */
export function previewCouponDiscount(
  rule: CouponRule,
  orderAmount: number,
): number {
  if (orderAmount < rule.minOrderAmount) return 0;
  return calcCouponDiscount(rule, orderAmount);
}

// ── 사용 가능 판정 ────────────────────────────────────

export type CouponRejection =
  | "not_started"
  | "expired"
  | "already_used"
  | "out_of_scope"
  | "below_min_order";

export type CouponUsableCheck =
  | { usable: true }
  | { usable: false; rejection: CouponRejection; message: string };

/**
 * 이 주문에 이 쿠폰을 쓸 수 있는가 — **서버가 판정한다.**
 *
 * 화면이 목록을 걸러 주더라도 요청은 조작될 수 있으므로 주문 생성에서 같은 규칙을 다시 본다.
 *
 * 거절 사유의 순서가 곧 안내 문구의 우선순위다. 이미 쓴 쿠폰에 "3만원 이상 구매하세요"라고
 * 하면 고객은 3만원을 채우고 다시 막힌다 — 고칠 수 없는 사유를 먼저 알린다.
 */
export function checkCouponUsable(input: {
  rule: CouponRule;
  /** 쿠폰 자체의 사용 시작·종료 */
  startsAt: Date | null;
  endsAt: Date | null;
  /** 발급건의 만료 — 발급일 기준 유효일수로 정해진다 */
  issueExpiresAt: Date | null;
  usedAt: Date | null;
  /** 쿠폰이 적용되는 상품 금액 */
  targetAmount: number;
  /** 범위(카테고리·상품) 쿠폰이 걸리는 상품이 주문에 있는가 */
  hasScopeMatch: boolean;
  now: Date;
}): CouponUsableCheck {
  if (input.usedAt !== null) {
    return {
      usable: false,
      rejection: "already_used",
      message: "이미 사용한 쿠폰이에요.",
    };
  }
  if (input.startsAt !== null && input.now < input.startsAt) {
    return {
      usable: false,
      rejection: "not_started",
      message: "아직 사용할 수 없는 쿠폰이에요. 사용 시작일을 확인해 주세요.",
    };
  }
  // 쿠폰 종료일과 발급건 만료일 중 **먼저 오는 쪽**이 실제 기한이다.
  // 한쪽만 보면 "쿠폰은 살아 있는데 내 발급건은 만료된" 경우를 놓친다
  if (input.endsAt !== null && input.now > input.endsAt) {
    return { usable: false, rejection: "expired", message: "사용 기간이 지난 쿠폰이에요." };
  }
  if (input.issueExpiresAt !== null && input.now > input.issueExpiresAt) {
    return { usable: false, rejection: "expired", message: "사용 기간이 지난 쿠폰이에요." };
  }
  if (!input.hasScopeMatch) {
    return {
      usable: false,
      rejection: "out_of_scope",
      message: "이 쿠폰을 쓸 수 있는 상품이 주문에 없어요.",
    };
  }
  if (input.targetAmount < input.rule.minOrderAmount) {
    return {
      usable: false,
      rejection: "below_min_order",
      message: `${input.rule.minOrderAmount.toLocaleString()}원 이상 구매 시 사용할 수 있어요.`,
    };
  }
  return { usable: true };
}

// ── 발급 한도 ─────────────────────────────────────────

/**
 * 이 회원이 이 쿠폰을 더 받을 수 있는가.
 *
 * 유니크 인덱스(1인 1매) 대신 개수로 판정한다 — 받아 놓고 안 쓴 채 만료된 쿠폰의
 * 재발급, 응대용 보상 발급, 반복 발급이 인덱스에 막히던 문제를 푼다(설계 결정 ⑤).
 * **동시 클릭 방어는 여기가 아니라 서비스의 조건부 UPDATE에 있다** — 이 함수는
 * 화면 안내와 서버 판정이 같은 규칙을 쓰게 하는 몫만 한다.
 */
export function canIssueMoreToCustomer(input: {
  perCustomerLimit: number;
  alreadyIssuedCount: number;
}): boolean {
  return input.alreadyIssuedCount < Math.max(1, input.perCustomerLimit);
}

/** 남은 발급 수량. null이면 무제한 */
export function remainingIssueQuantity(input: {
  totalQuantity: number | null;
  issuedCount: number;
}): number | null {
  if (input.totalQuantity === null) return null;
  return Math.max(0, input.totalQuantity - input.issuedCount);
}

// ── 클레임 환불 시 비례 차감 ──────────────────────────

/**
 * 부분 반품에서 **환불액에서 빼야 할 쿠폰 할인 몫**.
 *
 * 이걸 안 하면 고객이 이득을 본다:
 *   2만원 주문 · 5천원 쿠폰 → 카드 15,000원 결제.
 *   1만원어치를 반품하면서 10,000원을 그대로 돌려주면, 남은 상품은 1만원인데
 *   결제는 5,000원만 남는다. 차액 2,500원이 판매자 손실이다.
 *   쿠폰 할인 5,000의 절반 2,500을 함께 차감해 7,500원을 환불해야 맞는다.
 *
 * 내림 때문에 마지막 반품에서 몇 원이 남을 수 있어, **남는 항목이 없으면 잔여를 전액**
 * 차감한다. 적립금 복원(calcPointRestoreAmount)과 같은 처리다.
 *
 * @param remainingAfterClaim 이번 반품 뒤에도 살아남는 주문 상품금액. 0이면 마지막 반품이다
 */
export function calcCouponRefundDeduction(input: {
  orderCouponDiscount: number;
  orderClaimableAmount: number;
  alreadyDeductedAmount: number;
  refundBaseAmount: number;
  remainingAfterClaim: number;
}): number {
  const deductible = input.orderCouponDiscount - input.alreadyDeductedAmount;
  if (deductible <= 0) return 0;
  if (input.orderClaimableAmount <= 0) return 0;

  // 남는 게 없으면 잔여 전액 — 내림으로 흘린 몇 원까지 여기서 정리된다
  if (input.remainingAfterClaim <= 0) return deductible;

  const proportional = Math.floor(
    (input.orderCouponDiscount * input.refundBaseAmount) / input.orderClaimableAmount,
  );
  return Math.min(Math.max(proportional, 0), deductible);
}
