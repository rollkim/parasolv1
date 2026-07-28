"use client"

// 헤더 장바구니 뱃지 — 서버 렌더 값 대신 **카트 캐시를 구독**한다.
//
// 왜 클라이언트로 옮겼나: 뱃지가 레이아웃(서버 컴포넌트)에서 계산되던 때는, 담기·삭제를 한
// 화면이 router.refresh()를 부르는지에 정확성이 달려 있었다. 부르는 곳을 하나라도 빠뜨리면
// 개수가 조용히 어긋난다(실제로 4개 담긴 카트에 뱃지가 3으로 남았다). 그리고 Next의 클라이언트
// 라우터 캐시가 레이아웃 페이로드를 재사용하면 refresh를 불러도 낡은 값이 보일 수 있다.
//
// 지금은 모든 카트 뮤테이션이 이미 invalidate하는 tRPC 캐시 하나가 진실원이라, 담기·삭제가
// 어디서 일어나든 뱃지가 따라온다. 서버 값은 초기값으로만 써서 첫 렌더 깜빡임을 없앤다.

import { useQuery } from "@tanstack/react-query"

import { CountBadge } from "@/components/ui/badge"
import { useTRPC } from "@/trpc/client"

export function CartCountBadge({ initialCount }: { initialCount: number }) {
  const trpc = useTRPC()
  const itemCountQuery = useQuery({
    ...trpc.cart.getItemCount.queryOptions(),
    initialData: initialCount,
  })

  const cartCount = itemCountQuery.data ?? initialCount
  if (cartCount <= 0) return null

  return (
    <CountBadge
      aria-live="polite"
      className="absolute top-1 right-0.5 h-[18px] min-w-[18px] px-1"
    >
      {cartCount}
    </CountBadge>
  )
}
