import { NextResponse } from "next/server";

import { resolvePublicOrigin } from "@/server/http/request-origin";
import {
  buildAuthorizeUrl,
  buildSocialRedirectUri,
  isSocialProviderKey,
  SocialProviderNotConfiguredError,
} from "@/server/auth/social-provider";
import {
  createSocialStateToken,
  sanitizeNextPath,
  signSocialState,
  socialStateCookieOptions,
  SOCIAL_STATE_COOKIE_NAME,
  SOCIAL_STATE_MAX_AGE_SECONDS,
} from "@/server/auth/social-state";

/**
 * 소셜 로그인 시작 — 제공자 로그인 화면으로 보낸다.
 *
 * 라우트 핸들러인 이유: 리다이렉트 응답에 **state 쿠키를 함께 실어야** 한다.
 * 클라이언트에서 `location.href`로 보내면 쿠키를 심을 자리가 없다.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const publicOrigin = resolvePublicOrigin(request);
  const loginUrl = new URL("/login", publicOrigin);

  if (!isSocialProviderKey(provider)) {
    loginUrl.searchParams.set("socialError", "UNKNOWN_PROVIDER");
    return NextResponse.redirect(loginUrl);
  }

  const requestUrl = new URL(request.url);
  const nextPath = sanitizeNextPath(requestUrl.searchParams.get("next"));
  const stateToken = createSocialStateToken();

  try {
    const authorizeUrl = buildAuthorizeUrl({
      providerKey: provider,
      redirectUri: buildSocialRedirectUri(publicOrigin, provider),
      state: stateToken,
    });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(
      SOCIAL_STATE_COOKIE_NAME,
      await signSocialState({ stateToken, providerKey: provider, nextPath }),
      socialStateCookieOptions(SOCIAL_STATE_MAX_AGE_SECONDS),
    );
    return response;
  } catch (startError) {
    // 키 미발급은 정상 상태다(계약 전) — 오류 화면 대신 로그인으로 되돌려 안내한다
    if (startError instanceof SocialProviderNotConfiguredError) {
      loginUrl.searchParams.set("socialError", "NOT_CONFIGURED");
      return NextResponse.redirect(loginUrl);
    }
    throw startError;
  }
}
