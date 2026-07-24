// 핸드오프 규격: 메인.dc.html 140-196 (상품목록.dc.html 121-168과 픽셀 동일) · 모바일 드로어는 기획전.dc.html 203-247
//
// [탭 순서] 헤더: 1 메뉴(모바일) → 2 로고 → 3 검색 입력 → 4 검색 버튼 → 5 찜 → 6 장바구니 → 7 카테고리
// DOM 순서가 곧 탭 순서다 — tabindex를 조작하지 않는다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업의 container query(@container store)를 뷰포트 기준 md:(768px)로 환산. 셸 최대폭 1280px은 상위 레이아웃 몫.
//  - 모바일 카테고리 칩 스트립은 목업에서 </header> 바깥 형제지만, 데스크톱 카테고리 nav의 모바일 대응물이라 이 컴포넌트가 함께 소유한다(DOM 위치는 동일하게 header 뒤 형제).
//  - 칩 높이 38px → 44px 상향(터치 전용 내비게이션 · KWCAG). 검색 버튼도 터치 기기에서만 38px → 44px(pointer-coarse)로 올리고, 모바일 인풋을 46px → 48px로 맞춰 여백을 확보한다.
//  - 카테고리 활성 표시는 색만으로 전달하지 않도록 aria-current="page"를 함께 준다.

import * as React from "react"
import Link from "next/link"

import { BellIcon, HeartIcon, TicketIcon, UserIcon } from "lucide-react"

import { CountBadge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { StoreMobileNav } from "./store-mobile-nav"

/** 대분류 + (선택) 중분류. category 테이블(slug/name/parent_id)에서 조립해 주입한다. */
export type StoreCategoryNode = {
  slug: string
  name: string
  children?: { slug: string; name: string }[]
}

/** 드로어(클라이언트 컴포넌트)에 넘기는 형태. 링크 조립을 서버에서 끝내 함수를 경계 밖으로 넘기지 않는다. */
export type StoreDrawerCategory = {
  slug: string
  name: string
  href: string
  children: { slug: string; name: string; href: string }[]
}

/** 유틸바·드로어 퀵링크 공용. icon은 드로어 퀵링크에서만 쓴다. */
export type StoreNavLink = {
  label: string
  href: string
  icon?: React.ReactNode
}

export type StoreHeaderProps = {
  /** site_setting의 상호. 워드마크와 홈 링크 접근명에 쓰인다 — 하드코딩 금지 대상. */
  siteName: string
  categories: StoreCategoryNode[]
  /**
   * 현재 카테고리 페이지의 slug. 상품목록의 미필터 상태는 ALL_CATEGORY_SLUG("all")를 넘긴다.
   * 미지정이면 어느 항목도 활성이 아니다 — 카테고리 페이지가 아닌 화면(홈·장바구니 등)이 여기 해당한다.
   */
  activeCategorySlug?: string
  cartCount?: number
  utilLinks?: StoreNavLink[]
  drawerQuickLinks?: StoreNavLink[]
  searchPlaceholder?: string
  /** 모바일 폼은 폭이 좁아 축약 문구를 따로 받는다(미지정 시 데스크톱 문구 사용). */
  searchPlaceholderMobile?: string
}

// 스토어프론트 라우트가 아직 확정되지 않아 잠정값 — 확정되면 이 상수만 교체한다.
const STORE_ROUTE = {
  home: "/",
  products: "/products",
  search: "/search",
  cart: "/cart",
  wishlist: "/wishlist",
  login: "/login",
  signup: "/signup",
  mypage: "/mypage",
  coupons: "/mypage/coupons",
  support: "/support",
  faq: "/support/faq",
} as const

/** '전체' 항목의 활성 키. category 테이블에 없는 UI 전용 값이라 호출부가 이 상수로 지정한다. */
export const ALL_CATEGORY_SLUG = "all"

const DEFAULT_UTIL_LINKS: StoreNavLink[] = [
  { label: "고객센터", href: STORE_ROUTE.support },
  { label: "자주 묻는 질문", href: STORE_ROUTE.faq },
  { label: "로그인", href: STORE_ROUTE.login },
  { label: "회원가입", href: STORE_ROUTE.signup },
  { label: "마이페이지", href: STORE_ROUTE.mypage },
]

const DEFAULT_DRAWER_QUICK_LINKS: StoreNavLink[] = [
  {
    label: "마이페이지",
    href: STORE_ROUTE.mypage,
    icon: <UserIcon className="size-[18px]" aria-hidden="true" />,
  },
  {
    label: "찜한 상품",
    href: STORE_ROUTE.wishlist,
    icon: <HeartIcon className="size-[18px]" aria-hidden="true" />,
  },
  {
    label: "쿠폰",
    href: STORE_ROUTE.coupons,
    icon: <TicketIcon className="size-[18px]" aria-hidden="true" />,
  },
  {
    label: "고객센터",
    href: STORE_ROUTE.support,
    icon: <BellIcon className="size-[18px]" aria-hidden="true" />,
  },
]

function categoryHref(slug: string) {
  return `${STORE_ROUTE.products}?category=${encodeURIComponent(slug)}`
}

/**
 * 파라솔 심볼. 헤더(26)·드로어(24)·푸터(24)가 같은 path를 쓴다.
 * 리스킨 시 교체 지점을 한 곳으로 모으기 위한 컴포넌트이며, 색은 토큰(accent/foreground)을 따른다.
 */
export function ParasolMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="fill-accent"
        d="M2.4 12a9.6 9.6 0 0 1 19.2 0q-2.4-2.1-4.8 0-2.4-2.1-4.8 0-2.4-2.1-4.8 0Z"
      />
      <path
        className="stroke-foreground"
        fill="none"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M12 12v7.4a2 2 0 0 0 4 0"
      />
    </svg>
  )
}

