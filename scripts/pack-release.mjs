/**
 * 배포 묶음 만들기 — 빌드 산출물만 나간다.
 *
 * **허용목록(allowlist) 방식이다.** "빼야 할 것"을 지우는 게 아니라 "넣을 것"만 담는다.
 * 차단목록은 패턴 하나를 빠뜨리면 그대로 새어 나가지만, 허용목록은 빠뜨리면 안 돌아서
 * 바로 들킨다 — 소스·비밀값이 걸린 문제라 실패 방향이 안전한 쪽을 고른다.
 *
 * Next의 standalone 폴더에는 src/·.env까지 섞여 들어온다(추적기가 업로드 경로를
 * 런타임 값으로 계산하는 걸 보고 프로젝트 전체를 필요하다고 판단한다).
 * 그래서 그 폴더를 그대로 쓰지 않고, 여기서 필요한 것만 골라 담은 뒤 검사한다.
 *
 * bash가 아니라 Node로 쓴 이유 — Windows PowerShell에는 `bash`가 없다.
 * 리스킨 판매 시 다른 개발자 PC에서도 그대로 돌아야 한다.
 *
 * 실행: npm run pack:release
 */

import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const PROJECT_DIR = path.resolve(import.meta.dirname, "..");

/** 산출물은 프로젝트 밖에 만든다 — 안에 만들면 다음 빌드 추적에 걸려든다 */
const OUT_DIR = path.join(path.dirname(PROJECT_DIR), "parasol-release");

/**
 * 이름을 고정한다. 날짜를 넣으면 배포할 때마다 손으로 쳐야 하고, 서버에도 릴리스가
 * 무한정 쌓인다. 이전 버전 보관은 서버의 a/b 두 폴더가 맡는다(scripts/server-deploy.sh).
 */
const TARBALL_NAME = "parasol-release.tar.gz";
const INNER_DIR_NAME = "parasol";

/** 배포물에 절대 들어가면 안 되는 것 — 하나라도 걸리면 묶지 않고 멈춘다 */
const FORBIDDEN = [
  /^\.env($|\.)/,
  /\.tsx?$/,
  /\.md$/,
  /^tsconfig.*\.json$/,
  /^drizzle\.config\./,
  /^\.git$/,
];

