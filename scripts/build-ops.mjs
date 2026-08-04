/**
 * 운영 배치를 단일 JS로 번들한다 — 배포 산출물에는 소스도 tsx도 없기 때문이다.
 *
 * 배치는 개발에서 `tsx`로 TypeScript를 직접 실행하지만, standalone 배포에는 `src/`가
 * 가지 않는다. 번들하지 않으면 **서버에서 크론이 아예 안 돈다** — 자동 구매확정이 없으면
 * 구매 적립이 영원히 발생하지 않고(감사에서 이미 한 번 겪은 결함), 적립금 소멸·등급
 * 산정도 멈춘다.
 *
 * 앱 의존성이 전부 순수 JS라(bcryptjs·pg) 번들이 깔끔하게 떨어진다.
 * 실행: node scripts/build-ops.mjs  →  dist-ops/*.js
 */

import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const OPS_ENTRIES = [
  { name: "ops-daily", entry: "src/server/services/_ops/auto-confirm-orders.ts" },
  { name: "ops-reconcile", entry: "src/server/services/_ops/reconcile-payments.ts" },
  { name: "ops-sweep-files", entry: "src/server/services/_ops/sweep-files.ts" },
];

const OUT_DIR = "dist-ops";

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

for (const target of OPS_ENTRIES) {
  await build({
    entryPoints: [target.entry],
    outfile: path.join(OUT_DIR, `${target.name}.cjs`),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    // 의존성까지 통째로 담는다 — 서버에 node_modules를 따로 두지 않기 위해서다.
    // (standalone의 node_modules는 앱 전용이라 배치가 그걸 참조하게 만들면 결합이 생긴다)
    packages: "bundle",
    // "server-only"는 Next 런타임 표식이라 배치에서는 의미가 없다.
    // 그대로 두면 "server-only cannot be imported from a Client Component"로 죽는다
    alias: { "server-only": path.resolve("scripts/stub-server-only.js") },
    minify: false, // 서버에서 오류가 나면 스택을 읽어야 한다 — 배치는 크기보다 진단이 중요
    sourcemap: false,
    logLevel: "warning",
  });
  console.log(`  ✓ ${OUT_DIR}/${target.name}.cjs`);
}

console.log(`\n배치 번들 ${OPS_ENTRIES.length}종 완료.`);
