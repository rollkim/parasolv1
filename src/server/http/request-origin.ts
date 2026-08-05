import "server-only";

/**
 * 브라우저가 실제로 쓰고 있는 주소(origin)를 구한다.
 *
 * 리버스 프록시 뒤에서는 `request.url`을 그대로 믿을 수 없다. 앱은 127.0.0.1:3100으로
 * 요청을 받으므로 프로토콜이 `http`로 잡히고, 그 값으로 리다이렉트를 만들면
 * **HTTPS로 들어온 사용자를 http로 되돌려 보낸다** — 브라우저가 경고를 띄우거나,
 * HTTPS 리다이렉트에 걸려 한 번 더 왕복하면서 쿼리스트링이 유실될 수 있다.
 * 결제 성공 콜백에서 이러면 "결제는 됐는데 완료 화면을 못 보는" 상황이 된다.
 *
 * 판단 근거는 **Nginx가 직접 넣어 주는 헤더 두 개**만 쓴다:
 * - `X-Forwarded-Proto` — 원래 프로토콜 (`proxy_set_header X-Forwarded-Proto $scheme`)
 * - `Host` — 원래 호스트 (`proxy_set_header Host $host`, server_name과 일치해야 도달한다)
 *
 * `X-Forwarded-Host`는 **일부러 보지 않는다.** Nginx가 설정하지 않는 헤더라
 * 클라이언트가 마음대로 넣어 보낼 수 있고, 그대로 믿으면 리다이렉트 주소를
 * 공격자가 정하게 된다(오픈 리다이렉트).
 */
export function resolvePublicOrigin(request: Request): string {
  const requestUrl = new URL(request.url);

  // 프록시를 여러 단 거치면 쉼표로 이어 붙는다 — 맨 앞이 원래 값이다
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");
  const host = request.headers.get("host")?.trim() || requestUrl.host;

  return `${protocol}://${host}`;
}
