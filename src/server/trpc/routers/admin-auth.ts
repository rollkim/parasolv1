import { getBusinessInfo } from "@/server/services/site-setting.service";
import { headers } from "next/headers";
import { z } from "zod";

import {
  clearAdminSessionCookie,
  issueAdminSessionCookie,
} from "@/server/auth/admin-session";
import {
  assertAdminLoginAllowed,
  clearAdminLoginAttempts,
  recordAdminLoginFailure,
} from "@/server/security/rate-limit";
import {
  AdminTotpRequiredError,
  confirmTotpSetup,
  disableTotp,
  getTotpStatus,
  startTotpSetup,
  verifyAdminLogin,
} from "@/server/services/admin-auth.service";

import { adminProcedure, publicProcedure, router } from "../init";

/**
 * 관리자 인증 라우터 — 로그인·로그아웃·현재 세션.
 *
 * 로그인은 publicProcedure다(아직 세션이 없다). 나머지는 adminProcedure로 막는다.
 * 고객 인증(auth 라우터)과 분리한 이유는 admin-auth.service 주석 참조.
 */

export const adminAuthRouter = router({
  /** 관리자 셸이 부르는 현재 세션 — 비로그인이면 null(로그인 화면으로 보낸다) */
  getSession: publicProcedure.query(({ ctx }) =>
    ctx.adminUserId === null ? null : { adminUserId: ctx.adminUserId },
  ),

  login: publicProcedure
    .input(
      z.object({
        loginId: z.string().trim().min(1, "아이디를 입력해 주세요.").max(50),
        password: z.string().min(1, "비밀번호를 입력해 주세요.").max(200),
        totpCode: z.string().trim().max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const requestHeaders = await headers();
      const forwardedFor = requestHeaders.get("x-forwarded-for");
      const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;

      // 시도 전 게이트 — 한도를 넘었으면 비밀번호 비교조차 하지 않는다
      assertAdminLoginAllowed(input.loginId, clientIp);

      try {
        const adminProfile = await verifyAdminLogin(ctx.db, {
          loginId: input.loginId,
          password: input.password,
          totpCode: input.totpCode,
          ip: clientIp,
          userAgent: requestHeaders.get("user-agent"),
        });
        clearAdminLoginAttempts(input.loginId, clientIp);
        await issueAdminSessionCookie(adminProfile.adminUserId);
        return { requiresTotp: false as const, name: adminProfile.name, role: adminProfile.role };
      } catch (loginError) {
        // 비밀번호는 맞았고 코드만 필요한 상태 — 실패가 아니라 2단계 진입이다.
        // 실패로 세면 정상 로그인 절차가 레이트리밋을 소모한다
        if (loginError instanceof AdminTotpRequiredError) {
          return { requiresTotp: true as const };
        }
        recordAdminLoginFailure(input.loginId, clientIp);
        throw loginError;
      }
    }),

  logout: adminProcedure.mutation(async () => {
    await clearAdminSessionCookie();
    return { ok: true };
  }),

  /** 2단계 인증 상태 — 설정 화면 표시용 */
  totpStatus: adminProcedure.query(({ ctx }) => getTotpStatus(ctx.db, ctx.adminUserId)),

  /** 설정 시작 — 시크릿은 저장하지 않고 돌려준다(코드 확인 전에 저장하면 로그인이 잠긴다) */
  startTotpSetup: adminProcedure.mutation(async ({ ctx }) => {
    const businessInfo = await getBusinessInfo(ctx.db);
    return startTotpSetup(ctx.db, {
      adminUserId: ctx.adminUserId,
      // 브랜드명이 OTP 앱 목록에 보인다 — 리스킨 몰마다 제 이름(RULE-11)
      issuer: businessInfo.brandName || "PaRaSOL",
    });
  }),

  /** 설정 확정 — 앱 코드가 맞아야 저장된다(등록 증명) */
  confirmTotpSetup: adminProcedure
    .input(
      z.object({
        secretBase32: z.string().trim().regex(/^[A-Z2-7]{16,64}$/, "잘못된 설정 요청입니다."),
        totpCode: z.string().trim().min(6).max(10),
      }),
    )
    .mutation(({ ctx, input }) =>
      confirmTotpSetup(ctx.db, { adminUserId: ctx.adminUserId, ...input }),
    ),

  /** 해제 — 현재 코드를 맞혀야 끈다(세션 탈취자가 2단계부터 끄는 것을 막는다) */
  disableTotp: adminProcedure
    .input(z.object({ totpCode: z.string().trim().min(6).max(10) }))
    .mutation(({ ctx, input }) =>
      disableTotp(ctx.db, { adminUserId: ctx.adminUserId, ...input }),
    ),
});
