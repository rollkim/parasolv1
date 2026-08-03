import "server-only";

import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import { coupon, couponIssue } from "@/db/schema";
import type { CouponDiscountKind } from "@/domain/coupon";

import type { DatabaseClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 관리자 쿠폰 관리 (C6).
 *
 * **발급 현황을 목록에서 함께 보여준다.** 쿠폰 목록만 있으면 "몇 장 나갔고 몇 장 쓰였는지"를
 * 알 수 없어 소진 여부를 운영자가 감으로 판단하게 된다.
 */

export const ADMIN_COUPON_PAGE_SIZE = 15;

export class AdminCouponNotFoundError extends Error {
  constructor(readonly couponId: number) {
    super(`쿠폰을 찾을 수 없습니다: id=${couponId}`);
    this.name = "AdminCouponNotFoundError";
  }
}

export class AdminCouponInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminCouponInvalidError";
  }
}

export type AdminCouponRow = {
  couponId: number;
  name: string;
  discountKind: CouponDiscountKind;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  scopeKind: "all" | "category" | "product";
  scopeRefId: number | null;
  issueMethod: "download" | "code" | "auto";
  code: string | null;
  totalQuantity: number | null;
  issuedCount: number;
  perCustomerLimit: number;
  validDays: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  /** 실제로 쓰인 장수 — 발급만 되고 안 쓰이는 쿠폰을 구분한다 */
  usedCount: number;
};

