import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import superjson from "superjson";

/**
 * TanStack Query 클라이언트 팩토리.
 * superjson을 (de)hydrate 경계에 물려, 서버에서 프리페치한 데이터가
 * 직렬화 왕복에서 Date 등을 잃지 않고 클라이언트로 넘어오게 한다.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 저트래픽·읽기 위주 — 잠깐의 stale 허용으로 중복 요청을 줄인다
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        // 서버 프리페치가 pending 상태여도 dehydrate에 포함해 스트리밍한다
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  });
}
