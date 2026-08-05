import "server-only";

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { and, asc, count, eq, ne } from "drizzle-orm";

import { adminUser } from "@/db/schema";

import type { DatabaseClient } from "./db-client";

/**
 * 관리자 계정 관리 — 목록·생성·비밀번호·권한·활성화.
 *
 * 지금까지 관리자 비밀번호 하나 바꾸는 데 개발자가 SQL을 돌려야 했다(QA에서 실제로 겪음).
 * 리스킨 판매 제품이라 업체 담당자가 직원 계정을 스스로 관리할 수 있어야 한다.
 *
 * 권한 규칙(라우터가 아니라 여기서도 지킨다 — 화면 검증은 방어가 아니다):
 * - 계정 생성·권한 변경·활성/비활성·비밀번호 재발급 = **owner만**
 * - 내 비밀번호 변경 = 본인 누구나(현재 비밀번호 확인 후)
 * - **마지막 활성 owner는 강등도 비활성도 불가** — 잠그면 아무도 계정 관리를 못 하게 된다
 * - **자기 자신은 비활성 불가** — 진행 중인 세션으로 자신을 잠그는 사고 방지
 */

const BCRYPT_ROUNDS = 12;

// ── 오류 — 화면이 사용자 문구로 옮긴다 ──────────────────────────────────────

export class AdminAccountPermissionError extends Error {
  constructor() {
    super("최고관리자(owner)만 할 수 있는 작업입니다.");
    this.name = "AdminAccountPermissionError";
  }
}

export class AdminLoginIdTakenError extends Error {
  constructor(readonly loginId: string) {
    super("이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.");
    this.name = "AdminLoginIdTakenError";
  }
}

export class AdminAccountNotFoundError extends Error {
  constructor() {
    super("관리자 계정을 찾을 수 없습니다.");
    this.name = "AdminAccountNotFoundError";
  }
}

export class LastOwnerProtectedError extends Error {
  constructor() {
    super("마지막 최고관리자는 변경할 수 없습니다. 다른 최고관리자를 먼저 지정해 주세요.");
    this.name = "LastOwnerProtectedError";
  }
}

export class SelfDeactivationError extends Error {
  constructor() {
    super("자기 자신의 계정은 비활성화할 수 없습니다.");
    this.name = "SelfDeactivationError";
  }
}

export class WrongCurrentPasswordError extends Error {
  constructor() {
    super("현재 비밀번호가 일치하지 않습니다.");
    this.name = "WrongCurrentPasswordError";
  }
}

// ── 조회 ────────────────────────────────────────────────────────────────────

