"use client"

// 핸드오프 규격: 기획전.dc.html 203-247 (스토어프론트 좌측 드로어 마스터) · 트리거는 메인.dc.html 154-156
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 포커스 트랩·ESC·스크롤 락·배경 클릭 닫기는 Radix Dialog(Sheet)에 위임한다(sheet.tsx와 동일 방침).
//  - 2depth 링크 40px → 44px 상향(터치 전용 목록 · KWCAG). 닫기 버튼 상향은 SheetCloseButton이 이미 처리.
//  - 대분류 아이콘(_catIcon)은 category 테이블에 없는 목업 전용 장식이라 생략한다.
//  - 자식이 없는 대분류는 목업처럼 빈 토글 버튼으로 두지 않고 링크로 렌더한다(막다른 컨트롤 제거).

import * as React from "react"
import Link from "next/link"

import { ChevronDownIcon, ChevronRightIcon, LogOutIcon, UserIcon } from "lucide-react"

import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { StoreDrawerCategory, StoreNavLink } from "./store-header"

type StoreMobileNavProps = {
  siteName: string
  /** 심볼은 서버에서 렌더해 넘긴다 — 브랜드 자산 정의를 헤더 한 곳에 유지하기 위함. */
  brandMark: React.ReactNode
  /** 링크가 이미 조립된 상태로 받는다 — RSC 경계로 함수를 넘길 수 없다. */
  categories: StoreDrawerCategory[]
  quickLinks: StoreNavLink[]
  loginHref: string
  allProductsHref: string
  /**
   * 로그인한 회원 이름 — 비로그인이면 null.
   *
   * 이 값이 없으면 드로어가 **로그인 여부와 무관하게** "로그인 / 회원가입"을 띄운다.
   * 데스크톱 유틸바(utilLinks)만 세션을 반영하던 탓에, 모바일에서는 로그인해도
   * 계속 로그인 버튼이 보이고 마이페이지로 갈 길이 없었다(QA #1).
   */
  customerName: string | null
  mypageHref: string
  /**
   * 로그인 상태일 때 드로어 하단에 놓을 로그아웃 요소 — 비로그인이면 미지정.
   *
   * 로그아웃은 링크가 아니라 동작(뮤테이션)이라 quickLinks로 표현할 수 없고,
   * RSC 경계로 함수를 넘길 수 없어 조립된 노드를 받는다(brandMark와 같은 방식).
   * 없으면 모바일에서 로그인은 되는데 **나갈 방법이 없다**.
   */
  logoutSlot?: React.ReactNode
}

const drawerRowClassName =
  "flex items-center gap-2.5 rounded-[calc(var(--radius)-5px)] px-2.5 text-left transition-colors hover:bg-muted"

const drawerSectionLabelClassName =
  "px-2.5 pt-2.5 pb-1.5 text-[11px] font-extrabold tracking-[0.04em] text-muted-foreground"