export type AdminCouponListPage = {
  rows: AdminCouponRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

type AdminCouponTab = "all" | "active" | "ended";

/**
 * 쿠폰 목록. 사용 장수는 서브쿼리로 한 번에 가져온다 —
 * 행마다 세면 15행에 15번 왕복한다.
 */
export async function listAdminCoupons(
  database: DatabaseClient,
  input: { tab?: AdminCouponTab; keyword?: string; page?: number } = {},
): Promise<AdminCouponListPage> {
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim() ?? "";

  const tabFilter =
    input.tab === "active"
      ? and(
          eq(coupon.isActive, true),
          or(isNull(coupon.endsAt), sql`${coupon.endsAt} >= now()`),
        )
      : input.tab === "ended"
        ? or(eq(coupon.isActive, false), sql`${coupon.endsAt} < now()`)
        : undefined;

  const keywordFilter =
    keyword.length > 0
      ? or(ilike(coupon.name, "%" + keyword + "%"), ilike(coupon.code, "%" + keyword + "%"))
      : undefined;

  const listFilter = and(tabFilter, keywordFilter);

  const [totalRow] = await database
    .select({ total: count() })
    .from(coupon)
    .where(listFilter);

  const rows = await database
    .select({
      couponId: coupon.id,
      name: coupon.name,
      discountKind: coupon.type,
      discountValue: coupon.value,
      maxDiscountAmount: coupon.maxDiscount,
      minOrderAmount: coupon.minOrderAmount,
      scopeKind: coupon.scope,
      scopeRefId: coupon.scopeRefId,
      issueMethod: coupon.issueMethod,
      code: coupon.code,
      totalQuantity: coupon.totalQuantity,
      issuedCount: coupon.issuedCount,
      perCustomerLimit: coupon.perCustomerLimit,
      validDays: coupon.validDays,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      isActive: coupon.isActive,
      usedCount: sql<number>`(
        select count(*) from ${couponIssue}
        where ${couponIssue.couponId} = ${coupon.id} and ${couponIssue.usedAt} is not null
      )::int`,
    })
    .from(coupon)
    .where(listFilter)
    .orderBy(desc(coupon.id))
    .limit(ADMIN_COUPON_PAGE_SIZE)
    .offset((page - 1) * ADMIN_COUPON_PAGE_SIZE);

  return {
    rows: rows.map((row) => ({ ...row, usedCount: Number(row.usedCount) })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_COUPON_PAGE_SIZE,
  };
}

export type AdminCouponInput = {
  name: string;
  discountKind: CouponDiscountKind;
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  scopeKind: "all" | "category" | "product";
  scopeRefId: number | null;
  issueMethod: "download" | "code" | "auto";
  code: string | null;
  totalQuantity: number | null;
  perCustomerLimit: number;
  validDays: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

/**
 * 저장 전 검증 — **잘못 등록된 쿠폰은 돈이 잘못 나간다.**
 * 화면도 같은 규칙을 먼저 보지만, 화면만 막으면 API 직접 호출로 뚫린다.
 */
function assertCouponInput(input: AdminCouponInput): void {
  if (!input.name.trim()) {
    throw new AdminCouponInvalidError("쿠폰 이름을 입력해 주세요.");
  }
  if (input.discountValue <= 0) {
    throw new AdminCouponInvalidError("할인 값은 0보다 커야 합니다.");
  }
  if (input.discountKind === "percent") {
    // 0.1% 단위 정수다. 1000(=100%)을 넘으면 무료보다 더 깎겠다는 뜻이라 실수다
    if (input.discountValue > 1000) {
      throw new AdminCouponInvalidError(
        "할인율이 100%를 넘습니다. 0.1% 단위로 입력해 주세요(100 = 10%).",
      );
    }
  } else if (input.maxDiscountAmount !== null) {
    // 정액에 상한을 두면 둘 중 작은 값이 적용돼 운영자가 의도한 금액과 달라진다
    throw new AdminCouponInvalidError("정액 쿠폰에는 최대 할인액을 설정할 수 없습니다.");
  }
  if (input.scopeKind !== "all" && input.scopeRefId === null) {
    // 이게 통과하면 "아무에게도 안 걸리는 쿠폰"이 조용히 만들어진다
    throw new AdminCouponInvalidError("범위를 지정한 쿠폰은 대상 카테고리·상품이 필요합니다.");
  }
  if (input.issueMethod === "code" && !input.code?.trim()) {
    throw new AdminCouponInvalidError("코드 등록형 쿠폰은 코드가 필요합니다.");
  }
  if (input.perCustomerLimit < 1) {
    throw new AdminCouponInvalidError("인당 발급 한도는 1 이상이어야 합니다.");
  }
  if (
    input.startsAt !== null &&
    input.endsAt !== null &&
    input.startsAt > input.endsAt
  ) {
    throw new AdminCouponInvalidError("종료일이 시작일보다 빠릅니다.");
  }
  if (input.validDays !== null && input.validDays < 1) {
    throw new AdminCouponInvalidError("유효 기간은 1일 이상이어야 합니다.");
  }
}

/** 코드 중복 확인 — 유니크 인덱스가 막지만, 저장 실패 대신 읽을 수 있는 문구를 준다 */
async function assertCodeAvailable(
  database: DatabaseClient,
  code: string,
  excludeCouponId: number | null,
): Promise<void> {
  const [duplicate] = await database
    .select({ id: coupon.id })
    .from(coupon)
    .where(eq(coupon.code, code))
    .limit(1);
  if (duplicate && duplicate.id !== excludeCouponId) {
    throw new AdminCouponInvalidError("이미 쓰이고 있는 코드입니다. 다른 코드를 입력해 주세요.");
  }
}

export async function createAdminCoupon(
  database: DatabaseClient,
  input: { coupon: AdminCouponInput; actor: TransitionActor },
): Promise<{ couponId: number }> {
  assertCouponInput(input.coupon);
  const normalizedCode = input.coupon.code?.trim() || null;
  if (normalizedCode) await assertCodeAvailable(database, normalizedCode, null);

  const actorText = serializeActor(input.actor);
  const [created] = await database
    .insert(coupon)
    .values({
      name: input.coupon.name.trim(),
      type: input.coupon.discountKind,
      value: input.coupon.discountValue,
      maxDiscount: input.coupon.maxDiscountAmount,
      minOrderAmount: input.coupon.minOrderAmount,
      scope: input.coupon.scopeKind,
      scopeRefId: input.coupon.scopeRefId,
      issueMethod: input.coupon.issueMethod,
      code: normalizedCode,
      totalQuantity: input.coupon.totalQuantity,
      perCustomerLimit: input.coupon.perCustomerLimit,
      validDays: input.coupon.validDays,
      startsAt: input.coupon.startsAt,
      endsAt: input.coupon.endsAt,
      isActive: input.coupon.isActive,
      createdBy: actorText,
      updatedBy: actorText,
    })
    .returning({ id: coupon.id });

  return { couponId: created.id };
}

/**
 * 쿠폰 수정.
 *
 * **이미 발급된 쿠폰의 할인 조건을 바꾸면 발급받은 사람의 혜택이 소급해 바뀐다.**
 * 막지는 않는다(오타 정정·기간 연장은 정당한 운영이다) — 대신 화면이 발급 장수를 보여
 * 운영자가 무엇을 건드리는지 알게 한다. issued_count는 여기서 손대지 않는다:
 * 발급 원장이 진실이고 이 값은 발급 경로만 올린다.
 */
export async function updateAdminCoupon(
  database: DatabaseClient,
  input: { couponId: number; coupon: AdminCouponInput; actor: TransitionActor },
): Promise<{ updated: true }> {
  assertCouponInput(input.coupon);
  const normalizedCode = input.coupon.code?.trim() || null;
  if (normalizedCode) await assertCodeAvailable(database, normalizedCode, input.couponId);

  const updated = await database
    .update(coupon)
    .set({
      name: input.coupon.name.trim(),
      type: input.coupon.discountKind,
      value: input.coupon.discountValue,
      maxDiscount: input.coupon.maxDiscountAmount,
      minOrderAmount: input.coupon.minOrderAmount,
      scope: input.coupon.scopeKind,
      scopeRefId: input.coupon.scopeRefId,
      issueMethod: input.coupon.issueMethod,
      code: normalizedCode,
      totalQuantity: input.coupon.totalQuantity,
      perCustomerLimit: input.coupon.perCustomerLimit,
      validDays: input.coupon.validDays,
      startsAt: input.coupon.startsAt,
      endsAt: input.coupon.endsAt,
      isActive: input.coupon.isActive,
      updatedBy: serializeActor(input.actor),
      updatedAt: sql`now()`,
    })
    .where(eq(coupon.id, input.couponId))
    .returning({ id: coupon.id });

  if (updated.length === 0) throw new AdminCouponNotFoundError(input.couponId);
  return { updated: true };
}

/**
 * 쿠폰 사용 중지 — 삭제하지 않는다.
 *
 * 이미 발급된 쿠폰이 주문에 붙어 있어 지우면 주문 이력이 끊긴다.
 * `is_active = false`면 새 발급·사용이 모두 막히고 기록은 남는다.
 */
export async function deactivateAdminCoupon(
  database: DatabaseClient,
  input: { couponId: number; actor: TransitionActor },
): Promise<{ deactivated: true }> {
  const updated = await database
    .update(coupon)
    .set({
      isActive: false,
      updatedBy: serializeActor(input.actor),
      updatedAt: sql`now()`,
    })
    .where(eq(coupon.id, input.couponId))
    .returning({ id: coupon.id });

  if (updated.length === 0) throw new AdminCouponNotFoundError(input.couponId);
  return { deactivated: true };
}

export async function getAdminCoupon(
  database: DatabaseClient,
  couponId: number,
): Promise<AdminCouponRow> {
  const page = await listAdminCoupons(database, {});
  const found = page.rows.find((row) => row.couponId === couponId);
  if (found) return found;

  // 목록 첫 쪽에 없으면 직접 조회한다(오래된 쿠폰 수정)
  const [row] = await database
    .select({
      couponId: coupon.id,
      name: coupon.name,
      discountKind: coupon.type,
      discountValue: coupon.value,
      maxDiscountAmount: coupon.maxDiscount,
      minOrderAmount: coupon.minOrderAmount,
      scopeKind: coupon.scope,
      scopeRefId: coupon.scopeRefId,
      issueMethod: coupon.issueMethod,
      code: coupon.code,
      totalQuantity: coupon.totalQuantity,
      issuedCount: coupon.issuedCount,
      perCustomerLimit: coupon.perCustomerLimit,
      validDays: coupon.validDays,
      startsAt: coupon.startsAt,
      endsAt: coupon.endsAt,
      isActive: coupon.isActive,
      usedCount: sql<number>`(
        select count(*) from ${couponIssue}
        where ${couponIssue.couponId} = ${coupon.id} and ${couponIssue.usedAt} is not null
      )::int`,
    })
    .from(coupon)
    .where(eq(coupon.id, couponId))
    .limit(1);

  if (!row) throw new AdminCouponNotFoundError(couponId);
  return { ...row, usedCount: Number(row.usedCount) };
}
