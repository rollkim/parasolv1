import "server-only";

import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";

import { adminUser, loginLog } from "@/db/schema";

import type { DatabaseClient, QueryClient } from "./db-client";

/**
 * 관리자 인증 — 고객 인증(customer.service)과 분리한다.
 * 대상 테이블(admin_user)·세션 쿠키·권한 체계가 모두 다르고, 섞이면 권한 상승 경로가 된다.
 *
 * 실패 사유(계정 없음 / 비밀번호 틀림 / 비활성)를 구분하지 않는다 —
 * 구분하면 유효한 관리자 아이디를 열거할 수 있다.
 */

/** 계정이 없어도 bcrypt 비교를 1회 수행해 응답 시간으로 계정 유무를 추측하지 못하게 한다 */
const TIMING_EQUALIZER_DUMMY_HASH =
  "$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123456789012";

export type AdminSessionProfile = {
  adminUserId: number;
  name: string;
  role: string;
};

async function recordAdminLoginAttempt(
  database: DatabaseClient,
  attempt: {
    subjectId: number | null;
    success: boolean;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await database.insert(loginLog).values({
    subjectType: "admin",
    subjectId: attempt.subjectId,
    provider: "local",
    success: attempt.success,
    ip: attempt.ip ?? null,
    userAgent: attempt.userAgent ?? null,
  });
}

export async function verifyAdminLogin(
  database: DatabaseClient,
  input: {
    loginId: string;
    password: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<AdminSessionProfile> {
  const [adminRow] = await database
    .select({
      adminUserId: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
      passwordHash: adminUser.passwordHash,
      isActive: adminUser.isActive,
    })
    .from(adminUser)
    .where(eq(adminUser.loginId, input.loginId))
    .limit(1);

  // 계정 유무와 무관하게 항상 1회 비교 — 응답 시간 차이로 계정을 열거하지 못하게 한다
  const passwordMatches = await bcrypt.compare(
    input.password,
    adminRow?.passwordHash ?? TIMING_EQUALIZER_DUMMY_HASH,
  );

  const loginAllowed = adminRow !== undefined && passwordMatches && adminRow.isActive;

  await recordAdminLoginAttempt(database, {
    subjectId: adminRow?.adminUserId ?? null,
    success: loginAllowed,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  if (!loginAllowed || adminRow === undefined) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "아이디 또는 비밀번호가 올바르지 않습니다.",
    });
  }

  await database
    .update(adminUser)
    .set({ lastLoginAt: sql`now()` })
    .where(eq(adminUser.id, adminRow.adminUserId));

  return {
    adminUserId: adminRow.adminUserId,
    name: adminRow.name,
    role: adminRow.role,
  };
}

/**
 * 세션이 가리키는 관리자 프로필 — 세션 JWT가 유효해도 그 사이 비활성 처리됐을 수 있으므로
 * DB 상태로 재확인한다. 없거나 비활성이면 null(= 비로그인 취급).
 */
export async function getAdminSessionProfile(
  client: QueryClient,
  adminUserId: number,
): Promise<AdminSessionProfile | null> {
  const [adminRow] = await client
    .select({
      adminUserId: adminUser.id,
      name: adminUser.name,
      role: adminUser.role,
    })
    .from(adminUser)
    .where(and(eq(adminUser.id, adminUserId), eq(adminUser.isActive, true)))
    .limit(1);

  return adminRow ?? null;
}
