/**
 * 데모 원클릭 배포 — 빌드·패키징 → 업로드 → 서버 배포 → 확인까지 한 번에.
 *
 *   npm run deploy:demo
 *
 * 하는 일 (하나라도 실패하면 그 자리에서 멈춘다 — 반쯤 배포된 상태를 만들지 않는다):
 *   1. npm run pack:release   (빌드 → 반출금지 검사 → tar)
 *   2. scp 로 서버 업로드
 *   3. ssh 로 서버의 ~/deploy.sh 실행 (압축해제 → env 복사 → 슬롯 전환 → PM2 → 자체 확인)
 *   4. 밖에서 https 응답 확인 (Nginx·인증서까지 지나는 진짜 사용자 경로)
 *
 * 비밀번호는 어디에도 저장하지 않는다. 매번 두 번 입력하는 게 싫으면 SSH 키를
 * **한 번만** 등록한다 (PowerShell):
 *
 *   ssh-keygen -t ed25519            # 이미 만들었다면 생략 (질문엔 전부 Enter)
 *   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh parasol@parasol.hesedsoft.co.kr "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
 *
 * 이후로는 암호 입력 없이 끝까지 자동으로 흐른다.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const PROJECT_DIR = path.resolve(import.meta.dirname, "..");
const TARBALL_PATH = path.join(
  path.dirname(PROJECT_DIR),
  "parasol-release",
  "parasol-release.tar.gz",
);
const REMOTE_HOST = "parasol@parasol.hesedsoft.co.kr";
const PUBLIC_CHECK_URL = "https://parasol.hesedsoft.co.kr/robots.txt";

function runStep(stepLabel, command, args, options = {}) {
  console.log(`\n━━ ${stepLabel} ━━`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    // Windows에서 npm 같은 .cmd 실행에 필요하다
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${stepLabel} 실패 — 여기서 중단합니다 (서버는 이전 버전 그대로)`);
    process.exit(1);
  }
}

const startedAt = Date.now();

runStep("1/4 빌드·패키징", "npm", ["run", "pack:release"], { cwd: PROJECT_DIR });

if (!existsSync(TARBALL_PATH)) {
  console.error(`✗ 산출물이 없습니다: ${TARBALL_PATH}`);
  process.exit(1);
}

runStep("2/4 서버 업로드", "scp", [TARBALL_PATH, `${REMOTE_HOST}:/home/parasol/`]);

// bash -lc: 로그인 셸로 실행해 PATH(pm2·node)가 대화형 접속과 같게 잡히도록 한다
runStep("3/4 서버 배포", "ssh", [REMOTE_HOST, "bash -lc '~/deploy.sh'"]);

// 서버 안 확인(deploy.sh의 127.0.0.1 체크)과 별개로, 밖에서 한 번 더 —
// Nginx·인증서·리다이렉트까지 지나는 실제 사용자 경로가 살아 있는지 본다
console.log("\n━━ 4/4 외부 응답 확인 ━━");
try {
  const response = await fetch(PUBLIC_CHECK_URL, { redirect: "follow" });
  if (!response.ok) {
    console.error(`✗ ${PUBLIC_CHECK_URL} → HTTP ${response.status}`);
    console.error("  서버 배포는 끝났지만 밖에서 안 열립니다 — Nginx 로그를 확인하세요.");
    process.exit(1);
  }
  console.log(`✓ ${PUBLIC_CHECK_URL} → HTTP ${response.status}`);
} catch (fetchError) {
  console.error(`✗ 외부 확인 실패: ${fetchError.message}`);
  process.exit(1);
}

const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`\n배포 완료 (${elapsedSeconds}초). 문제가 보이면 서버에서:  ./deploy.sh rollback`);
