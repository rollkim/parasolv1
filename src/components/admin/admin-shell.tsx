// 목업 규격: PaRaSOL 관리자 셸.dc.html (관리자 공통 프레임 마스터) — 사이드바 248px · 900px 분기 ·
// 상단바 sticky(11px 16px + 40px 행) · 본문 clamp 패딩 · 드로어 min(276px,82vw)
//
// 목업과 다르게 간 부분(사유):
//  - 테마 프리셋 3버튼(솔·코랄·그레이프)은 리스킨 시연 장치라 프로덕션 셸에서 뺐다.
//    관리자 기본 테마(grape)는 셸이 아니라 루트 레이아웃이 data-theme으로 스탬프한다.
//  - 하단 미니 사업자 표기는 목업에 마크업이 없다(스펙서 §2.43 요구). 스토어 푸터 법적 표기 블록의
//    축약본으로 신설했고, businessInfo가 없으면 렌더하지 않는다(값 하드코딩 금지).
//  - 상단바 컨테이너 쿼리(cqw)는 뷰포트 기준으로 옮겼고, 셸 분기값 900px은 목업 그대로 유지한다
//    (Tailwind 기본 lg=1024px과 달라 min-[900px]: 임의 브레이크포인트를 쓴다).
//  - 페이지 타이틀을 <h1>으로 올렸다(목업은 div) — 화면당 h1 하나를 셸이 책임진다.

