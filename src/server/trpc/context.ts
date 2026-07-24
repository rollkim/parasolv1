import "server-only";

import { db } from "@/db";

/** 비회원 카트 토큰 쿠키 이름 — 발급(카트 라우터)과 판독(컨텍스트)이 공유한다 */
export const CART_COOKIE_NAME = "parasol_cart";

/** Cookie 헤더에서 카트 토큰만 꺼낸다 — 없으면 null(카트 미보유) */
function readCartToken(requestHeaders: Headers): string | null {
  const cookieHeader = requestHeaders.get("cookie");
  if (!cookieHeader) return null;

  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex < 0) continue;
    if (pair.slice(0, separatorIndex).trim() === CART_COOKIE_NAME) {
      return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
    }
  }
  return null;
}

/**
 * 요청마다 생성되는 tRPC 컨텍스트 — 모든 프로시저가 공유한다.
 * db는 전역 풀을 재사용하고, 인증 주체(customerId·adminUserId)는
 * 세션에서 채운다. 인증 구현 전까지는 null이라 protected/admin 미들웨어가 막는다.
 * cartToken은 비회원 카트 식별자 — 쿠키가 없으면 null이고, 발급은 카트 담기 시점에 한다.
 */
export async function createTRPCContext(opts: { headers: Headers }) {
  // TODO(3주차·5주차): 세션/토큰에서 실제 주체를 해석한다. 지금은 경계만 세운다.
  return {
    db,
    customerId: null as number | null,
    adminUserId: null as number | null,
    cartToken: readCartToken(opts.headers),
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
