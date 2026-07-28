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
import { verifyAdminLogin } from "@/server/services/admin-auth.service";

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
          ip: clientIp,
          userAgent: requestHeaders.get("user-agent"),
        });
        clearAdminLoginAttempts(input.loginId, clientIp);
        await issueAdminSessionCookie(adminProfile.adminUserId);
        return { name: adminProfile.name, role: adminProfile.role };
      } catch (loginError) {
        recordAdminLoginFailure(input.loginId, clientIp);
        throw loginError;
      }
    }),

  logout: adminProcedure.mutation(async () => {
    await clearAdminSessionCookie();
    return { ok: true };
  }),
});
