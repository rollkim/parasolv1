import "server-only";

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import type { TRPCContext } from "./context";

/**
 * tRPC 초기화 — 앱 전역에서 이 인스턴스 하나만 쓴다.
 * transformer(superjson)는 v11 규약상 여기(서버)와 클라이언트 링크 양쪽에 지정한다.
 * Date·Map 같은 값이 JSON 왕복에서 문자열로 뭉개지지 않게 직렬화를 대신한다.
 */
const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/** 누구나 호출 가능 — 상품 조회·사이트 설정 등 공개 데이터 */
export const publicProcedure = t.procedure;

/**
 * 로그인한 고객만 — 주문·마이페이지 등.
 * 인증 로직은 3주차(회원)에서 채운다. 지금은 경계(미들웨어 위치)만 확정한다.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.customerId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다." });
  }
  // customerId가 null이 아님을 하위 프로시저 타입에 좁혀 전달한다
  return next({ ctx: { customerId: ctx.customerId } });
});

/**
 * 관리자만 — 상품 등록·주문 관리 등.
 * 인증 로직은 5주차(관리자)에서 채운다.
 */
export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.adminUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "관리자 권한이 필요합니다." });
  }
  return next({ ctx: { adminUserId: ctx.adminUserId } });
});
