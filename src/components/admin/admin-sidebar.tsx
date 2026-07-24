"use client"

// 목업 규격: PaRaSOL 관리자 셸.dc.html:44-49([data-nav]/[data-sub] 스타일) · 73-88(사이드바 nav) · 160-167(드로어 nav)
//
// 목업과 다르게 간 부분(사유):
//  - 목업은 모든 항목이 <button> + window.location.href 이동이다. 이동 항목은 next/link의 <a>로 바꿔
//    새 탭 열기·URL 미리보기 같은 기본 동작을 회복시키고, 펼침 전용(자식 보유) 항목만 <button aria-expanded>로 남긴다.
//  - 2차 활성 표시가 목업은 색상 단독(color:var(--accent))이라 KWCAG 위반 — 굵기 + 좌측 3px 바 + aria-current 병행.
//  - 드로어에도 2차 메뉴를 렌더한다. 목업 드로어는 2차를 생략하는데, 1차가 펼침 전용이라
//    그대로 두면 모바일에서 클레임·카테고리 등 2차 화면에 도달할 경로가 사라진다.

import Link from "next/link"
import { usePathname } from "next/navigation"
import * as React from "react"
import { ChevronDown } from "lucide-react"

import { CountBadge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

import {
  ADMIN_NAV_GROUPS,
  matchAdminNavHref,
  type AdminNavBadgeCounts,
  type AdminNavItem,
} from "./admin-nav"

/** 사이드바(마우스 밀도)와 드로어(터치 타겟 44px)의 유일한 차이는 행 높이·상단 여백이다 */
type AdminNavVariant = "aside" | "drawer"

const navItemBaseClass =
  "flex w-full items-center gap-[11px] rounded-[calc(var(--radius)-5px)] px-3 text-left text-sm font-semibold text-nav-muted no-underline hover:bg-nav-panel hover:text-nav-foreground data-[on=true]:bg-primary data-[on=true]:font-bold data-[on=true]:text-primary-foreground"

const navSubItemBaseClass =
  "flex w-full items-center gap-2 rounded-[calc(var(--radius)-5px)] py-1 pr-3 pl-10 text-[13px] font-semibold text-nav-muted no-underline hover:bg-nav-panel hover:text-nav-foreground data-[on=true]:font-bold data-[on=true]:text-accent data-[on=true]:shadow-[inset_3px_0_0_0_var(--accent)]"

type AdminSidebarNavProps = {
  variant: AdminNavVariant
  navBadgeCounts?: AdminNavBadgeCounts
  /** 드로어에서 링크 이동 시 드로어를 닫기 위한 콜백 */
  onNavigate?: () => void
}

function AdminSidebarNav({
  variant,
  navBadgeCounts,
  onNavigate,
}: AdminSidebarNavProps) {
  const pathname = usePathname()
  const activeHref = matchAdminNavHref(pathname)

  // 펼침 상태는 현재 경로에서 자동 결정하고, 사용자가 직접 접거나 편 항목만 기억한다
  const [manualExpandState, setManualExpandState] = React.useState<
    Record<string, boolean>
  >({})

  const isDrawer = variant === "drawer"

  const toggleItem = (itemId: string, isExpanded: boolean) => {
    setManualExpandState((current) => ({ ...current, [itemId]: !isExpanded }))
  }

  const renderBadge = (item: AdminNavItem) => {
    const badgeCount = navBadgeCounts?.[item.itemId]
    if (!badgeCount) return null

    return (
      <>
        <CountBadge aria-hidden="true">{badgeCount}</CountBadge>
        {/* 숫자만으로는 무엇의 개수인지 전달되지 않는다 */}
        <span className="sr-only">
          {item.badgeMeaning ?? item.label} {badgeCount}건
        </span>
      </>
    )
  }

  return (
    <nav
      aria-label={isDrawer ? "관리자 메뉴(모바일)" : "관리자 메뉴"}
      className={cn(
        "flex flex-1 flex-col gap-0.5 px-2.5 pb-5",
        isDrawer ? "pt-1" : "pt-1.5"
      )}
    >
      {ADMIN_NAV_GROUPS.map((group) => (
        <React.Fragment key={group.groupId}>
          <div
            className={cn(
              "px-3 pb-1.5 text-[11px] font-extrabold tracking-[0.04em] text-nav-muted",
              isDrawer ? "pt-3" : "pt-3.5"
            )}
          >
            {group.label}
          </div>

          {group.items.map((item) => {
            const ItemIcon = item.icon
            // aside 인스턴스는 모바일에서 display:none일 뿐 DOM에 상주한다 —
            // 드로어가 열리면 id가 문서에 중복되므로 variant로 분리한다
            const submenuId = `admin-nav-${variant}-${item.itemId}-submenu`
            const hasActiveChild = Boolean(
              item.children?.some((child) => child.href === activeHref)
            )
            const isItemActive = item.href === activeHref || hasActiveChild
            const isExpanded = manualExpandState[item.itemId] ?? hasActiveChild

            const itemInner = (
              <>
                <span className="flex w-5 shrink-0">
                  <ItemIcon
                    className="size-[18px]"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                </span>
                <span className="flex-1">{item.label}</span>
                {renderBadge(item)}
              </>
            )

            if (!item.children) {
              return (
                <Link
                  key={item.itemId}
                  href={item.href}
                  data-on={isItemActive}
                  aria-current={isItemActive ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    navItemBaseClass,
                    isDrawer ? "min-h-11" : "min-h-[42px]"
                  )}
                >
                  {itemInner}
                </Link>
              )
            }

            return (
              <React.Fragment key={item.itemId}>
                <button
                  type="button"
                  data-on={isItemActive}
                  aria-expanded={isExpanded}
                  aria-controls={submenuId}
                  onClick={() => toggleItem(item.itemId, isExpanded)}
                  className={cn(
                    navItemBaseClass,
                    isDrawer ? "min-h-11" : "min-h-[42px]"
                  )}
                >
                  {itemInner}
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 transition-transform duration-200",
                      isExpanded && "rotate-180"
                    )}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>

                {/* aria-controls 대상이 항상 존재하도록 언마운트 대신 display로 감춘다 */}
                <ul
                  id={submenuId}
                  className={cn(
                    "flex-col gap-0.5",
                    isExpanded ? "flex" : "hidden"
                  )}
                >
                  {item.children.map((child) => {
                    const isChildActive = child.href === activeHref

                    return (
                      <li key={child.childId}>
                        <Link
                          href={child.href}
                          data-on={isChildActive}
                          aria-current={isChildActive ? "page" : undefined}
                          onClick={onNavigate}
                          className={cn(
                            navSubItemBaseClass,
                            isDrawer ? "min-h-11" : "min-h-[38px]"
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="size-1 shrink-0 rounded-full bg-current"
                          />
                          {child.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </React.Fragment>
            )
          })}
        </React.Fragment>
      ))}
    </nav>
  )
}

export { AdminSidebarNav }
