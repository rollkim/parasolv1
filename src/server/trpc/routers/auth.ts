import { headers } from "next/headers";
import { z } from "zod";

import {
  clearSessionCookie,
  issueSessionCookie,
} from "@/server/auth/session";
import {
  assertLoginAllowed,
  assertSignupAllowed,
  clearLoginAttempts,
  recordLoginFailure,
} from "@/server/security/rate-limit";
import { mergeGuestCartIntoCustomer } from "@/server/services/cart.service";
import {
  getCustomerSessionProfile,
  signupLocalCustomer,
  verifyLocalLogin,
} from "@/server/services/customer.service";

import { publicProcedure, router } from "../init";

/**
 * 인증 라우터 — zod 검증·세션 쿠키·클라이언트 정보(IP/UA) 등 HTTP 관심사만 다루고,
 * 가입·검증 로직은 customer.service에 위임한다(RULE-14).
 * 소셜 로그인(카카오·네이버·구글)은 키 발급 대기 — UI는 버튼만 두고 준비중 처리.
 */

/** login_log·동의 이력 증빙용 클라이언트 정보 — 프록시(x-forwarded-for) 우선 */
async function readClientRequestInfo(): Promise<{
  clientIp: string | null;
  clientUserAgent: string | null;
}> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const clientIp = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : requestHeaders.get("x-real-ip");
  return { clientIp, clientUserAgent: requestHeaders.get("user-agent") };
}

const loginIdSchema = z
  .string()
  .regex(/^[a-z0-9]{4,20}$/, "아이디는 영문 소문자·숫자 4~20자로 입력해 주세요.");

// bcrypt는 72바이트 초과분을 조용히 잘라내므로 상한을 명시해 착각을 막는다
const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상 입력해 주세요.")
  .max(72, "비밀번호는 72자 이하로 입력해 주세요.");

export const authRouter = router({
  /** 가입 성공 = 즉시 로그인 — 세션 발급 후 들고 있던 게스트 카트를 귀속시킨다 */
  signup: publicProcedure
    .input(
      z.object({
        loginId: loginIdSchema,
        password: passwordSchema,
        name: z.string().trim().min(1, "이름을 입력해 주세요.").max(50),
        email: z.email("이메일 형식이 올바르지 않습니다. 다시 확인해 주세요."),
        phone: z
          .string()
          .transform((rawPhone) => rawPhone.replaceAll("-", ""))
          .pipe(
            z
              .string()
              .regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 올바르지 않습니다."),
          ),
        // 가입 화면에 존재하는 약관만 허용 — 필수 여부 검증은 서비스가 한다
        agreedTermsCodes: z.array(z.enum(["terms", "privacy", "age", "marketing"])),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { clientIp } = await readClientRequestInfo();
      assertSignupAllowed(clientIp);
      const sessionProfile = await signupLocalCustomer(ctx.db, {
        ...input,
        ip: clientIp,
      });

      await issueSessionCookie(sessionProfile.customerId);
      if (ctx.cartToken) {
        await mergeGuestCartIntoCustomer(ctx.db, {
          cartToken: ctx.cartToken,
          customerId: sessionProfile.customerId,
        });
      }
      return sessionProfile;
    }),

  /** 로그인 — 실패 사유는 서비스가 비구분 메시지로 감춘다(계정 열거 방지) */
  login: publicProcedure
    .input(
      z.object({
        // 형식 오류도 "존재하지 않는 계정"과 동일하게 흘려보낸다 — 여기서는 빈 값만 거른다
        loginId: z.string().trim().min(1, "아이디를 입력해 주세요."),
        password: z.string().min(1, "비밀번호를 입력해 주세요."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { clientIp, clientUserAgent } = await readClientRequestInfo();
      // 실패 누적이 한도를 넘으면 자격증명 확인 전에 차단(무차별 대입 방어)
      assertLoginAllowed(input.loginId, clientIp);

      let sessionProfile;
      try {
        sessionProfile = await verifyLocalLogin(ctx.db, {
          ...input,
          ip: clientIp,
          userAgent: clientUserAgent,
        });
      } catch (loginError) {
        // 실패만 카운트해 정상 사용자를 막지 않는다
        recordLoginFailure(input.loginId, clientIp);
        throw loginError;
      }
      // 성공하면 카운터를 비운다
      clearLoginAttempts(input.loginId, clientIp);

      await issueSessionCookie(sessionProfile.customerId);
      if (ctx.cartToken) {
        await mergeGuestCartIntoCustomer(ctx.db, {
          cartToken: ctx.cartToken,
          customerId: sessionProfile.customerId,
        });
      }
      return sessionProfile;
    }),

  /** 로그아웃 — 세션 쿠키만 지운다. 카트 쿠키는 유지(같은 브라우저 재방문 UX) */
  logout: publicProcedure.mutation(async () => {
    await clearSessionCookie();
    return { loggedOut: true };
  }),

  /**
   * 헤더·마이페이지 진입용 세션 상태 — 비로그인·탈퇴·비활성은 전부 null.
   * protectedProcedure가 아닌 이유: 비로그인도 "null"이라는 정상 응답을 받아야 해서.
   */
  sessionInfo: publicProcedure.query(({ ctx }) => {
    if (!ctx.customerId) return null;
    return getCustomerSessionProfile(ctx.db, ctx.customerId);
  }),
});
