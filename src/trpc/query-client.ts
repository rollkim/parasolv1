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
        /**
         * 4xx는 재시도하지 않는다 — 없는 주문·권한 없음·잘못된 입력은 다시 보내도 같은 답이다.
         * 기본값(3회 재시도)이면 오류 화면이 뜨기까지 수 초가 걸려 '로딩이 멈춘 것처럼' 보인다.
         * 서버 오류·네트워크 끊김(5xx·상태 없음)만 두 번까지 다시 시도한다.
         */
        retry: (failureCount, error) => {
          const httpStatus = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
          if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) return false;
          return failureCount < 2;
        },
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
