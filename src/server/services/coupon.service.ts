import "server-only";

import { and, count, desc, eq, gt, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";

import { category, coupon, couponIssue, productCategory } from "@/db/schema";
import {
  calcCouponDiscount,
  canIssueMoreToCustomer,
  checkCouponUsable,
  type CouponRule,
} from "@/domain/coupon";

import type { DatabaseClient, TransactionClient } from "./db-client";

/**
 * 쿠폰 발급·사용·복원 원장 (C2).
 *
 * 적립금 원장(point.service)과 같은 자리를 차지한다. 차이는 **쿠폰은 나눌 수 없다**는 것:
 * 적립금은 1,000원 중 300원만 쓸 수 있지만 쿠폰은 한 장을 통째로 쓰거나 안 쓴다.
 * 그래서 잔액 캐시가 없고, 대신 `coupon_issue.used_at` 한 칸이 상태 전부다.
 *
 * **동시성 방어는 전부 조건부 UPDATE에 있다.** 조회 후 판정(read-modify-write)은
 * 같은 쿠폰을 두 번 쓰거나 수량을 넘겨 발급한다.
 */

export class CouponIssueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouponIssueUnavailableError";
  }
}

export class CouponUseRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouponUseRejectedError";
  }
}

/** coupon 행에서 도메인 계산에 필요한 것만 추린다 */
function toCouponRule(row: {
  discountKind: "fixed" | "percent";
  discountValue: number;
  maxDiscount: number | null;
  minOrderAmount: number;
}): CouponRule {
  return {
    discountKind: row.discountKind,
    discountValue: row.discountValue,
    maxDiscountAmount: row.maxDiscount,
    minOrderAmount: row.minOrderAmount,
  };
}

/** 발급건의 만료일 — validDays가 있으면 발급일 기준, 없으면 쿠폰 종료일 */
function resolveIssueExpiry(
  validDays: number | null,
  couponEndsAt: Date | null,
  issuedAt: Date,
): Date | null {
  if (validDays === null) return couponEndsAt;
  const expiresAt = new Date(issuedAt);
  expiresAt.setDate(expiresAt.getDate() + validDays);
  // 쿠폰 자체가 먼저 끝나면 그날이 기한이다 — 종료된 쿠폰을 유효일수로 살려 둘 수 없다
  if (couponEndsAt !== null && couponEndsAt < expiresAt) return couponEndsAt;
  return expiresAt;
}

// ── 발급 ──────────────────────────────────────────────

export type CouponIssueResult = {
  couponIssueId: number;
  expiresAt: Date | null;
};

/**
 * 쿠폰 발급 (다운로드·코드 등록·자동 지급 공통).
 *
 * **수량을 조건부 UPDATE로 먼저 잡는다.** 조회 후 증가는 동시 다운로드에서 수량을 넘긴다 —
 * 100장 한정 쿠폰이 103장 나가면 그 3장은 운영이 떠안는다.
 *
 * 인당 한도 초과면 트랜잭션을 되돌려 **issued_count 증가도 함께 취소**한다.
 * 여기서 롤백하지 않으면 못 받은 사람의 몫만큼 수량이 줄어든다.
 */
