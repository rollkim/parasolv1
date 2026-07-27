import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 순수 도메인·유틸 단위 테스트 전용 설정.
 * DB·네트워크 없는 로직만 대상으로 한다(server-only 모듈은 여기서 임포트하지 않는다).
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
