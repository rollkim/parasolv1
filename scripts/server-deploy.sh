#!/usr/bin/env bash
#
# 서버 배포 스크립트 — `parasol` 계정 홈(`~/deploy.sh`)에 한 번 만들어 두고 계속 쓴다.
# (이 파일은 저장소 보관용 원본이다. 서버에 이 내용을 복사해 두면 된다)
#
# 릴리스 폴더는 **a·b 둘뿐**이고 번갈아 쓴다. 새 배포는 지금 안 쓰는 쪽에 풀고
# 링크만 옮기므로, **항상 직전 버전 하나가 남는다**. 날짜를 손으로 칠 일이 없고
# 서버에 릴리스가 쌓이지도 않는다. 소스 이력은 git이 맡는다.
#
#   ~/releases/a  ┐
#   ~/releases/b  ┴─ ~/current 가 둘 중 하나를 가리킨다
#
# 사용:
#   ./deploy.sh            새 tar를 배포
#   ./deploy.sh rollback   직전 버전으로 되돌리기

set -euo pipefail

HOME_DIR="/home/parasol"
TARBALL="$HOME_DIR/parasol-release.tar.gz"
ENV_FILE="$HOME_DIR/shared/parasol.env"
CURRENT_LINK="$HOME_DIR/current"
PM2_NAME="parasol-demo"

mkdir -p "$HOME_DIR/releases" "$HOME_DIR/shared/uploads" "$HOME_DIR/shared/logs"

# 지금 가리키는 쪽을 보고 반대쪽을 고른다
live_slot() {
  if [ -L "$CURRENT_LINK" ] && [ "$(readlink -f "$CURRENT_LINK")" = "$HOME_DIR/releases/a" ]; then
    echo a
  else
    echo b
  fi
}

activate() {
  local slot="$1"
  ln -sfn "$HOME_DIR/releases/$slot" "$CURRENT_LINK"

  # PM2에 등록된 실행 경로가 심볼릭 링크가 아니라 실제 폴더로 박제돼 있으면
  # 링크를 옮겨도 옛 코드가 그대로 뜬다. 그때는 재등록해야 한다.
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    if pm2 describe "$PM2_NAME" | grep -q "releases/"; then
      echo "  PM2에 실제 경로가 박제되어 있어 재등록합니다"
      pm2 delete "$PM2_NAME" >/dev/null
      pm2 start "$CURRENT_LINK/ecosystem.config.cjs" >/dev/null
    else
      pm2 reload "$PM2_NAME" >/dev/null
    fi
  else
    pm2 start "$CURRENT_LINK/ecosystem.config.cjs" >/dev/null
  fi
  pm2 save >/dev/null
}

verify() {
  sleep 2
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/robots.txt || echo 000)"
  if [ "$code" = "200" ]; then
    echo "  ✓ 정상 (HTTP $code)"
  else
    echo "  ✗ 응답 없음 (HTTP $code) — pm2 logs $PM2_NAME 확인"
    exit 1
  fi
}

if [ "${1:-}" = "rollback" ]; then
  LIVE="$(live_slot)"
  OTHER=$([ "$LIVE" = a ] && echo b || echo a)
  if [ ! -d "$HOME_DIR/releases/$OTHER" ]; then
    echo "✗ 되돌릴 이전 버전이 없습니다"
    exit 1
  fi
  echo "롤백: $LIVE → $OTHER"
  activate "$OTHER"
  verify
  exit 0
fi

[ -f "$TARBALL" ] || { echo "✗ $TARBALL 이 없습니다 (scp로 올렸는지 확인)"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE 이 없습니다"; exit 1; }

LIVE="$(live_slot)"
TARGET=$([ "$LIVE" = a ] && echo b || echo a)

echo "배포: 현재 $LIVE → 새 버전을 $TARGET 에 준비"

# 이전 버전 하나는 그대로 두고, 그 이전 것만 지운다
rm -rf "${HOME_DIR:?}/releases/$TARGET"
mkdir -p "$HOME_DIR/releases/$TARGET"
tar -xzf "$TARBALL" -C "$HOME_DIR/releases/$TARGET" --strip-components=1

# standalone은 실행 시 자기 폴더에서 env를 읽는다. 비밀값은 tar에 들어가지 않으므로
# 배포할 때마다 여기서 복사한다.
cp "$ENV_FILE" "$HOME_DIR/releases/$TARGET/.env.production"

echo "  전환"
activate "$TARGET"
verify

echo
echo "완료. 문제가 있으면:  ./deploy.sh rollback"