export async function issueCouponToCustomer(
  tx: TransactionClient,
  input: { couponId: number; customerId: number },
): Promise<CouponIssueResult> {
  const claimed = await tx
    .update(coupon)
    .set({ issuedCount: sql`${coupon.issuedCount} + 1` })
    .where(
      and(
        eq(coupon.id, input.couponId),
        eq(coupon.isActive, true),
        // 수량 무제한이거나 아직 남았을 때만
        or(isNull(coupon.totalQuantity), sql`${coupon.issuedCount} < ${coupon.totalQuantity}`),
        or(isNull(coupon.startsAt), sql`${coupon.startsAt} <= now()`),
        or(isNull(coupon.endsAt), sql`${coupon.endsAt} >= now()`),
      ),
    )
    .returning({
      couponId: coupon.id,
      validDays: coupon.validDays,
      endsAt: coupon.endsAt,
      perCustomerLimit: coupon.perCustomerLimit,
    });

  if (claimed.length === 0) {
    // 소진·기간만료·비활성 — 어느 쪽인지 구분하려면 다시 조회해야 하는데,
    // 고객이 할 수 있는 일은 어차피 같다(다른 쿠폰을 쓰거나 포기)
    throw new CouponIssueUnavailableError(
      "받을 수 없는 쿠폰이에요. 수량이 모두 소진됐거나 발급 기간이 지났습니다.",
    );
  }
  const claimedCoupon = claimed[0];

  const [issuedRow] = await tx
    .select({ issuedToCustomer: count() })
    .from(couponIssue)
    .where(
      and(
        eq(couponIssue.couponId, input.couponId),
        eq(couponIssue.customerId, input.customerId),
      ),
    );

  if (
    !canIssueMoreToCustomer({
      perCustomerLimit: claimedCoupon.perCustomerLimit,
      alreadyIssuedCount: Number(issuedRow?.issuedToCustomer ?? 0),
    })
  ) {
    // throw로 트랜잭션을 되돌린다 — 위에서 올린 issued_count도 함께 취소된다
    throw new CouponIssueUnavailableError("이미 받으신 쿠폰이에요.");
  }

  const issuedAt = new Date();
  const expiresAt = resolveIssueExpiry(
    claimedCoupon.validDays,
    claimedCoupon.endsAt,
    issuedAt,
  );

  const [created] = await tx
    .insert(couponIssue)
    .values({
      couponId: input.couponId,
      customerId: input.customerId,
      expiresAt,
    })
    .returning({ id: couponIssue.id });

  return { couponIssueId: created.id, expiresAt };
}

// ── 사용 ──────────────────────────────────────────────

/**
 * 주문에 쿠폰을 사용 처리한다. **주문 생성 트랜잭션 안에서** 호출한다 —
 * 주문이 롤백되면 쿠폰도 미사용으로 돌아가야 한다.
 *
 * `used_at IS NULL`이 조건이다. 갱신 0건이면 이미 쓴 쿠폰이므로 **주문을 막는다** —
 * 조회로 확인하고 UPDATE하면 동시 요청 두 건이 같은 쿠폰을 쓴다.
 */
export async function useCouponForOrder(
  tx: TransactionClient,
  input: {
    couponIssueId: number;
    customerId: number;
    orderId: number;
    discountAmount: number;
  },
): Promise<{ used: true }> {
  const updated = await tx
    .update(couponIssue)
    .set({
      usedAt: sql`now()`,
      orderId: input.orderId,
      discountAmount: input.discountAmount,
    })
    .where(
      and(
        eq(couponIssue.id, input.couponIssueId),
        // 남의 쿠폰 id를 넣어도 통하지 않는다
        eq(couponIssue.customerId, input.customerId),
        isNull(couponIssue.usedAt),
      ),
    )
    .returning({ id: couponIssue.id });

  if (updated.length === 0) {
    throw new CouponUseRejectedError(
      "이미 사용했거나 사용할 수 없는 쿠폰이에요. 쿠폰을 다시 선택해 주세요.",
    );
  }
  return { used: true };
}

/**
 * 주문 취소 시 쿠폰을 되돌린다 — `applyOrderTransition`의 cancelled 분기가 부른다.
 *
 * **부분 반품은 여기 오지 않는다.** 쿠폰은 한 장이라 '절반 복원'이 없다.
 * 부분 반품에서는 쿠폰을 그대로 두고 환불액에서 비례 차감한다(설계 결정 ④).
 *
 * 만료된 쿠폰도 되돌린다 — 복원해도 못 쓰지만, 사용 기록만 남겨 두면
 * 고객이 "쓴 적 없는데 사용됨"으로 본다.
 */
export async function restoreOrderCoupon(
  tx: TransactionClient,
  orderId: number,
): Promise<{ restoredCount: number }> {
  const restored = await tx
    .update(couponIssue)
    .set({ usedAt: null, orderId: null, discountAmount: null })
    .where(and(eq(couponIssue.orderId, orderId), isNotNull(couponIssue.usedAt)))
    .returning({ id: couponIssue.id });

  return { restoredCount: restored.length };
}

// ── 조회 ──────────────────────────────────────────────

