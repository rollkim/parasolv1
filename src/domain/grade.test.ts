import { describe, expect, it } from "vitest";

import {
  calcNextGradeGap,
  combinedEarnRatePerMille,
  resolveGradeForSpend,
  type GradeRule,
} from "./grade";

/** 시드와 같은 구성 — 일반 0 / 단골 10만 / VIP 30만 */
const GRADES: GradeRule[] = [
  { gradeId: 1, gradeCode: "basic", gradeName: "일반", bonusRatePerMille: 0, minRecentSpend: 0 },
  { gradeId: 2, gradeCode: "gold", gradeName: "단골", bonusRatePerMille: 10, minRecentSpend: 100_000 },
  { gradeId: 3, gradeCode: "vip", gradeName: "VIP", bonusRatePerMille: 20, minRecentSpend: 300_000 },
];

describe("resolveGradeForSpend", () => {
  it("기준을 만족하는 것 중 가장 높은 기준의 등급", () => {
    expect(resolveGradeForSpend(GRADES, 0)?.gradeCode).toBe("basic");
    expect(resolveGradeForSpend(GRADES, 99_999)?.gradeCode).toBe("basic");
    expect(resolveGradeForSpend(GRADES, 100_000)?.gradeCode).toBe("gold");
    expect(resolveGradeForSpend(GRADES, 299_999)?.gradeCode).toBe("gold");
    expect(resolveGradeForSpend(GRADES, 300_000)?.gradeCode).toBe("vip");
    expect(resolveGradeForSpend(GRADES, 9_999_999)?.gradeCode).toBe("vip");
  });

  it("입력 순서와 무관하다 — 관리자가 기준을 바꿔도 정렬을 믿지 않는다", () => {
    const shuffled = [GRADES[2], GRADES[0], GRADES[1]];
    expect(resolveGradeForSpend(shuffled, 150_000)?.gradeCode).toBe("gold");
  });

  it("등급이 없으면 null — 시드 없는 리스킨 몰에서도 죽지 않는다", () => {
    expect(resolveGradeForSpend([], 100_000)).toBeNull();
  });

  it("모든 기준에 못 미치면 기준이 가장 낮은 등급으로", () => {
    // 기본 등급의 min이 0이 아닌 이상한 구성이어도 어딘가에는 배정된다
    const noZero: GradeRule[] = [
      { gradeId: 2, gradeCode: "gold", gradeName: "단골", bonusRatePerMille: 10, minRecentSpend: 100_000 },
      { gradeId: 3, gradeCode: "vip", gradeName: "VIP", bonusRatePerMille: 20, minRecentSpend: 300_000 },
    ];
    expect(resolveGradeForSpend(noZero, 500)?.gradeCode).toBe("gold");
  });
});

describe("combinedEarnRatePerMille", () => {
  it("기본 적립률 + 등급 보너스", () => {
    expect(combinedEarnRatePerMille(10, GRADES[2])).toBe(30); // 1% + 2% = 3%
    expect(combinedEarnRatePerMille(10, GRADES[0])).toBe(10);
  });

  it("등급이 없으면 기본 적립률 그대로 — 등급은 조건이 아니라 더해 주는 것", () => {
    expect(combinedEarnRatePerMille(10, null)).toBe(10);
  });

  it("음수 보너스는 0으로 — 등급이 적립을 깎는 일은 없다", () => {
    expect(
      combinedEarnRatePerMille(10, { bonusRatePerMille: -5 }),
    ).toBe(10);
  });
});

describe("calcNextGradeGap", () => {
  it("다음 등급까지 남은 금액", () => {
    const gap = calcNextGradeGap(GRADES, 70_000);
    expect(gap?.nextGrade.gradeCode).toBe("gold");
    expect(gap?.remainingSpend).toBe(30_000);
  });

  it("단골이면 다음은 VIP", () => {
    const gap = calcNextGradeGap(GRADES, 150_000);
    expect(gap?.nextGrade.gradeCode).toBe("vip");
    expect(gap?.remainingSpend).toBe(150_000);
  });

  it("최고 등급이면 null — 더 갈 곳이 없다", () => {
    expect(calcNextGradeGap(GRADES, 300_000)).toBeNull();
  });
});
