import "server-only";

import { db } from "@/db";

/**
 * 요청마다 생성되는 tRPC 컨텍스트 — 모든 프로시저가 공유한다.
 * db는 전역 풀을 재사용하고, 인증 주체(customerId·adminUserId)는
 * 세션에서 채운다. 인증 구현 전까지는 null이라 protected/admin 미들웨어가 막는다.
 */
export async function createTRPCContext(_opts: { headers: Headers }) {
  // TODO(3주차·5주차): 세션/토큰에서 실제 주체를 해석한다. 지금은 경계만 세운다.
  return {
    db,
    customerId: null as number | null,
    adminUserId: null as number | null,
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