function run(command, args, label, cwd = PROJECT_DIR) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n  ✗ ${label} 실패`);
    process.exit(1);
  }
}

/** node_modules는 이름으로 거른다 — Next가 `.next/node_modules/`에도 의존성을 심는다 */
async function collectForbidden(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (FORBIDDEN.some((pattern) => pattern.test(entry.name))) {
      found.push(full);
      continue;
    }
    if (entry.isDirectory()) await collectForbidden(full, found);
  }
  return found;
}

/** 리눅스가 아닌 곳에서 빌드하면 그 플랫폼용 네이티브 모듈이 담긴다 */
async function collectForeignNative(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectForeignNative(full, found);
    } else if (entry.name.endsWith(".node") && /win32|darwin/.test(full)) {
      found.push(full);
    }
  }
  return found;
}

console.log("PaRaSOL 릴리스 묶음\n");

// ── 1. 빌드 ────────────────────────────────────────────────────────────────
console.log("[1/5] Next 빌드");
await rm(path.join(PROJECT_DIR, ".next"), { recursive: true, force: true });
run("npm", ["run", "build"], "Next 빌드");

if (!existsSync(path.join(PROJECT_DIR, ".next/standalone"))) {
  console.error("  ✗ standalone 산출물이 없습니다 (next.config.ts의 output 설정 확인)");
  process.exit(1);
}

console.log("\n[2/5] 배치 번들");
run("node", ["scripts/build-ops.mjs"], "배치 번들");

// ── 2. 허용목록 복사 ───────────────────────────────────────────────────────
console.log("\n[3/5] 산출물 선별 복사");
const stageDir = path.join(OUT_DIR, INNER_DIR_NAME);
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

const copyList = [
  // 앱 진입점과 추적된 의존성 (standalone이 만들어 준 것)
  [".next/standalone/server.js", "server.js"],
  [".next/standalone/package.json", "package.json"],
  [".next/standalone/node_modules", "node_modules"],
  [".next/standalone/.next", ".next"],
  // 정적 자산 — standalone에 자동으로 안 담긴다.
  // 빠뜨리면 화면은 뜨는데 CSS·JS가 404가 되어 "디자인이 다 깨졌다"가 된다
  [".next/static", ".next/static"],
  ["public", "public"],
  // 운영 배치 (크론이 실행한다)
  ["dist-ops", "dist-ops"],
  ["scripts/ecosystem.config.cjs", "ecosystem.config.cjs"],
];

for (const [from, to] of copyList) {
  const source = path.join(PROJECT_DIR, from);
  if (!existsSync(source)) {
    if (from === "public") continue; // public은 없을 수도 있다
    console.error(`  ✗ 필요한 산출물이 없습니다: ${from}`);
    process.exit(1);
  }
  // dereference: 심볼릭 링크를 따라가 **내용을 복사**한다.
  // Next는 `.next/node_modules/`에 프로젝트 node_modules를 가리키는 링크를 심는데,
  // 링크째로 담으면 서버에서 존재하지 않는 경로를 가리켜 깨진다
  // (Windows에서는 링크 생성 자체가 관리자 권한이라 EPERM으로 먼저 막힌다).
  await cp(source, path.join(stageDir, to), { recursive: true, dereference: true });
}

await writeFile(
  path.join(stageDir, "VERSION.txt"),
  `${new Date().toISOString()}\n`,
  "utf8",
);

// ── 3. 검사 ────────────────────────────────────────────────────────────────
console.log("\n[4/5] 반출 금지 항목 검사");
const leaked = await collectForbidden(stageDir);
if (leaked.length > 0) {
  console.error("  ✗ 나가면 안 되는 파일이 묶음에 있습니다:");
  for (const file of leaked) console.error(`    ${path.relative(stageDir, file)}`);
  console.error("\n  묶음을 만들지 않고 중단합니다.");
  process.exit(1);
}
console.log("  ✓ 소스·환경설정 없음");

// 실패로 막지는 않는다 — 실제로 호출되지 않는 것이면 그대로도 돌기 때문이다
// (현재 유일한 항목인 sharp는 next/image 전용인데 이 앱은 next/image를 쓰지 않는다).
// 다만 조용히 넘어가면 서버에서 원인 모를 오류로 만나게 되므로 반드시 보여 준다.
const foreignNative = await collectForeignNative(stageDir);
if (foreignNative.length > 0) {
  console.log("  ⚠ 리눅스용이 아닌 네이티브 모듈 (리눅스가 아닌 곳에서 빌드했습니다):");
  for (const file of foreignNative) {
    console.log(`    ${path.relative(stageDir, file)}`);
  }
  console.log("    → 실제로 호출되면 서버에서 실패합니다. pm2 logs로 확인하세요.");
}

// ── 4. 압축 ────────────────────────────────────────────────────────────────
console.log("\n[5/5] 압축");
const tarball = path.join(OUT_DIR, TARBALL_NAME);
await rm(tarball, { force: true });
// tar는 Windows 10 이상과 리눅스에 모두 기본 탑재되어 있다.
// **인자에 절대경로를 넘기지 않는다** — GNU tar는 `C:\...`의 콜론을 원격 호스트
// 지정으로 해석해 "Cannot connect to C" 로 죽는다(Git Bash에서 실제로 겪음).
// 작업 디렉토리를 옮기고 상대 이름만 주면 GNU tar·bsdtar 양쪽에서 동작한다.
run("tar", ["-czf", TARBALL_NAME, INNER_DIR_NAME], "압축", OUT_DIR);
await rm(stageDir, { recursive: true, force: true });

const sizeMb = (statSync(tarball).size / 1024 / 1024).toFixed(1);
console.log(`\n완료: ${tarball}  (${sizeMb}MB)\n`);
console.log("서버로 보내기:");
console.log(`  scp "${tarball}" parasol@parasol.hesedsoft.co.kr:/home/parasol/`);
console.log("서버에서:");
console.log("  ./deploy.sh");
