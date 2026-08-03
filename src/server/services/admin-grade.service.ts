import "server-only";

import { eq, sql } from "drizzle-orm";

import { customer, customerGrade } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 관리자 등급 기준 관리 (G4) — 등급별 보너스 적립률·승급 기준 금액 편집.
 *
 * 등급 행 자체를 만들고 지우는 UI는 두지 않는다. 등급 수는 리스킨 시드가 정하는
 * 구조(3단계)이고, 운영 중 등급을 지우면 그 등급을 단 회원의 FK가 끊긴다.
 * 운영자가 만지는 것은 **이름·보너스율·기준 금액** 세 가지다.
 */

export class AdminGradeInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminGradeInvalidError";
  }
}

export class AdminGradeNotFoundError extends Error {
  constructor(readonly gradeId: number) {
    super(`등급을 찾을 수 없습니다: id=${gradeId}`);
    this.name = "AdminGradeNotFoundError";
  }
}

export type AdminGradeRow = {
  gradeId: number;
  gradeCode: string;
  gradeName: string;
  bonusRatePerMille: number;
  minRecentSpend: number;
  /** 이 등급이 배정된 회원 수 — 기준을 바꾸면 몇 명이 영향을 받는지 보여준다 */
  memberCount: number;
};

export async function listAdminGrades(database: DatabaseClient): Promise<AdminGradeRow[]> {
  const rows = await database
    .select({
      gradeId: customerGrade.id,
      gradeCode: customerGrade.code,
      gradeName: customerGrade.name,
      bonusRatePerMille: customerGrade.bonusRate,
      minRecentSpend: customerGrade.minRecentSpend,
      memberCount: sql<number>`(
        select count(*) from ${customer}
        where ${customer.gradeId} = ${customerGrade.id} and ${customer.deletedAt} is null
      )::int`,
    })
    .from(customerGrade)
    .orderBy(customerGrade.minRecentSpend, customerGrade.sortOrder);

  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

/**
 * 등급 기준 저장.
 *
 * **여기 숫자가 적립률을 바꾼다** — 보너스율 상한을 서버가 다시 본다(화면만 막으면
 * API 직접 호출로 뚫린다). 기준 금액 역전(단골 30만 > VIP 10만)은 막지 않는다:
 * 판정 도메인이 금액 기준으로 다시 정렬하므로 사고가 아니라 순서 재정의가 된다.
 * 다음 산정(ops:daily)부터 반영된다는 사실은 화면이 안내한다.
 */
export async function updateAdminGrade(
  database: DatabaseClient,
  input: {
    gradeId: number;
    gradeName: string;
    bonusRatePerMille: number;
    minRecentSpend: number;
    actor: TransitionActor;
  },
): Promise<{ updated: true }> {
  if (!input.gradeName.trim()) {
    throw new AdminGradeInvalidError("등급 이름을 입력해 주세요.");
  }
  if (input.bonusRatePerMille < 0 || input.bonusRatePerMille > 200) {
    // 20%를 넘는 추가 적립은 실수일 가능성이 압도적이다(0.1% 단위를 %로 착각)
    throw new AdminGradeInvalidError(
      "추가 적립률은 0~20% 범위여야 합니다. 0.1% 단위로 입력해 주세요(10 = 1%).",
    );
  }
  if (input.minRecentSpend < 0) {
    throw new AdminGradeInvalidError("기준 금액은 0원 이상이어야 합니다.");
  }

  const updated = await database
    .update(customerGrade)
    .set({
      name: input.gradeName.trim(),
      bonusRate: input.bonusRatePerMille,
      minRecentSpend: input.minRecentSpend,
      updatedBy: serializeActor(input.actor),
      updatedAt: sql`now()`,
    })
    .where(eq(customerGrade.id, input.gradeId))
    .returning({ id: customerGrade.id });

  if (updated.length === 0) throw new AdminGradeNotFoundError(input.gradeId);
  return { updated: true };
}