export type AdminAccountRow = {
  adminUserId: number;
  loginId: string;
  adminName: string;
  role: "owner" | "manager";
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

export async function listAdminAccounts(
  database: DatabaseClient,
): Promise<AdminAccountRow[]> {
  const rows = await database
    .select({
      adminUserId: adminUser.id,
      loginId: adminUser.loginId,
      adminName: adminUser.name,
      role: adminUser.role,
      isActive: adminUser.isActive,
      totpSecret: adminUser.totpSecret,
      lastLoginAt: adminUser.lastLoginAt,
      createdAt: adminUser.createdAt,
    })
    .from(adminUser)
    .orderBy(asc(adminUser.id));

  return rows.map((row) => ({
    adminUserId: row.adminUserId,
    loginId: row.loginId,
    adminName: row.adminName,
    role: row.role,
    isActive: row.isActive,
    // 시크릿 존재 여부만 내보낸다 — 값은 화면에 갈 이유가 없다
    totpEnabled: row.totpSecret !== null,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  }));
}

// ── 변경 ────────────────────────────────────────────────────────────────────

export type AdminAccountActor = { adminUserId: number; role: string };

function assertOwner(actor: AdminAccountActor): void {
  if (actor.role !== "owner") throw new AdminAccountPermissionError();
}

/** 이 계정을 빼고도 활성 owner가 남는가 — 강등·비활성 전에 반드시 확인 */
async function assertNotLastActiveOwner(
  database: DatabaseClient,
  targetAdminId: number,
): Promise<void> {
  const [remaining] = await database
    .select({ ownerCount: count() })
    .from(adminUser)
    .where(
      and(
        eq(adminUser.role, "owner"),
        eq(adminUser.isActive, true),
        ne(adminUser.id, targetAdminId),
      ),
    );
  if (Number(remaining?.ownerCount ?? 0) === 0) throw new LastOwnerProtectedError();
}

export async function createAdminAccount(
  database: DatabaseClient,
  input: {
    loginId: string;
    password: string;
    adminName: string;
    role: "owner" | "manager";
    actor: AdminAccountActor;
  },
): Promise<{ adminUserId: number }> {
  assertOwner(input.actor);

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  // 유니크 인덱스(admin_login_uq)에 맡기고 충돌만 번역한다 —
  // 선조회는 동시 생성에서 뚫린다(check-then-act)
  const [created] = await database
    .insert(adminUser)
    .values({
      loginId: input.loginId,
      passwordHash,
      name: input.adminName,
      role: input.role,
      createdBy: `admin:${input.actor.adminUserId}`,
    })
    .onConflictDoNothing({ target: adminUser.loginId })
    .returning({ id: adminUser.id });

  if (!created) throw new AdminLoginIdTakenError(input.loginId);
  return { adminUserId: created.id };
}

/** 내 비밀번호 변경 — 세션만으로는 부족하다. 자리 비운 PC에서 남이 바꾸는 것을 현재 비밀번호가 막는다 */
export async function changeMyAdminPassword(
  database: DatabaseClient,
  input: { adminUserId: number; currentPassword: string; newPassword: string },
): Promise<void> {
  const [row] = await database
    .select({ passwordHash: adminUser.passwordHash })
    .from(adminUser)
    .where(eq(adminUser.id, input.adminUserId))
    .limit(1);
  if (!row) throw new AdminAccountNotFoundError();

  const currentMatches = await bcrypt.compare(input.currentPassword, row.passwordHash);
  if (!currentMatches) throw new WrongCurrentPasswordError();

  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
  await database
    .update(adminUser)
    .set({ passwordHash, updatedBy: `admin:${input.adminUserId}` })
    .where(eq(adminUser.id, input.adminUserId));
}

/** 헷갈리는 글자(0/O, 1/l/I)를 뺀 문자셋 — 전화·메신저로 전달할 값이라 오독이 곧 재문의다 */
const TEMP_PASSWORD_CHARSET = "abcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 12;

/**
 * 비밀번호 재발급(owner 전용) — 평문은 반환값으로 한 번만 나간다.
 * 대상의 2FA는 건드리지 않는다 — 비밀번호를 잊은 것과 OTP 기기를 잃은 것은 다른 사고다.
 */
export async function resetAdminPassword(
  database: DatabaseClient,
  input: { targetAdminId: number; actor: AdminAccountActor },
): Promise<{ tempPassword: string; loginId: string }> {
  assertOwner(input.actor);

  const [target] = await database
    .select({ id: adminUser.id, loginId: adminUser.loginId })
    .from(adminUser)
    .where(eq(adminUser.id, input.targetAdminId))
    .limit(1);
  if (!target) throw new AdminAccountNotFoundError();

  const bytes = randomBytes(TEMP_PASSWORD_LENGTH);
  let tempPassword = "";
  for (const byte of bytes) {
    tempPassword += TEMP_PASSWORD_CHARSET[byte % TEMP_PASSWORD_CHARSET.length];
  }

  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
  await database
    .update(adminUser)
    .set({ passwordHash, updatedBy: `admin:${input.actor.adminUserId}` })
    .where(eq(adminUser.id, target.id));

  return { tempPassword, loginId: target.loginId };
}

/**
 * OTP 재설정(owner 전용) — 기기 분실 대응. 시크릿을 지워 "미사용" 상태로 되돌린다.
 * 대상은 다음 로그인부터 OTP 없이 들어와 다시 등록한다.
 */
export async function resetAdminTotp(
  database: DatabaseClient,
  input: { targetAdminId: number; actor: AdminAccountActor },
): Promise<void> {
  assertOwner(input.actor);
  const updatedRows = await database
    .update(adminUser)
    .set({
      totpSecret: null,
      totpLastUsedStep: null,
      updatedBy: `admin:${input.actor.adminUserId}`,
    })
    .where(eq(adminUser.id, input.targetAdminId))
    .returning({ id: adminUser.id });
  if (updatedRows.length === 0) throw new AdminAccountNotFoundError();
}

export async function changeAdminRole(
  database: DatabaseClient,
  input: {
    targetAdminId: number;
    role: "owner" | "manager";
    actor: AdminAccountActor;
  },
): Promise<void> {
  assertOwner(input.actor);
  if (input.role === "manager") {
    // 강등이 마지막 owner를 없애면 계정 관리 자체가 불가능해진다
    await assertNotLastActiveOwner(database, input.targetAdminId);
  }
  const updatedRows = await database
    .update(adminUser)
    .set({ role: input.role, updatedBy: `admin:${input.actor.adminUserId}` })
    .where(eq(adminUser.id, input.targetAdminId))
    .returning({ id: adminUser.id });
  if (updatedRows.length === 0) throw new AdminAccountNotFoundError();
}

export async function changeAdminActive(
  database: DatabaseClient,
  input: { targetAdminId: number; isActive: boolean; actor: AdminAccountActor },
): Promise<void> {
  assertOwner(input.actor);
  if (!input.isActive) {
    if (input.targetAdminId === input.actor.adminUserId) throw new SelfDeactivationError();
    await assertNotLastActiveOwner(database, input.targetAdminId);
  }
  const updatedRows = await database
    .update(adminUser)
    .set({ isActive: input.isActive, updatedBy: `admin:${input.actor.adminUserId}` })
    .where(eq(adminUser.id, input.targetAdminId))
    .returning({ id: adminUser.id });
  if (updatedRows.length === 0) throw new AdminAccountNotFoundError();
}
