import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";

/**
 * 관리자 경로 가드(Next 16 proxy 규약) — 쿠키가 없으면 로그인으로 보낸다.
 *
 * **이것은 인가가 아니라 라우팅이다.** 프록시는 Edge에서 돌아 DB를 볼 수 없으므로
 * 쿠키의 존재만 확인한다. 위조·만료 토큰은 여기를 통과할 수 있고, 실제 검증은
 * adminProcedure(서명 검증 + DB 활성 확인)가 한다.
 * 프록시의 역할은 "로그인 안 한 사람에게 빈 관리자 화면을 보여주지 않는" 것뿐이다.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") {
    // 이미 세션이 있으면 로그인 화면에 머물 이유가 없다
    if (request.cookies.has(ADMIN_SESSION_COOKIE_NAME)) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (!request.cookies.has(ADMIN_SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/admin/login", request.url);
    // 로그인 후 원래 가려던 곳으로 돌려보낸다. 오픈 리다이렉트를 막기 위해
    // 경로만 넘기고(호스트 제외), 복귀 시 /admin 하위인지 다시 확인한다.
    if (pathname !== "/admin") loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
