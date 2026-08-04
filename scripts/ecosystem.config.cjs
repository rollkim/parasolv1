/**
 * PM2 설정 — PaRaSOL 데모.
 *
 * **명율 기존 서비스와 섞이지 않는다.** PM2 데몬은 리눅스 계정마다 따로 뜨므로,
 * `parasol` 계정에서 실행하는 한 명율 계정의 프로세스 목록·재시작·로그와 완전히 분리된다.
 * (같은 계정에서 돌리면 `pm2 restart all` 한 번에 남의 서비스까지 내려간다)
 *
 * 실행: pm2 start ecosystem.config.cjs
 */

module.exports = {
  apps: [
    {
      name: "parasol-demo",
      script: "server.js",

      // ★ 반드시 심볼릭 링크 경로다. `__dirname`을 쓰면 안 된다 —
      // Node가 모듈 경로의 심볼릭 링크를 실제 경로로 풀어 버려서
      // PM2에 "그때의 릴리스 폴더"(예: releases/parasol-20260804-1638)가 박제된다.
      // 그러면 다음 배포에서 링크를 새 릴리스로 옮기고 reload해도 **옛 코드가 그대로 뜬다**
      // ("배포했는데 아무것도 안 바뀐다" 증상). 링크 경로로 두면 재시작 때마다 새로 따라간다.
      cwd: "/home/parasol/current",

      // 단일 프로세스. 데모는 부하가 없고, 이 서버에는 명율 운영 서비스가 함께 산다 —
      // 클러스터로 코어를 나눠 갖는 건 남의 서비스에서 자원을 빼앗는 일이다.
      exec_mode: "fork",
      instances: 1,

      env: {
        NODE_ENV: "production",

        // 명율이 3000을 쓰고 있다. 겹치면 둘 중 하나가 못 뜬다.
        PORT: 3100,

        // ★ 반드시 명시한다. standalone server.js는 `process.env.HOSTNAME || '0.0.0.0'`로
        // 바인딩 주소를 정하는데, 리눅스에는 HOSTNAME(머신 이름, 예: my8950)이 이미 있다.
        // 비워 두면 머신 이름에 바인딩하려다 실패하거나 예상 밖 주소로 열린다.
        // 127.0.0.1로 못 박아 **Nginx를 거치지 않은 외부 직접 접속을 차단**한다.
        HOSTNAME: "127.0.0.1",

        // 업로드는 릴리스 폴더 밖 고정 경로에 쌓는다 — 안에 두면 재배포 때 사라진다
        PARASOL_UPLOAD_DIR: "/home/parasol/shared/uploads",

        // 데모 표시(상단 배너)와 검색엔진 차단. env 파일에도 넣지만 여기에도 둔다 —
        // 빠뜨렸을 때 "운영처럼 보이는 데모가 색인까지 허용된 채" 도는 쪽이 아니라
        // "데모 표시가 켜진 채" 도는 쪽으로 틀리게 만든다.
        PARASOL_DEMO_MODE: "1",
      },

      // 로그도 릴리스 폴더 밖에 — 재배포로 지난 로그가 날아가면 장애 추적이 끊긴다
      out_file: "/home/parasol/shared/logs/parasol-out.log",
      error_file: "/home/parasol/shared/logs/parasol-err.log",
      merge_logs: true,
      time: true,

      // 메모리 누수 방어선. 데모 서버라 여유가 적다
      max_memory_restart: "500M",

      // 부팅 직후 연속 실패(예: DB 접속 불가)로 무한 재시작하지 않도록 간격을 둔다
      restart_delay: 3000,
      max_restarts: 10,
    },
  ],
};
