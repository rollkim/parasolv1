"use client"

// 카테고리 내비 링크 — 자기 자신이 현재 위치인지 스스로 판정한다.
//
// 헤더는 (store)/layout.tsx가 그리는데, App Router 레이아웃은 searchParams를 받지 못한다.
// 카테고리는 /products?category=slug 라는 **쿼리**로 정해지므로 서버에서는 알 방법이 없고,
// 그래서 대분류 활성 표시(데스크톱 nav·모바일 탭 양쪽)가 계속 꺼져 있었다.
// 값을 위에서 내려주는 대신 링크가 클라이언트에서 직접 읽는다.

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { cn } from "@/lib/utils"

type StoreCategoryLinkProps = {
  /** 이 링크가 가리키는 대분류 slug. '전체'는 ALL_CATEGORY_SLUG */
  slug: string
  href: string
  /** 중분류 slug들 — 중분류를 보고 있어도 부모 대분류가 활성이어야 한다 */
  childSlugs?: string[]
  className?: string
  children: React.ReactNode
  /** 활성일 때만 렌더할 장식(밑줄 등). 활성 판정이 클라이언트에서 나므로 여기서 함께 받는다 */
  activeSlot?: React.ReactNode
}

/** 카테고리가 의미를 갖는 유일한 경로. 홈·장바구니에서는 어느 항목도 활성이 아니다 */
const CATEGORY_PATHNAME = "/products"
/** '전체' 항목의 활성 키 — store-header의 ALL_CATEGORY_SLUG와 같은 값 */
const ALL_SLUG = "all"

export function StoreCategoryLink({
  slug,
  href,
  childSlugs,
  className,
  children,
  activeSlot,
}: StoreCategoryLinkProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentCategory = searchParams.get("category")
  const isActive =
    pathname === CATEGORY_PATHNAME &&
    (currentCategory
      ? slug === currentCategory || (childSlugs?.includes(currentCategory) ?? false)
      : slug === ALL_SLUG)

  return (
    <Link
      href={href}
      // 색만으로 상태를 전달하지 않기 위한 것이기도 하다 — 스크린리더가 현재 위치를 낭독한다
      aria-current={isActive ? "page" : undefined}
      className={cn(className)}
    >
      {children}
      {isActive ? activeSlot : null}
    </Link>
  )
}
