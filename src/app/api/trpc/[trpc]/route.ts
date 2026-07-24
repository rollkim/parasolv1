import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/routers/_app";

/**
 * tRPC HTTP 입구 — 모든 클라이언트 요청이 /api/trpc/* 로 들어와 여기서 라우터로 라우팅된다.
 * App Router는 Web 표준 Request/Response 기반 fetch 어댑터를 쓴다.
 * GET·POST를 같은 핸들러로 노출한다(쿼리는 GET, 뮤테이션은 POST 배치).
 */
function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
  });
}

export { handler as GET, handler as POST };
