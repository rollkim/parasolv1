"use client"

// 찜 하트 토글 — 상품 카드(이미지 오버레이)·상품 상세(데스크톱 CTA·모바일 구매바)가 공유하는 단일 배선 지점.
// 하트 위치·크기 실측: 상품목록 카드 38px 원형(top/right 6px) · 상세 CTA 하트 24px · 모바일 바 하트 22px.
//
// 판단 메모(왜):
//  - 세션 유무는 prop 주입이 아니라 auth.sessionInfo 쿼리로 스스로 판별한다(지시 사양) —
//    서버 렌더 페이지(메인·목록·상세)가 세션을 몰라도 카드를 그대로 임포트할 수 있다.
//  - sessionInfo만 staleTime 0: 로그인·로그아웃 직후(auth 쪽은 캐시를 무효화하지 않는다) 이동해 온 화면에서
//    30초 기본 stale 유예 동안 잘못된 '로그인 필요' 안내가 나가는 것을 막는다. 재마운트 시 재검증되며
//    동시 마운트된 하트들의 요청은 tanstack이 중복 제거한다.
//  - 비로그인 클릭은 disabled가 아니라 안내 토스트 + '로그인' 이동 액션 — 원인+해결을 함께 전달한다(UX 규칙 6).
//  - 찜 상태(isWished)는 로그인일 때만 조회(enabled) — 비로그인 UNAUTHORIZED 왕복을 만들지 않는다.
//  - 찜 상태는 색(destructive)만이 아니라 채움 + aria-pressed + 라벨 문구로 함께 전달한다(KWCAG).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

export type WishlistHeartButtonProps = {
  productId: number
  productName: string
  /** cardOverlay: 카드 이미지 위 유리 원형 38px · detailCta: 상세 데스크톱 아이콘 버튼(56px) · detailBar: 모바일 구매바(50px) */
  heartAppearance: "cardOverlay" | "detailCta" | "detailBar"
  className?: string
}

/** 카드·상세·푸터가 공유하는 하트 path — 찜 상태면 채운다 */
function HeartToggleMark({
  wished,
  className,
}: {
  wished: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={wished ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      className={className}
      aria-hidden="true"
    >
      <path d="M12 20.5 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5Z" />
    </svg>
  )
}

export function WishlistHeartButton({
  productId,
  productName,
  heartAppearance,
  className,
}: WishlistHeartButtonProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { showToast } = useToast()

  const sessionInfoQuery = useQuery(
    trpc.auth.sessionInfo.queryOptions(undefined, { staleTime: 0 }),
  )
  const isLoggedIn = sessionInfoQuery.data != null

  const wishedQuery = useQuery(
    trpc.wishlist.isWished.queryOptions({ productId }, { enabled: isLoggedIn }),
  )
  const wished = isLoggedIn && wishedQuery.data === true

  const toggleWishMutation = useMutation(trpc.wishlist.toggle.mutationOptions())

  const handleHeartClick = () => {
    // 세션 판독 전 클릭은 무시 — 판별 없이 '로그인 필요'를 잘못 안내하지 않기 위해서다.
    // pending 재진입도 여기서 차단(disabled로 잠그면 포커스가 body로 유실된다 — 카트 뷰 선례)
    if (sessionInfoQuery.isPending || toggleWishMutation.isPending) return
    if (!isLoggedIn) {
      showToast("로그인이 필요해요", {
        toastVariant: "info",
        undoAction: { undoLabel: "로그인", onUndo: () => router.push("/login") },
      })
      return
    }
    toggleWishMutation.mutate(
      { productId },
      {
        onSuccess: (toggleResult) => {
          // 응답 wished가 곧 최종 상태 — 재조회 없이 캐시를 직접 맞추고, 찜 목록 화면만 무효화한다
          queryClient.setQueryData(
            trpc.wishlist.isWished.queryKey({ productId }),
            toggleResult.wished,
          )
          void queryClient.invalidateQueries(trpc.wishlist.getCards.pathFilter())
          showToast(toggleResult.wished ? "찜 목록에 담았어요" : "찜을 해제했어요")
        },
        onError: (toggleError) =>
          showToast(toggleError.message, { toastVariant: "error" }),
      },
    )
  }

  const heartAccessibleName = wished
    ? `${productName} 찜 해제`
    : `${productName} 찜하기`

  if (heartAppearance === "cardOverlay") {
    return (
      // 목업 38px 실측 유지 + after로 히트 영역 44px 확장(KWCAG). 위치(absolute)는 카드가 className으로 준다
      <button
        type="button"
        aria-label={heartAccessibleName}
        aria-pressed={wished}
        onClick={handleHeartClick}
        className={cn(
          "flex size-[38px] cursor-pointer items-center justify-center rounded-full border-none bg-[color-mix(in_oklch,var(--card)_78%,transparent)] backdrop-blur-[4px] after:absolute after:-inset-[3px] after:rounded-full after:content-['']",
          wished ? "text-destructive" : "text-muted-foreground",
          className,
        )}
      >
        <HeartToggleMark wished={wished} className="size-5" />
      </button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={heartAppearance === "detailCta" ? "icon" : "md-50"}
      aria-label={heartAccessibleName}
      aria-pressed={wished}
      onClick={handleHeartClick}
      className={cn(
        heartAppearance === "detailBar" && "w-[50px] px-0",
        wished && "text-destructive hover:text-destructive",
        className,
      )}
    >
      <HeartToggleMark
        wished={wished}
        className={heartAppearance === "detailCta" ? "size-6" : "size-[22px]"}
      />
    </Button>
  )
}
