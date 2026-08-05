import { z } from "zod";

import {
  changeAdminActive,
  changeAdminRole,
  changeMyAdminPassword,
  createAdminAccount,
  listAdminAccounts,
  resetAdminPassword,
  resetAdminTotp,
} from "@/server/services/admin-account.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 계정 라우터 — 전부 adminProcedure.
 * owner 판정은 **서비스가 다시 한다** — 화면·라우터 검증은 방어가 아니다(교훈 15).
 * 여기서는 zod와 actor 주입만 한다(RULE-14).
 */

const adminIdSchema = z.number().int().positive();

/** 회원 가입과 같은 규칙 — 관리자라고 아이디 규칙이 느슨할 이유가 없다 */
const adminLoginIdSchema = z
  .string()
  .regex(/^[a-z0-9]{4,20}$/, "아이디는 영문 소문자·숫자 4~20자로 입력해 주세요.");

// bcrypt는 72바이트 초과분을 조용히 잘라내므로 상한을 명시한다
const adminPasswordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상 입력해 주세요.")
  .max(72, "비밀번호는 72자 이하로 입력해 주세요.");

export const adminAccountRouter = router({
  /** 계정 목록 — 시크릿은 나가지 않는다(2FA는 사용 여부만) */
  list: adminProcedure.query(({ ctx }) => listAdminAccounts(ctx.db)),

  /** 내 계정·권한 — 화면이 owner 전용 버튼을 숨길 때 쓴다(진짜 차단은 서비스) */
  myAccount: adminProcedure.query(({ ctx }) => ({
    adminUserId: ctx.adminProfile.adminUserId,
    adminName: ctx.adminProfile.name,
    role: ctx.adminProfile.role,
  })),

  create: adminProcedure
    .input(
      z.object({
        loginId: adminLoginIdSchema,
        password: adminPasswordSchema,
        adminName: z.string().trim().min(1, "이름을 입력해 주세요.").max(50),
        role: z.enum(["owner", "manager"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        createAdminAccount(ctx.db, {
          ...input,
          actor: { adminUserId: ctx.adminUserId, role: ctx.adminProfile.role },
        }),
      ),
    ),

  changeMyPassword: adminProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1, "현재 비밀번호를 입력해 주세요."),
        newPassword: adminPasswordSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        changeMyAdminPassword(ctx.db, { adminUserId: ctx.adminUserId, ...input }),
      ),
    ),

  /** 비밀번호 재발급 — 평문은 이 응답 한 번뿐이다(저장은 해시만) */
  resetPassword: adminProcedure
    .input(z.object({ targetAdminId: adminIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        resetAdminPassword(ctx.db, {
          targetAdminId: input.targetAdminId,
          actor: { adminUserId: ctx.adminUserId, role: ctx.adminProfile.role },
        }),
      ),
    ),

  /** OTP 재설정 — 기기 분실 대응. 다음 로그인부터 다시 등록한다 */
  resetTotp: adminProcedure
    .input(z.object({ targetAdminId: adminIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        resetAdminTotp(ctx.db, {
          targetAdminId: input.targetAdminId,
          actor: { adminUserId: ctx.adminUserId, role: ctx.adminProfile.role },
        }),
      ),
    ),

  changeRole: adminProcedure
    .input(z.object({ targetAdminId: adminIdSchema, role: z.enum(["owner", "manager"]) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        changeAdminRole(ctx.db, {
          ...input,
          actor: { adminUserId: ctx.adminUserId, role: ctx.adminProfile.role },
        }),
      ),
    ),

  changeActive: adminProcedure
    .input(z.object({ targetAdminId: adminIdSchema, isActive: z.boolean() }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        changeAdminActive(ctx.db, {
          ...input,
          actor: { adminUserId: ctx.adminUserId, role: ctx.adminProfile.role },
        }),
      ),
    ),
});
