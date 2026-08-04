import "server-only";

import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";

import { adminUser, loginLog } from "@/db/schema";
import {
  buildOtpauthUri,
  generateTotpSecret,
  verifyTotpCode,
} from "@/server/security/totp";

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
    /** 2단계 인증 코드 — 계정에 TOTP가 켜져 있으면 필수 */
    totpCode?: string | null;
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
      totpSecret: adminUser.totpSecret,
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

  /* 2단계 — 비밀번호가 맞은 뒤에만 요구한다. 코드가 아직 없으면 "코드를 달라"는 상태를
     알린다(오류가 아니라 정상 2단계 흐름). 비밀번호가 틀렸을 때는 TOTP 여부를 알리지
     않는다 — 알리면 비밀번호가 맞았다는 사실이 새어나간다. */
  if (adminRow.totpSecret !== null) {
    if (!input.totpCode) {
      throw new AdminTotpRequiredError();
    }
    const verified = verifyTotpCode({
      secretBase32: adminRow.totpSecret,
      code: input.totpCode,
      nowMs: Date.now(),
    });
    if (!verified) {
      await recordAdminLoginAttempt(database, {
        subjectId: adminRow.adminUserId,
        success: false,
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "인증 코드가 올바르지 않습니다. 앱의 새 코드를 확인해 주세요.",
      });
    }
    /* 재사용 차단 — 같은(또는 이전) 스텝의 코드는 두 번 통하지 않는다(RFC 6238 §5.2).
       조건부 UPDATE라 같은 코드로 동시에 두 로그인이 와도 하나만 통과한다.
       어깨너머로 코드를 본 공격자가 30초 안에 재사용하는 것을 막는 장치다. */
    const claimed = await database
      .update(adminUser)
      .set({ totpLastUsedStep: verified.matchedStep })
      .where(
        and(
          eq(adminUser.id, adminRow.adminUserId),
          sql`(${adminUser.totpLastUsedStep} is null or ${adminUser.totpLastUsedStep} < ${verified.matchedStep})`,
        ),
      )
      .returning({ id: adminUser.id });
    if (claimed.length === 0) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "이미 사용된 인증 코드입니다. 앱의 새 코드를 기다렸다가 입력해 주세요.",
      });
    }
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

// =============================================================
// 2단계 인증(TOTP) — 설정·해제
// =============================================================

/** 비밀번호는 맞았고 인증 코드가 필요한 상태 — 오류가 아니라 정상 2단계 흐름 */
export class AdminTotpRequiredError extends Error {
  constructor() {
    super("2단계 인증 코드가 필요합니다.");
    this.name = "AdminTotpRequiredError";
  }
}

export type TotpSetupMaterial = {
  secretBase32: string;
  /** OTP 앱의 '키 입력'·QR 생성기가 읽는 표준 URI */
  otpauthUri: string;
};

/**
 * 설정 시작 — 시크릿을 만들어 **저장하지 않고** 돌려준다.
 *
 * 코드 확인(confirm) 전에 저장하면 앱 등록을 끝내지 못한 관리자가 다음 로그인부터
 * 잠긴다. 시크릿은 화면이 들고 있다가 confirm에 코드와 함께 다시 온다 — 코드가
 * 맞았다는 것이 곧 "앱에 등록됐다"는 증명이라 그때만 저장한다.
 */
export async function startTotpSetup(
  database: DatabaseClient,
  input: { adminUserId: number; issuer: string },
): Promise<TotpSetupMaterial> {
  const [adminRow] = await database
    .select({ loginId: adminUser.loginId })
    .from(adminUser)
    .where(eq(adminUser.id, input.adminUserId))
    .limit(1);
  if (!adminRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "관리자 계정을 찾을 수 없습니다." });
  }

  const secretBase32 = generateTotpSecret();
  return {
    secretBase32,
    otpauthUri: buildOtpauthUri({
      issuer: input.issuer,
      accountName: adminRow.loginId,
      secretBase32,
    }),
  };
}

/** 설정 확정 — 앱이 만든 코드가 맞아야 저장한다(등록 증명) */
export async function confirmTotpSetup(
  database: DatabaseClient,
  input: { adminUserId: number; secretBase32: string; totpCode: string },
): Promise<{ enabled: true }> {
  const verified = verifyTotpCode({
    secretBase32: input.secretBase32,
    code: input.totpCode,
    nowMs: Date.now(),
  });
  if (!verified) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "인증 코드가 올바르지 않습니다. 앱에 키를 등록한 뒤 새 코드를 입력해 주세요.",
    });
  }

  await database
    .update(adminUser)
    .set({ totpSecret: input.secretBase32, totpLastUsedStep: verified.matchedStep })
    .where(eq(adminUser.id, input.adminUserId));
  return { enabled: true };
}

/**
 * 해제 — 현재 코드를 맞혀야 끈다. 세션 탈취자가 2단계부터 끄는 것을 막는 마지막 문이다.
 */
export async function disableTotp(
  database: DatabaseClient,
  input: { adminUserId: number; totpCode: string },
): Promise<{ disabled: true }> {
  const [adminRow] = await database
    .select({ totpSecret: adminUser.totpSecret })
    .from(adminUser)
    .where(eq(adminUser.id, input.adminUserId))
    .limit(1);
  if (!adminRow?.totpSecret) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "2단계 인증이 켜져 있지 않습니다." });
  }

  const verified = verifyTotpCode({
    secretBase32: adminRow.totpSecret,
    code: input.totpCode,
    nowMs: Date.now(),
  });
  if (!verified) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "인증 코드가 올바르지 않습니다. 해제하려면 현재 코드가 필요합니다.",
    });
  }

  await database
    .update(adminUser)
    .set({ totpSecret: null, totpLastUsedStep: null })
    .where(eq(adminUser.id, input.adminUserId));
  return { disabled: true };
}

/** 설정 화면 상태 표시용 */
export async function getTotpStatus(
  database: DatabaseClient,
  adminUserId: number,
): Promise<{ totpEnabled: boolean }> {
  const [adminRow] = await database
    .select({ totpSecret: adminUser.totpSecret })
    .from(adminUser)
    .where(eq(adminUser.id, adminUserId))
    .limit(1);
  return { totpEnabled: adminRow?.totpSecret != null };
}
