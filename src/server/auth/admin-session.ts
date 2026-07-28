import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

import { readCookieValueFromHeader } from "./session";

/**
 * 관리자 세션 — 고객 세션과 **완전히 분리**한다.
 *
 * 같은 쿠키·같은 클레임 형태를 쓰면 고객 토큰의 sub를 그대로 관리자 id로 읽어
 * 권한 상승이 일어난다. 그래서 세 겹으로 나눈다:
 *   ① 쿠키 이름이 다르다(parasol_admin)
 *   ② 토큰에 aud="admin"을 박고 검증 시 강제한다 — 고객 토큰은 aud가 없어 반드시 실패
 *   ③ 수명이 훨씬 짧다(8시간) — 관리자 화면은 공용 PC에서 열릴 수 있고 권한이 크다
 *
 * 서명 키(AUTH_SECRET)는 공유하지만 aud가 다르므로 토큰은 교차 사용될 수 없다.
 */

export const ADMIN_SESSION_COOKIE_NAME = "parasol_admin";

/**
 * 관리자 세션 8시간 — 근무 시간 단위. 고객 14일보다 훨씬 짧게 두는 이유는
 * 권한 범위(주문·환불·상품)가 크고 공용 단말에서 접속할 가능성이 있기 때문이다.
 */
const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/** 토큰 대상 — 고객 토큰과 섞이지 않게 하는 핵심 장치 */
const ADMIN_TOKEN_AUDIENCE = "admin";

function getSessionSecretKey(): Uint8Array {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "AUTH_SECRET 환경변수가 없거나 32자 미만입니다. .env에 32자 이상 랜덤 문자열을 설정하세요.",
    );
  }
  return new TextEncoder().encode(authSecret);
}

/** 관리자 로그인 성공 시 세션 쿠키 발급 */
export async function issueAdminSessionCookie(adminUserId: number): Promise<void> {
  const sessionJwt = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(adminUserId))
    .setAudience(ADMIN_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE_NAME, sessionJwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // 관리자 쿠키는 /admin 밖으로 나가지 않는다 — 스토어프론트 요청에 실려 노출될 여지를 줄인다.
    // tRPC(/api/trpc)도 써야 하므로 path는 루트로 두되, 대신 aud·이름 분리가 방어를 담당한다.
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * 세션에서 adminUserId를 해석한다. 위조·만료·**고객 토큰**은 전부 null이다.
 * aud 검증이 핵심 — 고객 토큰에는 aud가 없어 여기서 반드시 걸린다.
 */
export async function readAdminSessionUserId(
  cookieHeader?: string | null,
): Promise<number | null> {
  let sessionJwt: string | null;
  if (cookieHeader === undefined) {
    const cookieStore = await cookies();
    sessionJwt = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value ?? null;
  } else {
    sessionJwt = cookieHeader
      ? readCookieValueFromHeader(cookieHeader, ADMIN_SESSION_COOKIE_NAME)
      : null;
  }
  if (!sessionJwt) return null;

  try {
    const { payload } = await jwtVerify(sessionJwt, getSessionSecretKey(), {
      algorithms: ["HS256"],
      audience: ADMIN_TOKEN_AUDIENCE,
    });
    const parsedAdminUserId = Number(payload.sub);
    if (!Number.isInteger(parsedAdminUserId) || parsedAdminUserId <= 0) return null;
    return parsedAdminUserId;
  } catch {
    return null;
  }
}

/** 로그아웃 — 같은 속성(path)으로 덮어써야 브라우저가 확실히 지운다 */
export async function clearAdminSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
