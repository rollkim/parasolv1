// 목업 규격: PaRaSOL 관리자 셸.dc.html:183-198 (NAV 상수 · TITLES 맵)
//
// 메뉴는 확장되므로 컴포넌트 JSX가 아니라 이 상수 하나가 단일 소스다.
// 목업의 HREFS(.dc.html 파일명)는 실제 라우트로 치환했고, id는 활성 판별 키로 그대로 유지한다.

import {
  BookOpen,
  ClipboardList,
  Headset,
  LayoutDashboard,
  LayoutTemplate,
  MessageSquareText,
  Package,
  ScrollText,
  Settings,
  Star,
  TicketPercent,
  Users,
  type LucideIcon,
} from "lucide-react"

/** 관리자 루트. 프리픽스 매칭에서 제외해야 하위 화면에서 대시보드까지 활성으로 잡히지 않는다 */
export const ADMIN_ROOT_HREF = "/admin"

/** 2차 메뉴 항목. 목업의 children — 모두 실제 이동 대상이다 */
export type AdminNavChild = {
  childId: string
  label: string
  href: string
  /** 상단바 페이지 타이틀. 라벨과 다를 수 있어 재사용하지 않는다 */
  pageTitle: string
}

type AdminNavItemBase = {
  itemId: string
  label: string
  icon: LucideIcon
  /** 배지 숫자의 의미(스크린리더 전용) — 숫자만으로는 무엇의 개수인지 알 수 없다 */
  badgeMeaning?: string
}

/** 이동하는 1차 항목 — 링크로 렌더한다 */
export type AdminNavLinkItem = AdminNavItemBase & {
  href: string
  pageTitle: string
  children?: never
}

/** 펼침 전용 1차 항목 — 목업 clickItem처럼 이동하지 않고 하위 목록만 토글한다 */
export type AdminNavParentItem = AdminNavItemBase & {
  children: AdminNavChild[]
  href?: never
  pageTitle?: never
}

export type AdminNavItem = AdminNavLinkItem | AdminNavParentItem

export type AdminNavGroup = {
  groupId: string
  label: string
  items: AdminNavItem[]
}