import Link from "next/link"
import * as React from "react"
import { Bell, LogOut, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { BusinessInfo } from "@/server/services/site-setting.service"

import { AdminBrandMark } from "./admin-brand-mark"
import { AdminLogoutButton } from "./admin-logout-button"
import { AdminMobileDrawer } from "./admin-mobile-drawer"
import { AdminSidebarNav } from "./admin-sidebar"
import { type AdminNavBadgeCounts } from "./admin-nav"

/**
 * 하단 미니 표기용 법정 사업자 정보.
 * 스토어 푸터와 같은 출처(site_setting business_info)를 쓰므로 타입을 공유한다 —
 * 같은 개념에 이름이 갈리면 조립 시 변환 코드가 생긴다(RULE-10).
 */
export type AdminBusinessInfo = Pick<
  BusinessInfo,
  "companyName" | "ceoName" | "businessNo" | "mailOrderNo"
>

type AdminShellProps = {
  /**
   * 상단바 타이틀. 서버 레이아웃은 경로를 알 수 없으므로,
   * 경로 기반 자동 해석이 필요하면 AdminPageTitle(클라이언트)을 넘긴다.
   */
  pageTitle: React.ReactNode
  /** 워드마크·카피라이트에 쓰는 site_setting siteName — 브랜드명 하드코딩 금지(RULE-11) */
  siteName: string
  children: React.ReactNode
  /** 메뉴 배지 실시간 카운트(미처리 주문·미답변 리뷰). 키는 AdminNavItem.itemId */
  navBadgeCounts?: AdminNavBadgeCounts
  /** 통합 검색 폼의 GET 대상 라우트. 없으면 검색을 렌더하지 않는다(대시보드 목업 기준) */
  searchAction?: string
  /** 알림 목록 화면 링크. unreadCount>0이면 미읽음 표시를 붙인다 */
  notificationLink?: { href: string; unreadCount?: number }
  /** 로그인 세션의 관리자 계정 */
  adminAccount?: { displayName: string; href: string }
  businessInfo?: AdminBusinessInfo
}

function AdminShell({
  pageTitle,
  siteName,
  children,
  navBadgeCounts,
  searchAction,
  notificationLink,
  adminAccount,
  businessInfo,
}: AdminShellProps) {
  const unreadNotificationCount = notificationLink?.unreadCount ?? 0

  return (
    <div className="relative min-h-screen bg-background">
      {/* GNB가 12항목이라 매 화면 반복 탭을 건너뛸 경로를 준다 */}
      <a
        href="#admin-main"
        className="sr-only no-underline focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-[300] focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground"
      >
        본문 바로가기
      </a>

      <div className="grid min-h-screen grid-cols-1 min-[900px]:grid-cols-[248px_1fr]">
        {/* ── 좌측 다크 GNB (≥900px) ── */}
        <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto bg-nav text-nav-foreground min-[900px]:flex">
          <div className="px-4 pt-[18px] pb-3.5">
            <AdminBrandMark siteName={siteName} />
          </div>

          <AdminSidebarNav variant="aside" navBadgeCounts={navBadgeCounts} />

          <div className="border-t border-nav-line p-3">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-[calc(var(--radius)-5px)] px-3 py-2 text-[13px] font-semibold text-nav-muted no-underline hover:bg-nav-panel hover:text-nav-foreground pointer-coarse:min-h-11"
            >
              <LogOut className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              스토어 바로가기
            </Link>
          </div>
        </aside>

        {/* ── 콘텐츠 컬럼 ── */}
        <div className="flex min-w-0 flex-col">
          {/* [탭 순서] 1 메뉴(모바일) → 2 GNB → 3 검색 → 4 알림 → 5 프로필 → 6 본문 */}
          <header className="sticky top-0 z-[100] flex items-center gap-3 border-b border-border bg-[color-mix(in_oklch,var(--card)_90%,transparent)] px-4 py-[11px] backdrop-blur-[8px]">
            <AdminMobileDrawer siteName={siteName} navBadgeCounts={navBadgeCounts} />

            <h1 className="font-heading text-[clamp(16px,2.2vw,19px)] font-extrabold text-foreground">
              {pageTitle}
            </h1>

            {searchAction && (
              <form
                role="search"
                action={searchAction}
                className="relative ml-2 max-w-[340px] flex-1"
              >
                <Input
                  type="search"
                  name="adminSearchKeyword"
                  size="admin"
                  aria-label="통합 검색"
                  placeholder="주문·상품·회원 검색"
                  className="h-10 rounded-full bg-background pr-3.5 pl-[38px] text-[13px]"
                />
                <Search
                  className="pointer-events-none absolute top-[11px] left-[13px] size-[17px] text-muted-foreground"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </form>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {notificationLink && (
                <Button
                  asChild
                  variant="outline"
                  size="icon-admin"
                  className="relative rounded-full"
                >
                  <Link
                    href={notificationLink.href}
                    aria-label={
                      unreadNotificationCount > 0
                        ? `알림 (읽지 않음 ${unreadNotificationCount}건)`
                        : "알림"
                    }
                  >
                    <Bell className="size-[19px]" strokeWidth={1.8} aria-hidden="true" />
                    {/* 색·형태 단독 전달이라 의미는 위 aria-label이 담당한다 */}
                    {unreadNotificationCount > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-[6px] right-[7px] size-2 rounded-full bg-destructive"
                      />
                    )}
                  </Link>
                </Button>
              )}

              {adminAccount && (
                <Button
                  asChild
                  variant="outline"
                  size="admin-40"
                  className="gap-2 rounded-full pr-1.5 pl-2.5"
                >
                  <Link href={adminAccount.href}>
                    <span className="text-[13px] font-bold">
                      {adminAccount.displayName}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex size-7 items-center justify-center rounded-full bg-secondary text-[12px] font-extrabold text-primary"
                    >
                      {adminAccount.displayName.trim().charAt(0)}
                    </span>
                  </Link>
                </Button>
              )}

              {/* 계정이 있으면 나갈 길도 있어야 한다 — 로그인만 되고 로그아웃이 없으면 미완성이다 */}
              {adminAccount && <AdminLogoutButton />}
            </div>
          </header>

          <main
            id="admin-main"
            tabIndex={-1}
            className="flex-1 p-[clamp(16px,3vw,28px)]"
          >
            <div className="w-full max-w-[1200px]">{children}</div>
          </main>

          {/* 관리자는 스토어 푸터 대신 셸 하단 미니 표기로 대체한다(스펙서 §2) */}
          {businessInfo && (
            <footer className="border-t border-border px-[clamp(16px,3vw,28px)] py-3.5 text-xs leading-[1.9] text-muted-foreground">
              <p>
                상호 {businessInfo.companyName} · 대표 {businessInfo.ceoName} · 사업자등록번호{" "}
                {businessInfo.businessNo} · 통신판매업신고 제
                {businessInfo.mailOrderNo}호
              </p>
              <p>
                ⓒ {new Date().getFullYear()} {siteName}
              </p>
            </footer>
          )}
        </div>
      </div>
    </div>
  )
}

export { AdminShell }
