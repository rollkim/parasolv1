import "server-only";

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

/**
 * 고객 세션 — jose(HS256) 서명 JWT를 httpOnly 쿠키로 보관한다.
 * DB 세션 테이블 없이 서명만으로 검증하므로 저트래픽 전제에 맞고,
 * 시크릿(AUTH_SECRET) 교체 시 전체 세션이 즉시 무효화된다.
 * 발급·삭제는 라우트 핸들러 컨텍스트(뮤테이션)에서만 부른다 — cookies().set 제약.
 */

export const SESSION_COOKIE_NAME = "parasol_session";
// 보안 감사 권고(2026-07-27): 커머스 기준 30일은 길어 14일로 단축.
// 유휴 타임아웃·서버측 무효화(jti)는 별도 결정 사항으로 남김.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14일

/**
 * 서명 키 — 짧은 시크릿은 HS256 무차별 대입에 취약하므로 32자 미만이면 기동을 막는다.
 * 값 자체는 .env에만 존재한다(RULE-1) — 여기서는 키 이름으로만 참조.
 */
function getSessionSecretKey(): Uint8Array {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "AUTH_SECRET 환경변수가 없거나 32자 미만입니다. .env에 32자 이상 랜덤 문자열을 설정하세요. " +
        '생성 예: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return new TextEncoder().encode(authSecret);
}

/** 로그인·가입 성공 시 세션 쿠키 발급 */
export async function issueSessionCookie(customerId: number): Promise<void> {
  const sessionJwt = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(customerId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionJwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Cookie 헤더 문자열에서 지정 쿠키 값을 꺼낸다 — 없으면 null.
 * 위조 쿠키의 깨진 퍼센트 인코딩(예: %zz)에 decodeURIComponent가 URIError를 던지면
 * tRPC 컨텍스트 생성 전체가 500이 되므로, 디코드 실패도 "값 없음"으로 취급한다.
 * 세션·카트 쿠키 판독이 같은 파싱이라 헬퍼 하나를 공유한다.
 */
export function readCookieValueFromHeader(
  cookieHeader: string,
  cookieName: string,
): string | null {
  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) continue;
    if (pair.slice(0, separatorIndex).trim() === cookieName) {
      try {
        return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 세션에서 customerId를 해석한다. 인자를 생략하면 next/headers cookies()에서 읽는다
 * (tRPC 컨텍스트는 Cookie 헤더 문자열을 넘기고, 서버 컴포넌트는 생략 호출).
 * 위조·만료·형식 오류는 전부 "비로그인"일 뿐이므로 throw 하지 않고 null을 돌려준다.
 * 단, AUTH_SECRET 미설정은 설정 오류라 조용히 삼키지 않는다.
 */
export async function readSessionCustomerId(
  cookieHeader?: string | null,
): Promise<number | null> {
  let sessionJwt: string | null;
  if (cookieHeader === undefined) {
    const cookieStore = await cookies();
    sessionJwt = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  } else {
    sessionJwt = cookieHeader
      ? readCookieValueFromHeader(cookieHeader, SESSION_COOKIE_NAME)
      : null;
  }
  if (!sessionJwt) return null;

  const secretKey = getSessionSecretKey();
  try {
    const { payload } = await jwtVerify(sessionJwt, secretKey, {
      algorithms: ["HS256"],
    });
    const parsedCustomerId = Number(payload.sub);
    if (!Number.isInteger(parsedCustomerId) || parsedCustomerId <= 0) return null;
    return parsedCustomerId;
  } catch {
    return null; // 만료·위조·구버전 시크릿 서명 — 전부 비로그인 취급
  }
}

/** 로그아웃 — 같은 속성(path)으로 덮어써야 브라우저가 확실히 지운다 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
