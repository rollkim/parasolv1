import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { db as Database } from "@/db";
import { commonCode } from "@/db/schema";

/**
 * 공통 코드 조회 서비스 — common_code는 여러 도메인(qna_type·carrier·claim_reason…)이
 * 공유하는 코드 사전이라 특정 도메인 서비스에 넣지 않고 별도 모듈로 둔다.
 * 화면 셀렉트·칩 목록이 코드값을 하드코딩하지 않게 하는 단일 통로다(RULE-11 코드값 규약).
 */

type DatabaseClient = typeof Database;

/** code·name은 schema.ts 컬럼명을 그대로 따른다(RULE-10 예외 — 테이블 규약 준수) */
export type CommonCodeOption = {
  code: string;
  name: string;
};

/** 그룹의 활성 코드만 정렬순으로 — 비활성 코드는 화면 선택지에서 제외한다 */
export async function getActiveCommonCodes(
  database: DatabaseClient,
  groupCode: string,
): Promise<CommonCodeOption[]> {
  return database
    .select({ code: commonCode.code, name: commonCode.name })
    .from(commonCode)
    .where(
      and(eq(commonCode.groupCode, groupCode), eq(commonCode.isActive, true)),
    )
    .orderBy(asc(commonCode.sortOrder), asc(commonCode.id));
}
