"use client";

import { usePathname } from "next/navigation";

import { resolveAdminPageTitle } from "./admin-nav";

/**
 * 상단바 제목을 현재 경로에서 해석한다.
 * 서버 레이아웃은 경로를 읽을 수 없어(usePathname은 클라이언트 전용)
 * 제목 텍스트 한 조각만 클라이언트로 분리한다 — 셸 나머지는 서버 컴포넌트로 유지된다.
 */
export function AdminPageTitle({ fallbackTitle }: { fallbackTitle: string }) {
  const pathname = usePathname();

  return <>{resolveAdminPageTitle(pathname) ?? fallbackTitle}</>;
}