export type MyCouponCard = {
  couponIssueId: number;
  couponId: number;
  name: string;
  discountKind: "fixed" | "percent";
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  scopeKind: "all" | "category" | "product";
  scopeRefId: number | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  /** 만료됐는지 — 화면이 '사용 가능/사용함/만료' 세 묶음으로 나눈다 */
  isExpired: boolean;
};

const MY_COUPON_SELECTION = {
  couponIssueId: couponIssue.id,
  couponId: coupon.id,
  name: coupon.name,
  discountKind: coupon.type,
  discountValue: coupon.value,
  maxDiscountAmount: coupon.maxDiscount,
  minOrderAmount: coupon.minOrderAmount,
  scopeKind: coupon.scope,
  scopeRefId: coupon.scopeRefId,
  expiresAt: couponIssue.expiresAt,
  usedAt: couponIssue.usedAt,
};

/** 마이페이지 보유 쿠폰 — 사용 가능이 먼저, 그 다음 사용함·만료 */
export async function listCustomerCoupons(
  database: DatabaseClient,
  customerId: number,
): Promise<MyCouponCard[]> {
  const rows = await database
    .select(MY_COUPON_SELECTION)
    .from(couponIssue)
    .innerJoin(coupon, eq(couponIssue.couponId, coupon.id))
    .where(eq(couponIssue.customerId, customerId))
    .orderBy(desc(couponIssue.id));

  const now = new Date();
  return rows.map((row) => ({
    ...row,
    isExpired: row.expiresAt !== null && row.expiresAt < now,
  }));
}

/** 사용 가능한 쿠폰 개수 — 헤더·마이페이지 요약이 쓴다 */
export async function countUsableCoupons(
  database: DatabaseClient,
  customerId: number,
): Promise<number> {
  const [row] = await database
    .select({ usableCount: count() })
    .from(couponIssue)
    .where(
      and(
        eq(couponIssue.customerId, customerId),
        isNull(couponIssue.usedAt),
        or(isNull(couponIssue.expiresAt), gt(couponIssue.expiresAt, sql`now()`)),
      ),
    );
  return Number(row?.usableCount ?? 0);
}

export type CouponIssueForOrder = {
  rule: CouponRule;
  scopeKind: "all" | "category" | "product";
  scopeRefId: number | null;
  couponStartsAt: Date | null;
  couponEndsAt: Date | null;
  issueExpiresAt: Date | null;
  usedAt: Date | null;
};

/**
 * 주문이 쓰려는 쿠폰을 읽는다 — **판정에 필요한 재료만** 모은다.
 *
 * 판정 자체는 도메인(checkCouponUsable)이 한다. 여기서 판정까지 하면 화면 안내와
 * 서버 판정이 다른 코드가 되어 "화면에서는 되는데 주문이 막히는" 상태가 생긴다.
 *
 * 대상 금액(targetAmount)은 범위 계산이 끝나야 나오므로 이 함수가 받지 않는다 —
 * 호출부가 calcCouponScopeTarget으로 구한 뒤 도메인 판정에 함께 넘긴다.
 */
