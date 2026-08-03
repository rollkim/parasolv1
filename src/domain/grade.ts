/**
 * 회원등급 도메인 규칙 — 순수 계산. DB·프레임워크 의존 없음.
 *
 * 등급의 정의(이름·보너스율·기준 금액)는 customer_grade 행이 소유한다 — 여기 함수들은
 * 그 행 목록을 받아 판정만 한다. 숫자를 코드에 적으면 리스킨 때 코드를 고쳐야 한다(RULE-11).
 */

/** customer_grade 행에서 판정에 필요한 것만 추린다 */
export type GradeRule = {
  gradeId: number;
  gradeCode: string;
  gradeName: string;
  /** 추가 적립률 — 0.1% 단위 정수(20 = 2%). 기본 적립률에 더해진다 */
  bonusRatePerMille: number;
  /** 산정 기간 내 구매확정 실결제액이 이 값 이상이면 이 등급. 0이면 기본 등급 */
  minRecentSpend: number;
};

/**
 * 최근 구매액으로 등급을 정한다 — **기준을 만족하는 것 중 가장 높은 기준의 등급**.
 *
 * 정렬을 함수 안에서 다시 한다: 호출부가 정렬해 온다고 믿으면, 관리자가 기준 금액을
 * 역전되게 고쳐 둔 경우(단골 30만 > VIP 10만) 낮은 지출에 높은 등급이 나간다.
 * 등급이 하나도 없으면 null — 리스킨 몰이 시드를 아직 안 넣었어도 죽지 않는다.
 */
export function resolveGradeForSpend(
  grades: GradeRule[],
  recentSpend: number,
): GradeRule | null {
  if (grades.length === 0) return null;
  const eligible = grades.filter((grade) => recentSpend >= Math.max(0, grade.minRecentSpend));
  if (eligible.length === 0) {
    // 어떤 기준에도 못 미치면 기준이 가장 낮은 등급(보통 min 0의 기본 등급)으로
    return [...grades].sort((a, b) => a.minRecentSpend - b.minRecentSpend)[0];
  }
  return eligible.sort((a, b) => b.minRecentSpend - a.minRecentSpend)[0];
}

/**
 * 등급 보너스를 합친 적립률 — 구매 확정 적립이 이 값을 쓴다.
 *
 * 등급이 없으면(null) 기본 적립률 그대로다. 신규 가입 직후·시드 없는 몰에서
 * 적립이 0이 되면 안 된다 — 등급은 **더해 주는 것**이지 조건이 아니다.
 */
export function combinedEarnRatePerMille(
  baseEarnRatePerMille: number,
  grade: Pick<GradeRule, "bonusRatePerMille"> | null,
): number {
  const bonus = grade === null ? 0 : Math.max(0, grade.bonusRatePerMille);
  return Math.max(0, baseEarnRatePerMille) + bonus;
}

/**
 * 다음 등급까지 남은 금액 — 마이페이지 "3만원 더 구매하면 단골" 안내용.
 * 이미 최고 등급이면 null(더 갈 곳이 없다).
 */
export function calcNextGradeGap(
  grades: GradeRule[],
  recentSpend: number,
): { nextGrade: GradeRule; remainingSpend: number } | null {
  const upper = grades
    .filter((grade) => grade.minRecentSpend > Math.max(0, recentSpend))
    .sort((a, b) => a.minRecentSpend - b.minRecentSpend)[0];
  if (!upper) return null;
  return { nextGrade: upper, remainingSpend: upper.minRecentSpend - Math.max(0, recentSpend) };
}
