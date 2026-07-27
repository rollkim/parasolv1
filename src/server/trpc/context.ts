import "server-only";

import { db } from "@/db";
import {
  readCookieValueFromHeader,
  readSessionCustomerId,
} from "@/server/auth/session";

/** 비회원 카트 토큰 쿠키 이름 — 발급(카트 라우터)과 판독(컨텍스트)이 공유한다 */
export const CART_COOKIE_NAME = "parasol_cart";

/**
 * Cookie 헤더에서 카트 토큰만 꺼낸다 — 없으면 null(카트 미보유).
 * 깨진 퍼센트 인코딩도 null — 판독 실패로 컨텍스트 생성을 500으로 만들지 않는다.
 */
function readCartToken(requestHeaders: Headers): string | null {
  const cookieHeader = requestHeaders.get("cookie");
  return cookieHeader
    ? readCookieValueFromHeader(cookieHeader, CART_COOKIE_NAME)
    : null;
}

/**
 * 프록시 뒤 실제 클라이언트 IP — 레이트리밋 키·동의 증빙에 쓴다.
 * 프로시저가 next/headers의 headers()를 직접 부르면 요청 스코프 밖(서버 컴포넌트 caller·
 * 배치·검증 스크립트)에서 throw한다. 요청 정보는 컨텍스트가 소유한다.
 */
function readClientIp(requestHeaders: Headers): string | null {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : null;
}

/**
 * 요청마다 생성되는 tRPC 컨텍스트 — 모든 프로시저가 공유한다.
 * db는 전역 풀을 재사용하고, customerId는 세션 쿠키(JWT)에서 해석한다 —
 * 비로그인·만료·위조는 전부 null이라 protectedProcedure가 막는다.
 * cartToken은 비회원 카트 식별자 — 쿠키가 없으면 null이고, 발급은 카트 담기 시점에 한다.
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  // TODO(5주차): adminUserId를 관리자 세션에서 해석한다. 지금은 경계만 세운다.
  return {
    db,
    customerId: await readSessionCustomerId(opts.headers.get("cookie")),
    adminUserId: null as number | null,
    cartToken: readCartToken(opts.headers),
    clientIp: readClientIp(opts.headers),
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
