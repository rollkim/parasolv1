import { NextResponse } from "next/server";

import { db } from "@/db";
import { resolvePublicOrigin } from "@/server/http/request-origin";
import { issueSessionCookie } from "@/server/auth/session";
import {
  buildSocialRedirectUri,
  fetchSocialProfile,
  isSocialProviderKey,
} from "@/server/auth/social-provider";
import {
  socialStateCookieOptions,
  SOCIAL_STATE_COOKIE_NAME,
  verifySocialState,
} from "@/server/auth/social-state";
import { loginOrSignupWithSocial } from "@/server/services/social-auth.service";
import { mergeGuestCartIntoCustomer } from "@/server/services/cart.service";
import { CART_COOKIE_NAME } from "@/server/trpc/context";
import { readCookieValueFromHeader } from "@/server/auth/session";

/**
 * 소셜 로그인 콜백 — 제공자가 사용자를 돌려보내는 자리.
 *
 * 순서가 곧 보안이다:
 *   ① state 대조(CSRF)  → ② 코드 교환·프로필 조회 → ③ 계정 찾기/생성 → ④ 세션 발급
 * ①을 건너뛰면 공격자가 피해자를 **공격자 계정으로** 로그인시킬 수 있다.
 *
 * 실패는 전부 /login으로 되돌린다 — 오류 페이지로 보내면 사용자가 처음부터 다시 해야 한다.
 * 실패 원인은 화면에 코드로만 전달하고, 상세는 서버 로그에만 남긴다.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const publicOrigin = resolvePublicOrigin(request);
  const loginUrl = new URL("/login", publicOrigin);

  /** 어떤 경로로 끝나든 state 쿠키는 지운다 — 한 번 쓰면 그만이다(재사용 차단) */
  function redirectWith(targetUrl: URL) {
    const response = NextResponse.redirect(targetUrl);
    response.cookies.set(SOCIAL_STATE_COOKIE_NAME, "", socialStateCookieOptions(0));
    return response;
  }

  if (!isSocialProviderKey(provider)) {
    loginUrl.searchParams.set("socialError", "UNKNOWN_PROVIDER");
    return redirectWith(loginUrl);
  }

  const requestUrl = new URL(request.url);

  // 사용자가 제공자 화면에서 취소한 경우 — 오류가 아니라 정상 이탈이다
  if (requestUrl.searchParams.get("error")) {
    loginUrl.searchParams.set("socialError", "CANCELLED");
    return redirectWith(loginUrl);
  }

  // ── ① state 대조
  const cookieHeader = request.headers.get("cookie");
  const statePayload = await verifySocialState({
    cookieValue: cookieHeader
      ? readCookieValueFromHeader(cookieHeader, SOCIAL_STATE_COOKIE_NAME)
      : null,
    stateFromQuery: requestUrl.searchParams.get("state"),
    providerKey: provider,
  });
  if (!statePayload) {
    loginUrl.searchParams.set("socialError", "STATE_MISMATCH");
    return redirectWith(loginUrl);
  }

  const authorizationCode = requestUrl.searchParams.get("code");
  if (!authorizationCode) {
    loginUrl.searchParams.set("socialError", "NO_CODE");
    return redirectWith(loginUrl);
  }

  try {
    // ── ② 코드 → 토큰 → 프로필 (토큰은 저장하지 않는다)
    const profile = await fetchSocialProfile({
      providerKey: provider,
      code: authorizationCode,
      redirectUri: buildSocialRedirectUri(publicOrigin, provider),
      state: statePayload.stateToken,
    });

    // ── ③ 계정 찾기 / 연결 / 생성
    const forwardedFor = request.headers.get("x-forwarded-for");
    const outcome = await loginOrSignupWithSocial(db, {
      providerKey: provider,
      profile,
      ip: forwardedFor ? forwardedFor.split(",")[0].trim() : null,
    });

    // ── ④ 세션 발급 + 게스트 장바구니 귀속(로컬 로그인과 같은 대우)
    await issueSessionCookie(outcome.customerId);
    const cartToken = cookieHeader
      ? readCookieValueFromHeader(cookieHeader, CART_COOKIE_NAME)
      : null;
    if (cartToken) {
      await mergeGuestCartIntoCustomer(db, {
        cartToken,
        customerId: outcome.customerId,
      });
    }

    const nextUrl = new URL(statePayload.nextPath, publicOrigin);
    // 새 가입·계정 연결은 화면이 안내 문구를 띄운다(그냥 로그인이면 아무 표시 없음)
    if (outcome.isNewCustomer) nextUrl.searchParams.set("welcome", provider);
    else if (outcome.isNewlyLinked) nextUrl.searchParams.set("linked", provider);
    return redirectWith(nextUrl);
  } catch (callbackError) {
    console.error("[social-callback] 실패", { provider, callbackError });
    loginUrl.searchParams.set("socialError", "LOGIN_FAILED");
    return redirectWith(loginUrl);
  }
}