/** 메뉴 배지의 실시간 카운트(미처리 주문·미답변 리뷰 등). 키는 AdminNavItem.itemId */
export type AdminNavBadgeCounts = Record<string, number>

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    groupId: "operation",
    label: "운영",
    items: [
      {
        itemId: "dashboard",
        label: "대시보드",
        icon: LayoutDashboard,
        href: ADMIN_ROOT_HREF,
        pageTitle: "대시보드",
      },
      {
        itemId: "orders",
        label: "주문 관리",
        icon: ClipboardList,
        badgeMeaning: "미처리 주문",
        children: [
          {
            childId: "order-list",
            label: "주문 목록/상세",
            href: "/admin/orders",
            pageTitle: "주문 관리",
          },
          {
            childId: "claim",
            label: "취소·교환·반품",
            href: "/admin/claims",
            pageTitle: "취소·교환·반품",
          },
        ],
      },
      {
        itemId: "product",
        label: "상품 관리",
        icon: Package,
        children: [
          {
            childId: "prod-list",
            label: "상품 목록",
            href: "/admin/products",
            pageTitle: "상품 관리",
          },
          {
            childId: "prod-new",
            label: "상품 등록/수정",
            href: "/admin/products/new",
            pageTitle: "상품 등록",
          },
          {
            childId: "category",
            label: "카테고리",
            href: "/admin/categories",
            pageTitle: "카테고리",
          },
        ],
      },
      {
        itemId: "members",
        label: "회원 관리",
        icon: Users,
        // 다른 관리자 경로와 같이 테이블명을 따른다(orders·product·claim·category)
        href: "/admin/customers",
        pageTitle: "회원 관리",
      },
    ],
  },
  {
    groupId: "contents",
    label: "콘텐츠 · 마케팅",
    items: [
      {
        itemId: "reviews",
        label: "리뷰 관리",
        icon: Star,
        href: "/admin/reviews",
        pageTitle: "리뷰 관리",
        badgeMeaning: "미답변 리뷰",
      },
      {
        // 게시판 = 운영자가 **쓰는** 글. 문의는 고객이 쓰고 운영자가 답한다 —
        // 하는 일이 반대라 한 메뉴에 묶으면 "답변 대기"를 공지 옆에서 찾게 된다
        itemId: "board",
        label: "게시판 관리",
        icon: MessageSquareText,
        children: [
          {
            childId: "notice",
            label: "공지사항",
            href: "/admin/boards/notice",
            pageTitle: "공지사항",
          },
          {
            childId: "faq",
            label: "FAQ",
            href: "/admin/boards/faq",
            pageTitle: "FAQ",
          },
        ],
      },
      {
        itemId: "inquiry",
        label: "문의 관리",
        icon: Headset,
        badgeMeaning: "미답변 문의",
        children: [
          {
            childId: "qna-product",
            label: "상품 문의",
            href: "/admin/inquiries/product",
            pageTitle: "상품 문의",
          },
          {
            childId: "qna-direct",
            label: "1:1 문의",
            href: "/admin/inquiries/direct",
            pageTitle: "1:1 문의",
          },
          {
            childId: "bulk",
            label: "단체구매 문의",
            href: "/admin/inquiries/bulk",
            pageTitle: "단체구매 문의",
          },
        ],
      },
      {
        itemId: "story",
        label: "이야기 관리",
        icon: BookOpen,
        children: [
          { childId: "story-list", label: "이야기 목록", href: "/admin/stories", pageTitle: "이야기 관리" },
          { childId: "story-new", label: "이야기 작성", href: "/admin/stories/new", pageTitle: "이야기 작성" },
        ],
      },
      {
        itemId: "display",
        label: "배너·진열",
        icon: LayoutTemplate,
        href: "/admin/banners",
        pageTitle: "배너·진열 관리",
      },
      {
        itemId: "promo",
        label: "프로모션",
        icon: TicketPercent,
        children: [
          {
            childId: "promotion",
            label: "기획전",
            href: "/admin/promotions",
            pageTitle: "기획전",
          },
          {
            childId: "coupon",
            label: "쿠폰",
            href: "/admin/coupons",
            pageTitle: "쿠폰",
          },
          {
            childId: "point",
            label: "적립금 정책",
            href: "/admin/points",
            pageTitle: "적립금 정책",
          },
        ],
      },
    ],
  },
  {
    groupId: "system",
    label: "시스템",
    items: [
      {
        itemId: "settings",
        label: "설정",
        icon: Settings,
        href: "/admin/settings",
        pageTitle: "설정",
      },
      {
        itemId: "audit",
        label: "로그",
        icon: ScrollText,
        href: "/admin/audit-logs",
        pageTitle: "로그",
      },
    ],
  },
]

/** 이동 가능한 메뉴 링크 전체(1차 leaf + 2차) */
const ADMIN_NAV_DESTINATIONS = ADMIN_NAV_GROUPS.flatMap((group) =>
  group.items.flatMap((item) =>
    item.children
      ? item.children.map((child) => ({
          href: child.href,
          pageTitle: child.pageTitle,
        }))
      : [{ href: item.href, pageTitle: item.pageTitle }]
  )
)

/**
 * 현재 경로에 해당하는 메뉴 링크를 하나만 고른다.
 * 가장 길게 일치하는 href를 택해 /admin/products 와 /admin/products/new 가 동시에 활성되는 것을 막는다.
 */
export function matchAdminNavHref(pathname: string): string | null {
  let matchedHref: string | null = null

  for (const destination of ADMIN_NAV_DESTINATIONS) {
    const isMatch =
      destination.href === ADMIN_ROOT_HREF
        ? pathname === destination.href
        : pathname === destination.href ||
          pathname.startsWith(`${destination.href}/`)

    if (isMatch && (matchedHref === null || destination.href.length > matchedHref.length)) {
      matchedHref = destination.href
    }
  }

  return matchedHref
}

/** 경로 → 상단바 타이틀(목업 TITLES). 레이아웃이 화면별 타이틀을 결정할 때 쓴다 */
export function resolveAdminPageTitle(pathname: string): string | undefined {
  const matchedHref = matchAdminNavHref(pathname)

  return ADMIN_NAV_DESTINATIONS.find(
    (destination) => destination.href === matchedHref
  )?.pageTitle
}
