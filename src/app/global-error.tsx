"use client";

/**
 * 최상위 오류 경계 — 루트 레이아웃 자체가 렌더에 실패했을 때만 뜬다.
 * 이 컴포넌트는 루트 레이아웃을 대체하므로 html·body를 직접 그려야 한다.
 *
 * 여기서는 tRPC 프로바이더·폰트·site_setting을 쓰지 않는다: 그것들이 원인일 수 있는
 * 자리라 같은 것에 다시 의존하면 오류 화면까지 함께 죽는다. 스타일도 인라인으로 최소화한다.
 *
 * 원인 메시지는 노출하지 않는다 — 스택·내부 경로가 사용자에게 새면 공격 단서가 된다.
 * digest는 서버 로그와 대조할 식별자라 안전하게 보여줄 수 있다(운영 문의 시 사용).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
          일시적인 문제가 발생했어요
        </h1>
        <p style={{ margin: 0, maxWidth: 420, fontSize: 14, lineHeight: 1.7, color: "#666" }}>
          잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터로 알려주세요.
        </p>
        {error.digest ? (
          <p style={{ margin: 0, fontSize: 12, color: "#999" }}>오류 번호 {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 8,
            minHeight: 44,
            padding: "0 20px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "#333",
            color: "#fff",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  );
}
