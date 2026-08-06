import "server-only";

import { randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import type { SocialProviderKey } from "./social-provider";

/**
 * 소셜 로그인 CSRF 방어(state) + 복귀 경로 보존.
 *
 * **왜 필요한가**: 콜백은 누구나 부를 수 있는 공개 주소다. state 대조가 없으면
 * 공격자가 자기 인가 코드로 피해자 브라우저의 콜백을 호출해 **피해자를 공격자 계정에
 * 로그인시킬 수 있다**(로그인 CSRF). 그 상태로 피해자가 주문하면 배송지·주문 내역이
 * 공격자 계정에 남는다.
 *
 * 방식: 난수 state를 만들어 ① 제공자에게 쿼리로 보내고 ② 서명 쿠키에도 담는다.
 * 콜백에서 둘이 같아야 통과한다 — 공격자는 피해자 브라우저의 쿠키를 만들 수 없다.
 *
 * 복귀 경로(next)를 **쿼리가 아니라 이 쿠키에** 싣는 이유: 쿼리로 왕복시키면
 * 제공자를 거쳐 돌아오는 사이 값이 바뀔 수 있고, 그대로 리다이렉트하면
 * 오픈 리다이렉트가 된다. 쿠키는 우리가 서명했으므로 위조되지 않는다.
 */

export const SOCIAL_STATE_COOKIE_NAME = "parasol_oauth_state";

/** 로그인 창에서 머무는 시간만 유효하면 된다 — 길게 두면 재사용 여지만 늘어난다 */
const SOCIAL_STATE_MAX_AGE_SECONDS = 10 * 60;

function getStateSecretKey(): Uint8Array {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "AUTH_SECRET 환경변수가 없거나 32자 미만입니다. .env에 32자 이상 랜덤 문자열을 설정하세요.",
    );
  }
  return new TextEncoder().encode(authSecret);
}

export type SocialStatePayload = {
  stateToken: string;
  providerKey: SocialProviderKey;
  /** 로그인 후 돌아갈 내부 경로 — 저장 전에 이미 검증된 값만 넣는다 */
  nextPath: string;
};

/** 외부 주소로 튕겨나가지 않게 — "/"로 시작하되 "//"(스킴 생략 외부주소)는 거절 */
export function sanitizeNextPath(rawNextPath: string | null): string {
  if (!rawNextPath) return "/";
  if (!rawNextPath.startsWith("/") || rawNextPath.startsWith("//")) return "/";
  return rawNextPath;
}

export function createSocialStateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** state 쿠키 값(서명 JWT)을 만든다 — 쿠키 부착은 라우트가 응답에 직접 한다 */
export async function signSocialState(payload: SocialStatePayload): Promise<string> {
  return new SignJWT({
    providerKey: payload.providerKey,
    nextPath: payload.nextPath,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.stateToken)
    .setIssuedAt()
    .setExpirationTime(`${SOCIAL_STATE_MAX_AGE_SECONDS}s`)
    .sign(getStateSecretKey());
}

/**
 * 콜백에서 검증 — 서명·만료·제공자·state 일치를 모두 본다.
 * 하나라도 어긋나면 null(호출부가 로그인 화면으로 되돌린다).
 */
export async function verifySocialState(input: {
  cookieValue: string | null;
  stateFromQuery: string | null;
  providerKey: SocialProviderKey;
}): Promise<SocialStatePayload | null> {
  if (!input.cookieValue || !input.stateFromQuery) return null;

  try {
    const { payload } = await jwtVerify(input.cookieValue, getStateSecretKey());
    const stateToken = typeof payload.sub === "string" ? payload.sub : null;
    const providerKey = payload.providerKey;
    const nextPath = payload.nextPath;

    if (!stateToken || stateToken !== input.stateFromQuery) return null;
    // 제공자까지 대조한다 — 카카오 창에서 받은 state를 구글 콜백에 넣는 교차 사용 차단
    if (providerKey !== input.providerKey) return null;

    return {
      stateToken,
      providerKey: input.providerKey,
      nextPath: sanitizeNextPath(typeof nextPath === "string" ? nextPath : null),
    };
  } catch {
    // 서명 불일치·만료 — 정상 사용자에게도 드물게 일어난다(창을 오래 열어둔 경우)
    return null;
  }
}

/** 쿠키 옵션 — 세션 쿠키와 같은 기준(운영에서만 Secure) */
export function socialStateCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export { SOCIAL_STATE_MAX_AGE_SECONDS };
