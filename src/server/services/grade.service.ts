import "server-only";

import { and, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

import { customer, customerGrade, orders } from "@/db/schema";
import {
  calcNextGradeGap,
  resolveGradeForSpend,
  type GradeRule,
} from "@/domain/grade";

import type { DatabaseClient } from "./db-client";
import { getSiteSetting } from "./site-setting.service";

/**
 * 회원등급 산정 (G3) — 등급의 배정·요약.
 *
 * 판정 규칙은 도메인(resolveGradeForSpend)이 소유한다. 여기는 재료(등급 규칙·최근 구매액)를
 * 모으고 결과를 기록하는 몫만 한다 — 마이페이지 안내와 배치 산정이 같은 판정을 쓰게(RULE-14).
 *
 * 산정 기준: **최근 N일 구매확정 실결제액**(subtotal − 쿠폰 − 적립금 사용). 적립 기준과 같은
 * "실제로 돈이 오간 금액"이다. 확정은 종결 상태라 취소로 되돌아가는 경우를 셈할 필요가 없다.
 */

/** 산정 기간 기본값(일). site_setting `grade_policy.periodDays`로 바꿀 수 있다 */
const DEFAULT_GRADE_PERIOD_DAYS = 90;

export async function loadGradePeriodDays(database: DatabaseClient): Promise<number> {
  const stored = await getSiteSetting(database, "grade_policy");
  if (stored && typeof stored === "object") {
    const candidate = (stored as { periodDays?: unknown }).periodDays;
    if (typeof candidate === "number" && candidate >= 1) return Math.floor(candidate);
  }
  return DEFAULT_GRADE_PERIOD_DAYS;
}

/** 등급 규칙 전체 — 판정 입력. 정렬은 도메인이 다시 하므로 여기서는 신경 쓰지 않는다 */
export async function loadGradeRules(database: DatabaseClient): Promise<GradeRule[]> {
  const rows = await database
    .select({
      gradeId: customerGrade.id,
      gradeCode: customerGrade.code,
      gradeName: customerGrade.name,
      bonusRatePerMille: customerGrade.bonusRate,
      minRecentSpend: customerGrade.minRecentSpend,
    })
    .from(customerGrade);
  return rows;
}

/** 산정 기간 내 구매확정 실결제액 — 회원 한 명 */
export async function calcRecentConfirmedSpend(
  database: DatabaseClient,
  customerId: number,
  periodDays: number,
): Promise<number> {
  const [row] = await database
    .select({
      spendTotal: sql<number>`coalesce(sum(
        greatest(0, ${orders.subtotal} - ${orders.couponDiscount} - ${orders.pointUsed})
      ), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        eq(orders.status, "confirmed"),
        isNotNull(orders.confirmedAt),
        gte(orders.confirmedAt, sql`now() - make_interval(days => ${periodDays})`),
      ),
    );
  return Number(row?.spendTotal ?? 0);
}

export type GradeRecalcReport = {
  scannedCount: number;
  promotedCount: number;
  demotedCount: number;
};

/**
 * 전 회원 등급 재산정 — ops:daily의 ③단계.
 *
 * **바뀌는 회원만 UPDATE한다.** 전원을 매일 덮어쓰면 updated_at이 "마지막으로 실제로
 * 바뀐 때"라는 뜻을 잃는다. grade_id가 null인 회원이 기본 등급 판정을 받으면 그대로
 * null로 둔다 — null = 기본 취급이라는 규약 덕에 첫 실행이 전 회원을 갱신하지 않는다.
 *
 * 훑는 대상도 전 회원이 아니다: **기간 내 확정 구매가 있는 회원 ∪ 등급이 붙어 있는 회원**.
 * 그 밖의 회원은 (구매 없음, 등급 없음) → 기본 판정 → 쓸 것이 없다.
 */
export async function recalculateCustomerGrades(
  database: DatabaseClient,
): Promise<GradeRecalcReport> {
  const gradeRules = await loadGradeRules(database);
  // 등급이 하나도 없는 몰(리스킨 초기)이면 산정할 것이 없다
  if (gradeRules.length === 0) {
    return { scannedCount: 0, promotedCount: 0, demotedCount: 0 };
  }
  const periodDays = await loadGradePeriodDays(database);
  const basicGrade = [...gradeRules].sort((a, b) => a.minRecentSpend - b.minRecentSpend)[0];

  const spendRows = await database
    .select({
      customerId: orders.customerId,
      spendTotal: sql<number>`coalesce(sum(
        greatest(0, ${orders.subtotal} - ${orders.couponDiscount} - ${orders.pointUsed})
      ), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        isNotNull(orders.customerId),
        eq(orders.status, "confirmed"),
        isNotNull(orders.confirmedAt),
        gte(orders.confirmedAt, sql`now() - make_interval(days => ${periodDays})`),
      ),
    )
    .groupBy(orders.customerId);

  const spendByCustomer = new Map<number, number>();
  for (const row of spendRows) {
    if (row.customerId !== null) spendByCustomer.set(row.customerId, Number(row.spendTotal));
  }

  const spendCustomerIds = [...spendByCustomer.keys()];
  const candidates = await database
    .select({ customerId: customer.id, gradeId: customer.gradeId })
    .from(customer)
    .where(
      spendCustomerIds.length > 0
        ? or(inArray(customer.id, spendCustomerIds), isNotNull(customer.gradeId))
        : isNotNull(customer.gradeId),
    );

  const minByGradeId = new Map(gradeRules.map((rule) => [rule.gradeId, rule.minRecentSpend]));
  const targetsByGradeId = new Map<number, number[]>();
  let promotedCount = 0;
  let demotedCount = 0;

  for (const candidate of candidates) {
    const targetGrade = resolveGradeForSpend(
      gradeRules,
      spendByCustomer.get(candidate.customerId) ?? 0,
    );
    if (!targetGrade) continue;

    const isUnchanged =
      candidate.gradeId === targetGrade.gradeId ||
      // null = 기본 취급 — 기본 판정이면 null 그대로 둔다(첫 실행 전원 갱신 방지)
      (candidate.gradeId === null && targetGrade.gradeId === basicGrade.gradeId);
    if (isUnchanged) continue;

    const currentMin =
      candidate.gradeId === null
        ? basicGrade.minRecentSpend
        : (minByGradeId.get(candidate.gradeId) ?? basicGrade.minRecentSpend);
    if (targetGrade.minRecentSpend > currentMin) promotedCount += 1;
    else demotedCount += 1;

    const bucket = targetsByGradeId.get(targetGrade.gradeId) ?? [];
    bucket.push(candidate.customerId);
    targetsByGradeId.set(targetGrade.gradeId, bucket);
  }

  // 목표 등급별로 묶어 한 번에 쓴다 — 회원 수만큼 UPDATE를 날리지 않는다.
  // (customer는 auditTimes만 갖는다 — updated_at은 $onUpdate가 자동으로 찍는다)
  for (const [gradeId, customerIds] of targetsByGradeId) {
    await database
      .update(customer)
      .set({ gradeId })
      .where(inArray(customer.id, customerIds));
  }

  return { scannedCount: candidates.length, promotedCount, demotedCount };
}

export type CustomerGradeSummary = {
  gradeName: string;
  /** 추가 적립률(0.1% 단위) — 화면이 "+1% 추가 적립"으로 그린다 */
  bonusRatePerMille: number;
  /** 산정 기간 내 구매확정 실결제액 */
  recentSpend: number;
  periodDays: number;
  /** 다음 등급 — 최고 등급이면 null */
  nextGradeName: string | null;
  /** 다음 등급까지 남은 금액 — 최고 등급이면 null */
  remainingSpend: number | null;
};

/**
 * 마이페이지 등급 요약.
 *
 * **표시 등급은 저장된 grade_id가 진실이다**(배치가 정한 값). 오늘 구매로 기준을 막
 * 넘겼어도 등급은 다음 산정 때 오른다 — 실시간으로 보여주면 배치 전이 상태와 화면이
 * 갈려 "화면엔 단골인데 적립은 일반"이 된다. 다음 등급 안내만 실시간 구매액으로 계산한다.
 */
export async function getCustomerGradeSummary(
  database: DatabaseClient,
  customerId: number,
): Promise<CustomerGradeSummary | null> {
  const gradeRules = await loadGradeRules(database);
  if (gradeRules.length === 0) return null;

  const periodDays = await loadGradePeriodDays(database);
  const basicGrade = [...gradeRules].sort((a, b) => a.minRecentSpend - b.minRecentSpend)[0];

  const [customerRow] = await database
    .select({ gradeId: customer.gradeId })
    .from(customer)
    .where(eq(customer.id, customerId))
    .limit(1);
  if (!customerRow) return null;

  const currentGrade =
    (customerRow.gradeId !== null
      ? gradeRules.find((rule) => rule.gradeId === customerRow.gradeId)
      : null) ?? basicGrade;

  const recentSpend = await calcRecentConfirmedSpend(database, customerId, periodDays);
  const nextGap = calcNextGradeGap(gradeRules, recentSpend);

  return {
    gradeName: currentGrade.gradeName,
    bonusRatePerMille: currentGrade.bonusRatePerMille,
    recentSpend,
    periodDays,
    nextGradeName: nextGap?.nextGrade.gradeName ?? null,
    remainingSpend: nextGap?.remainingSpend ?? null,
  };
}
