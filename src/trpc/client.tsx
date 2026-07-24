"use client";

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import * as React from "react";
import superjson from "superjson";

import type { AppRouter } from "@/server/trpc/routers/_app";

import { makeQueryClient } from "./query-client";

/** useTRPC() 훅과 TRPCProvider를 이 앱의 AppRouter 타입에 묶어 생성한다 */
export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

let browserQueryClient: QueryClient | undefined;

/**
 * 서버는 요청마다 새 QueryClient를, 브라우저는 하나를 재사용한다.
 * 브라우저에서 매번 새로 만들면 첫 렌더에 하이드레이트한 캐시가 버려진다.
 */
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  // 서버 환경: 자기 자신을 절대 URL로 가리킨다
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function TRPCReactProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = getQueryClient();
  const [trpcClient] = React.useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          // transformer는 v11 규약상 서버 init과 이 링크 양쪽에 지정한다
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
