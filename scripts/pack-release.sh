#!/usr/bin/env bash
#
# 배포 묶음 만들기 — 빌드 산출물만 나간다.
#
# **허용목록(allowlist) 방식이다.** "빼야 할 것"을 지우는 게 아니라 "넣을 것"만 담는다.
# 차단목록은 패턴 하나를 빠뜨리면 그대로 새어 나가지만, 허용목록은 빠뜨리면 안 돌아서
# 바로 들킨다 — 소스·비밀값이 걸린 문제라 실패 방향이 안전한 쪽을 고른다.
#
# Next의 standalone 폴더에는 src/·.env까지 섞여 들어온다(추적기가 업로드 경로를
# 런타임 값으로 계산하는 걸 보고 프로젝트 전체를 필요하다고 판단한다).
# 그래서 그 폴더를 그대로 쓰지 않고, 여기서 필요한 것만 골라 담은 뒤 검사한다.
#
# 실행: WSL2/리눅스에서  bash scripts/pack-release.sh
#   (Windows에서 빌드하면 플랫폼별 SWC 바이너리가 리눅스와 어긋난다)

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

STAMP="$(date +%Y%m%d-%H%M)"
RELEASE_NAME="parasol-${STAMP}"
# 스테이징은 프로젝트 밖에 만든다 — 안에 만들면 다음 빌드 추적에 걸려든다
STAGE_ROOT="$(dirname "$PROJECT_DIR")/parasol-release"
STAGE_DIR="${STAGE_ROOT}/${RELEASE_NAME}"

echo "PaRaSOL 릴리스 묶음 — ${RELEASE_NAME}"
echo

# ── 1. 빌드 ────────────────────────────────────────────────────────────────
echo "[1/5] Next 빌드"
rm -rf .next
npm run build >/dev/null
test -d .next/standalone || { echo "  ✗ standalone 산출물이 없습니다 (next.config.ts의 output 설정 확인)"; exit 1; }

echo "[2/5] 배치 번들"
node scripts/build-ops.mjs >/dev/null
test -f dist-ops/ops-daily.cjs || { echo "  ✗ 배치 번들 실패"; exit 1; }

# ── 2. 허용목록 복사 ───────────────────────────────────────────────────────
echo "[3/5] 산출물 선별 복사"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# 앱 진입점과 추적된 의존성 (standalone이 만들어 준 것)
cp    .next/standalone/server.js    "$STAGE_DIR"/
cp    .next/standalone/package.json "$STAGE_DIR"/
cp -r .next/standalone/node_modules "$STAGE_DIR"/
cp -r .next/standalone/.next        "$STAGE_DIR"/

# 정적 자산 — standalone에 자동으로 안 담기므로 직접 넣는다.
# 빠뜨리면 화면은 뜨는데 CSS·JS가 404가 되어 "디자인이 다 깨졌다"가 된다.
cp -r .next/static "$STAGE_DIR"/.next/static
test -d public && cp -r public "$STAGE_DIR"/public

# 운영 배치 (크론이 실행한다)
cp -r dist-ops "$STAGE_DIR"/dist-ops

cp scripts/ecosystem.config.cjs "$STAGE_DIR"/
echo "$RELEASE_NAME" > "$STAGE_DIR"/VERSION.txt

# ── 3. 검사 — 나가면 안 되는 것이 섞였는지 ────────────────────────────────
# node_modules는 제외한다: 서드파티 패키지에는 원래 .md·.d.ts가 들어 있고,
# 우리가 통제할 대상도 아니다. 우리 프로젝트 파일이 새는지만 본다.
# 이름으로 거르는 이유 — Next가 `.next/node_modules/`에도 의존성을 심는다.
echo "[4/5] 반출 금지 항목 검사"
LEAKED="$(find "$STAGE_DIR" -name "node_modules" -prune -o \
  \( -name ".env" -o -name ".env.*" \
     -o -name "*.ts" -o -name "*.tsx" \
     -o -name "*.md" \
     -o -name "tsconfig*.json" -o -name "drizzle.config.*" \
     -o -name ".git" \) -print)"

if [ -n "$LEAKED" ]; then
  echo "  ✗ 나가면 안 되는 파일이 묶음에 있습니다:"
  echo "$LEAKED" | sed "s|$STAGE_DIR|    |"
  echo
  echo "  묶음을 만들지 않고 중단합니다. 위 파일들을 확인하세요."
  exit 1
fi
echo "  ✓ 소스·환경설정 없음"

# 배포 대상은 리눅스다. 네이티브 바이너리(.node)는 플랫폼별로 다르므로,
# Windows·macOS에서 빌드하면 그 플랫폼용이 담긴다.
# 실패로 막지는 않는다 — 실제로 호출되지 않는 것이면 그대로도 돌기 때문이다
# (현재 유일한 항목인 sharp는 next/image 전용인데 이 앱은 next/image를 쓰지 않는다).
# 다만 조용히 넘어가면 서버에서 원인 모를 오류로 만나게 되므로 반드시 보여 준다.
FOREIGN_NATIVE="$(find "$STAGE_DIR" -name "*.node" \( -path "*win32*" -o -path "*darwin*" \) -print)"
if [ -n "$FOREIGN_NATIVE" ]; then
  echo "  ⚠ 리눅스용이 아닌 네이티브 모듈이 있습니다 (리눅스가 아닌 곳에서 빌드했습니다):"
  echo "$FOREIGN_NATIVE" | sed "s|$STAGE_DIR|    |"
  echo "    → 이 모듈이 실제로 호출되면 서버에서 실패합니다."
  echo "      배포 후 pm2 logs로 확인하고, 문제가 되면 리눅스(WSL2)에서 다시 빌드하세요."
fi

# ── 4. 압축 ────────────────────────────────────────────────────────────────
echo "[5/5] 압축"
TARBALL="${STAGE_ROOT}/${RELEASE_NAME}.tar.gz"
tar -czf "$TARBALL" -C "$STAGE_ROOT" "$RELEASE_NAME"
rm -rf "$STAGE_DIR"

echo
echo "완료: $TARBALL"
echo "      $(du -h "$TARBALL" | cut -f1)"
echo
echo "서버로 보내기:"
echo "  scp \"$TARBALL\" parasol@<서버>:/home/parasol/releases/"
