import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 도메인·유틸 + 서버 순수 로직(오류 매핑 등) 단위 테스트 설정.
 * DB·네트워크에 닿는 코드는 대상이 아니다 — 그쪽은 _integration의 check 스크립트가 맡는다.
 *
 * conditions에 react-server를 넣는 이유: 서버 모듈은 `import "server-only"`를 두는데,
 * 이 패키지는 react-server 조건일 때만 빈 모듈이고 기본 진입점은 throw한다.
 * (check 스크립트가 `tsx --conditions=react-server`를 쓰는 것과 같은 이유)
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
    conditions: ["react-server", "node", "import", "default"],
  },
  // node_modules는 외부 의존성으로 처리되어 위 conditions를 타지 않는다 — 별도로 지정한다
  ssr: {
    resolve: {
      conditions: ["react-server", "node", "import", "default"],
      externalConditions: ["react-server", "node", "import", "default"],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