export function StoreMobileNav({
  siteName,
  brandMark,
  categories,
  quickLinks,
  loginHref,
  allProductsHref,
  customerName,
  mypageHref,
  logoutSlot,
}: StoreMobileNavProps) {
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false)
  // 목업 초기값과 동일하게 자식을 가진 첫 대분류만 펼친 상태로 시작한다.
  const [expandedSlugs, setExpandedSlugs] = React.useState<
    Record<string, boolean>
  >(() => {
    const firstParent = categories.find(
      (categoryNode) => categoryNode.children.length > 0
    )
    return firstParent ? { [firstParent.slug]: true } : {}
  })

  const toggleCategory = (slug: string) =>
    setExpandedSlugs((prev) => ({ ...prev, [slug]: !prev[slug] }))

  const closeDrawer = () => setIsDrawerOpen(false)

  return (
    <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="전체 메뉴 열기"
          className="-ml-2 text-foreground hover:bg-transparent hover:text-primary md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </Button>
      </SheetTrigger>

      {/* 설명 문구가 없는 드로어라 Radix의 aria-describedby 연결을 끊는다 */}
      <SheetContent side="left" aria-describedby={undefined}>
        <SheetHeader>
          {/* 시각적으로는 로고가 제목 역할을 하므로 접근성 제목은 숨긴다 */}
          <SheetTitle className="sr-only">{siteName} 전체 메뉴</SheetTitle>
          <div className="flex items-center gap-2">
            {brandMark}
            <span
              aria-hidden="true"
              className="font-heading text-[19px] font-extrabold"
            >
              {siteName}
            </span>
          </div>
          <SheetCloseButton aria-label="메뉴 닫기" />
        </SheetHeader>

        {/* 로그인 상태면 마이페이지로 보낸다 — 모바일에는 유틸바가 없어 여기가 유일한 진입점이다 */}
        <Link
          href={customerName ? mypageHref : loginHref}
          onClick={closeDrawer}
          className="mx-4 my-[14px] flex shrink-0 items-center gap-2.5 rounded-[calc(var(--radius)-3px)] bg-secondary p-3.5 text-secondary-foreground transition hover:brightness-[0.98]"
        >
          <UserIcon className="size-6" aria-hidden="true" />
          <span className="flex-1 text-sm font-bold">
            {customerName ? `${customerName}님 · 마이페이지` : "로그인 / 회원가입"}
          </span>
          <ChevronRightIcon className="size-[18px]" aria-hidden="true" />
        </Link>

        <SheetBody className="px-2 pt-1 pb-4">
          <nav aria-label="카테고리">
            <p className={drawerSectionLabelClassName}>카테고리</p>

            <Link
              href={allProductsHref}
              onClick={closeDrawer}
              className={cn(
                drawerRowClassName,
                "min-h-12 text-[15px] font-bold text-foreground"
              )}
            >
              전체
            </Link>

            {categories.map((categoryNode) => {
              const children = categoryNode.children
              const isExpanded = Boolean(expandedSlugs[categoryNode.slug])

              if (children.length === 0) {
                return (
                  <Link
                    key={categoryNode.slug}
                    href={categoryNode.href}
                    onClick={closeDrawer}
                    className={cn(
                      drawerRowClassName,
                      "min-h-12 text-[15px] font-bold text-foreground"
                    )}
                  >
                    {categoryNode.name}
                  </Link>
                )
              }

              return (
                <div key={categoryNode.slug}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleCategory(categoryNode.slug)}
                    className={cn(
                      drawerRowClassName,
                      "min-h-12 w-full border-none bg-transparent text-foreground"
                    )}
                  >
                    <span className="flex-1 text-[15px] font-bold">
                      {categoryNode.name}
                    </span>
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={cn(
                        "size-[18px] shrink-0 text-muted-foreground transition-transform duration-200",
                        isExpanded && "rotate-180"
                      )}
                    />
                  </button>

                  {isExpanded && (
                    <div className="flex flex-col pt-0.5 pb-2 pl-10">
                      {children.map((childNode) => (
                        <Link
                          key={childNode.slug}
                          href={childNode.href}
                          onClick={closeDrawer}
                          className="flex min-h-11 items-center rounded-[calc(var(--radius)-6px)] px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {childNode.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          <nav aria-label="바로가기">
            <p
              className={cn(
                drawerSectionLabelClassName,
                "mt-2.5 border-t border-border pt-4"
              )}
            >
              바로가기
            </p>
            {quickLinks.map((link) => (
              <Link
                key={link.href + link.label}
                href={link.href}
                onClick={closeDrawer}
                className={cn(
                  drawerRowClassName,
                  "min-h-11 text-sm font-semibold text-foreground"
                )}
              >
                {link.icon && (
                  <span className="flex text-muted-foreground">{link.icon}</span>
                )}
                {link.label}
              </Link>
            ))}

            {/* 로그인 상태에서만 — 모바일에는 유틸바가 없어 여기가 유일한 로그아웃 경로다.
                아이콘은 슬롯 안이 아니라 여기서 그린다: 슬롯의 LogoutButton은 데스크톱
                유틸바와 공유하는 컴포넌트라, 거기에 아이콘을 넣으면 데스크톱까지 바뀐다.
                감싸는 요소에 onClick을 걸지 않는다 — div 클릭 핸들러는 키보드로 도달할 수 없다. */}
            {logoutSlot ? (
              // [&>button]:flex-1 : 슬롯 버튼이 행 전체를 채우게 해 터치 영역을 44px로 확보한다.
              // 글자 폭만큼만 누를 수 있으면 모바일에서 자꾸 빗나간다(KWCAG 터치 타깃).
              <div
                className={cn(
                  drawerRowClassName,
                  "mt-2.5 min-h-11 border-t border-border pt-4 text-sm font-semibold text-muted-foreground",
                  "[&>button]:flex-1 [&>button]:py-2.5 [&>button]:text-left",
                )}
              >
                <LogOutIcon className="size-[18px] shrink-0" aria-hidden="true" />
                {logoutSlot}
              </div>
            ) : null}
          </nav>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