// 검색 폼은 데스크톱·모바일 두 벌이 동시에 DOM에 있고 표시만 갈린다.
// 인풋 높이는 양쪽 다 48px — 터치 기기에서 44px 제출 버튼을 여백째 담아야 한다(모바일 목업 46px에서 상향).
// 검색 페이지는 아직 없으므로 GET 제출만 배선한다(클라이언트 상태 불필요).
function StoreSearchForm({
  formLayout,
  placeholder,
}: {
  formLayout: "desktop" | "mobile"
  placeholder: string
}) {
  const isDesktop = formLayout === "desktop"

  return (
    <form
      role="search"
      action={STORE_ROUTE.search}
      method="get"
      className={cn(
        "relative",
        isDesktop
          ? "mx-auto hidden w-full max-w-[520px] flex-1 md:block"
          : "pb-3 md:hidden"
      )}
    >
      <Input
        name="q"
        aria-label="상품 검색"
        placeholder={placeholder}
        size="modal"
        className={cn(
          "rounded-full text-[15px]",
          isDesktop ? "pr-[52px] pl-[18px]" : "pr-[50px] pl-4"
        )}
      />
      {/* 터치 기기에서만 44px로 키우고(KWCAG) 오프셋을 2px로 줄여 48px 인풋 안에 그대로 앉힌다 */}
      <Button
        type="submit"
        size="icon-sm"
        aria-label="검색"
        className="absolute top-[5px] right-[5px] size-[38px] rounded-full pointer-coarse:top-0.5 pointer-coarse:right-0.5 pointer-coarse:size-11"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[19px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" strokeLinecap="round" />
        </svg>
      </Button>
    </form>
  )
}

export function StoreHeader({
  siteName,
  categories,
  activeCategorySlug,
  cartCount = 0,
  utilLinks = DEFAULT_UTIL_LINKS,
  drawerQuickLinks = DEFAULT_DRAWER_QUICK_LINKS,
  searchPlaceholder = "상품을 검색해 보세요",
  searchPlaceholderMobile,
}: StoreHeaderProps) {
  // '전체'는 category 테이블에 없는 UI 항목이라 컴포넌트가 직접 렌더한다.
  // slug를 undefined로 두면 activeCategorySlug 미지정 화면에서 undefined === undefined로 활성 판정돼
  // 홈·장바구니에서도 '전체'가 현재 페이지로 낭독된다 — 실제 키를 준다.
  const navItems: { slug: string; name: string; href: string }[] = [
    { slug: ALL_CATEGORY_SLUG, name: "전체", href: STORE_ROUTE.products },
    ...categories.map((categoryNode) => ({
      slug: categoryNode.slug,
      name: categoryNode.name,
      href: categoryHref(categoryNode.slug),
    })),
  ]

  // 함수는 RSC 경계를 넘지 못하므로 드로어용 링크도 여기서 미리 조립해 넘긴다.
  const drawerCategories: StoreDrawerCategory[] = categories.map(
    (categoryNode) => ({
      slug: categoryNode.slug,
      name: categoryNode.name,
      href: categoryHref(categoryNode.slug),
      children: (categoryNode.children ?? []).map((childNode) => ({
        slug: childNode.slug,
        name: childNode.name,
        href: categoryHref(childNode.slug),
      })),
    })
  )

  return (
    <>
      {/* 헤더가 매 화면 20개 안팎의 탭 스톱을 본문 앞에 반복하므로 건너뛸 경로를 준다(관리자 셸과 동일 패턴) */}
      <a
        href="#store-main"
        className="sr-only no-underline focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-[300] focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground"
      >
        본문 바로가기
      </a>

      <header className="border-b border-border bg-card px-4 md:px-10">
        {/* 상단 유틸바 — 데스크톱 전용 */}
        <div className="hidden justify-end gap-[14px] pt-[9px] text-xs text-muted-foreground md:flex">
          {utilLinks.map((link, index) => (
            <React.Fragment key={link.href + link.label}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <Link
                href={link.href}
                className="transition-colors hover:text-primary"
              >
                {link.label}
              </Link>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-3 py-3">
          <StoreMobileNav
            siteName={siteName}
            brandMark={<ParasolMark className="size-6" />}
            categories={drawerCategories}
            quickLinks={drawerQuickLinks}
            loginHref={STORE_ROUTE.login}
            allProductsHref={STORE_ROUTE.products}
          />

          <Link
            href={STORE_ROUTE.home}
            aria-label={`${siteName} 홈`}
            className="flex items-center gap-2 text-foreground"
          >
            <ParasolMark className="size-[26px]" />
            <span className="font-heading text-[23px] font-extrabold tracking-[-0.01em]">
              {siteName}
            </span>
          </Link>

          <StoreSearchForm formLayout="desktop" placeholder={searchPlaceholder} />

          <div className="ml-auto flex items-center gap-0.5">
            {/* 모바일에는 헤더 내 찜 진입점이 없다 — 하단 바로가기 nav가 담당(목업 메인 L475) */}
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              className="hidden text-foreground hover:bg-transparent hover:text-accent md:inline-flex"
            >
              <Link href={STORE_ROUTE.wishlist} aria-label="찜 목록">
                <svg
                  viewBox="0 0 24 24"
                  className="size-[23px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M12 20.5 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5Z" />
                </svg>
              </Link>
            </Button>

            {/* 뱃지 숫자는 aria-label에 가려 낭독되지 않으므로 링크 이름에 개수를 합친다 */}
            <Button
              asChild
              variant="ghost"
              size="icon-sm"
              className="relative text-foreground hover:bg-transparent hover:text-primary"
            >
              <Link
                href={STORE_ROUTE.cart}
                aria-label={
                  cartCount > 0 ? `장바구니 (${cartCount}개)` : "장바구니"
                }
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-[23px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    d="M6 7h13l-1.2 8.4a2 2 0 0 1-2 1.7H9.2a2 2 0 0 1-2-1.7L6 4H3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="9.5" cy="20" r="1.3" />
                  <circle cx="16.5" cy="20" r="1.3" />
                </svg>
                {/* 개수 0이면 뱃지 자체를 렌더하지 않는다. 라벨은 링크가, 변경 낭독은 aria-live가 담당(CountBadge 규약) */}
                {cartCount > 0 && (
                  <CountBadge
                    aria-live="polite"
                    className="absolute top-1 right-0.5 h-[18px] min-w-[18px] px-1"
                  >
                    {cartCount}
                  </CountBadge>
                )}
              </Link>
            </Button>
          </div>
        </div>

        <StoreSearchForm
          formLayout="mobile"
          placeholder={searchPlaceholderMobile ?? searchPlaceholder}
        />

        {/* 카테고리 내비 — 데스크톱 전용 */}
        <nav
          aria-label="카테고리"
          className="hidden flex-wrap gap-1.5 border-t border-border md:flex"
        >
          {navItems.map((navItem) => (
            <Link
              key={navItem.slug}
              href={navItem.href}
              aria-current={
                navItem.slug === activeCategorySlug ? "page" : undefined
              }
              className="inline-flex min-h-[46px] items-center px-3 text-sm font-semibold text-foreground transition-colors hover:text-primary aria-[current=page]:text-primary"
            >
              {navItem.name}
            </Link>
          ))}
        </nav>
      </header>

      {/* 모바일 카테고리 칩 스트립 — 목업에서도 header 바깥 형제 요소다 */}
      <div className="flex gap-2 overflow-x-auto border-b border-border bg-card px-4 py-3 md:hidden">
        {navItems.map((navItem) => (
          <Link
            key={navItem.slug}
            href={navItem.href}
            aria-current={
              navItem.slug === activeCategorySlug ? "page" : undefined
            }
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-card px-[15px] text-[13px] font-semibold whitespace-nowrap text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
          >
            {navItem.name}
          </Link>
        ))}
      </div>
    </>
  )
}
