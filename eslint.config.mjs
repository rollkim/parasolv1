import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 배포용 배치 번들 — esbuild가 만든 CJS 산출물이라 우리 코드 규칙 대상이 아니다
    // (제외하지 않으면 require·this 별칭 등으로 오류 140여 건이 잡혀 진짜 오류를 덮는다)
    "dist-ops/**",
  ]),
]);

export default eslintConfig;