export async function loadCouponIssueForOrder(
  tx: TransactionClient,
  input: { couponIssueId: number; customerId: number },
): Promise<CouponIssueForOrder> {
  const [row] = await tx
    .select({
      ...MY_COUPON_SELECTION,
      couponStartsAt: coupon.startsAt,
      couponEndsAt: coupon.endsAt,
      isActive: coupon.isActive,
    })
    .from(couponIssue)
    .innerJoin(coupon, eq(couponIssue.couponId, coupon.id))
    .where(
      and(
        eq(couponIssue.id, input.couponIssueId),
        // 남의 발급건 id를 알아도 통하지 않는다
        eq(couponIssue.customerId, input.customerId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new CouponUseRejectedError("사용할 수 없는 쿠폰이에요. 쿠폰을 다시 선택해 주세요.");
  }
  if (!row.isActive) {
    throw new CouponUseRejectedError("사용이 중지된 쿠폰이에요.");
  }

  return {
    rule: toCouponRule({
      discountKind: row.discountKind,
      discountValue: row.discountValue,
      maxDiscount: row.maxDiscountAmount,
      minOrderAmount: row.minOrderAmount,
    }),
    scopeKind: row.scopeKind,
    scopeRefId: row.scopeRefId,
    couponStartsAt: row.couponStartsAt,
    couponEndsAt: row.couponEndsAt,
    issueExpiresAt: row.expiresAt,
    usedAt: row.usedAt,
  };
}

export type CouponScopeTarget = {
  /** 쿠폰이 적용되는 상품 금액 — 할인 계산과 최소주문금액 판정이 같은 값을 쓴다 */
  targetAmount: number;
  /** 범위에 걸리는 상품이 주문에 있는가 */
  hasScopeMatch: boolean;
};

/**
 * 범위(scope) 쿠폰의 대상 금액.
 *
 * **최소 주문 금액도 이 값으로 판정한다**(설계 결정 ⑥). 전체 주문 금액을 기준으로 하면
 * "3만원 이상"을 다른 상품으로 채우고 대상 상품 하나에 할인을 받는다.
 *
 * 카테고리 쿠폰은 **하위 카테고리까지** 포함한다 — 스토어 목록에서 대분류를 누르면
 * 하위 상품이 나오므로, 같은 대분류 쿠폰이 그 상품에 안 걸리면 고객이 납득하지 못한다.
 */
export async function calcCouponScopeTarget(
  tx: TransactionClient | DatabaseClient,
  input: {
    scopeKind: "all" | "category" | "product";
    scopeRefId: number | null;
    lines: { productId: number; lineTotal: number }[];
  },
): Promise<CouponScopeTarget> {
  if (input.scopeKind === "all") {
    const targetAmount = input.lines.reduce((sum, line) => sum + line.lineTotal, 0);
    return { targetAmount, hasScopeMatch: input.lines.length > 0 };
  }

  if (input.scopeRefId === null) {
    // 범위 쿠폰인데 대상이 비었다 — 관리자 등록 실수다. 전체 할인으로 오해되지 않게 막는다
    return { targetAmount: 0, hasScopeMatch: false };
  }

  if (input.scopeKind === "product") {
    const matched = input.lines.filter((line) => line.productId === input.scopeRefId);
    return {
      targetAmount: matched.reduce((sum, line) => sum + line.lineTotal, 0),
      hasScopeMatch: matched.length > 0,
    };
  }

  // category — 지정 카테고리 + 하위 카테고리
  const childRows = await tx
    .select({ id: category.id })
    .from(category)
    .where(eq(category.parentId, input.scopeRefId));
  const scopeCategoryIds = [input.scopeRefId, ...childRows.map((row) => row.id)];

  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  if (productIds.length === 0) return { targetAmount: 0, hasScopeMatch: false };

  const mappedRows = await tx
    .selectDistinct({ productId: productCategory.productId })
    .from(productCategory)
    .where(
      and(
        inArray(productCategory.productId, productIds),
        inArray(productCategory.categoryId, scopeCategoryIds),
      ),
    );
  const matchedProductIds = new Set(mappedRows.map((row) => row.productId));

  const matched = input.lines.filter((line) => matchedProductIds.has(line.productId));
  return {
    targetAmount: matched.reduce((sum, line) => sum + line.lineTotal, 0),
    hasScopeMatch: matched.length > 0,
  };
}

export type CheckoutCouponOption = {
  couponIssueId: number;
  name: string;
  /** 이 주문에 적용했을 때 실제로 깎이는 금액 — 화면이 큰 순서로 정렬해 고르게 한다 */
  discountAmount: number;
  usable: boolean;
  /** 못 쓰는 이유 — 목록에서 숨기지 않고 사유를 보여준다(왜 안 되는지 알아야 채운다) */
  unusableReason: string | null;
  expiresAt: Date | null;
  minOrderAmount: number;
};

/**
 * 이 주문에 쓸 수 있는 쿠폰 목록 — 체크아웃 화면이 소비한다.
 *
 * **못 쓰는 쿠폰도 사유와 함께 내린다.** 목록에서 지워 버리면 "분명 쿠폰이 있었는데
 * 안 보인다"가 되고, 최소 주문 금액이 모자란 경우에는 얼마를 더 담아야 하는지 알 수 없다.
 *
 * 이미 사용했거나 만료된 것만 아예 뺀다 — 그건 이 주문의 문제가 아니라 쿠폰이 끝난 것이다.
 */
export async function listCheckoutCoupons(
  database: DatabaseClient,
  input: {
    customerId: number;
    lines: { productId: number; lineTotal: number }[];
  },
): Promise<CheckoutCouponOption[]> {
  const rows = await database
    .select({
      ...MY_COUPON_SELECTION,
      couponStartsAt: coupon.startsAt,
      couponEndsAt: coupon.endsAt,
    })
    .from(couponIssue)
    .innerJoin(coupon, eq(couponIssue.couponId, coupon.id))
    .where(
      and(
        eq(couponIssue.customerId, input.customerId),
        eq(coupon.isActive, true),
        isNull(couponIssue.usedAt),
        // 만료된 발급건은 목록에서 뺀다 — 이 주문으로 해결할 수 있는 게 없다
        or(isNull(couponIssue.expiresAt), gt(couponIssue.expiresAt, sql`now()`)),
      ),
    )
    .orderBy(desc(couponIssue.id));

  const now = new Date();
  const options: CheckoutCouponOption[] = [];

  for (const row of rows) {
    const issueForOrder: CouponIssueForOrder = {
      rule: toCouponRule({
        discountKind: row.discountKind,
        discountValue: row.discountValue,
        maxDiscount: row.maxDiscountAmount,
        minOrderAmount: row.minOrderAmount,
      }),
      scopeKind: row.scopeKind,
      scopeRefId: row.scopeRefId,
      couponStartsAt: row.couponStartsAt,
      couponEndsAt: row.couponEndsAt,
      issueExpiresAt: row.expiresAt,
      usedAt: row.usedAt,
    };
    // 주문 생성과 **같은 계산**을 미리 돌린다 — 화면이 5천원이라 보여 주고 서버가
    // 4천원을 깎으면 결제 금액이 달라진다
    const scopeTarget = await calcCouponScopeTarget(database, {
      scopeKind: row.scopeKind,
      scopeRefId: row.scopeRefId,
      lines: input.lines,
    });
    const resolved = resolveCouponDiscount({ issueForOrder, scopeTarget, now });

    options.push({
      couponIssueId: row.couponIssueId,
      name: row.name,
      discountAmount: resolved.usable ? resolved.discountAmount : 0,
      usable: resolved.usable,
      unusableReason: resolved.usable ? null : resolved.message,
      expiresAt: row.expiresAt,
      minOrderAmount: row.minOrderAmount,
    });
  }

  // 실제로 많이 깎이는 쿠폰이 먼저 — 고객이 계산해서 고르게 하지 않는다
  return options.sort((left, right) => {
    if (left.usable !== right.usable) return left.usable ? -1 : 1;
    return right.discountAmount - left.discountAmount;
  });
}

/**
 * 쿠폰 사용 판정 + 할인액 계산을 한 번에.
 *
 * 주문 생성과 체크아웃 화면이 **같은 함수**를 쓴다 — 화면이 5천원이라고 보여 주고
 * 서버가 4천원을 깎으면 결제 금액이 달라진다.
 */
export function resolveCouponDiscount(input: {
  issueForOrder: CouponIssueForOrder;
  scopeTarget: CouponScopeTarget;
  now?: Date;
}): { usable: true; discountAmount: number } | { usable: false; message: string } {
  const usableCheck = checkCouponUsable({
    rule: input.issueForOrder.rule,
    startsAt: input.issueForOrder.couponStartsAt,
    endsAt: input.issueForOrder.couponEndsAt,
    issueExpiresAt: input.issueForOrder.issueExpiresAt,
    usedAt: input.issueForOrder.usedAt,
    targetAmount: input.scopeTarget.targetAmount,
    hasScopeMatch: input.scopeTarget.hasScopeMatch,
    now: input.now ?? new Date(),
  });
  if (!usableCheck.usable) return { usable: false, message: usableCheck.message };

  return {
    usable: true,
    discountAmount: calcCouponDiscount(
      input.issueForOrder.rule,
      input.scopeTarget.targetAmount,
    ),
  };
}
