"use client"

// 핸드오프 규격: 상품목록.dc.html L252~283(카드 마크업) · 메인.dc.html L272~392(큐레이션/신상품/베스트) —
// 카드 자체 규격은 두 화면이 문자 단위 동일. 그리드·4열 전환점은 페이지가 소유하고 카드는 유동 폭이다.
// README L64: 카드 hover(그림자·이동)는 인덱스·이야기 카드 전용 — 상품 카드에는 카드 단위 hover 없음.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - "use client"인 이유: 담기 뮤테이션·토스트를 카드가 직접 다룬다.
//    직렬화 가능한 ProductCard 데이터만 받으므로 서버 페이지(메인·목록)가 그대로 임포트해 쓴다.
//  - 목업에는 카드→상세 링크가 없으나(전 카드 공통) 상품명에 /products/[slug] 스트레치드 링크를 추가 —
//    after 오버레이(z-1)가 카드 전체를 덮고, 하트(z-2)·CTA(z-2)만 그 위에서 클릭을 가로챈다.
//  - 찜 하트는 WishlistHeartButton 실배선 — 목업 38px + 44px 히트 확장·로그인 판별은 그 컴포넌트가 소유한다.
//  - 품절 오버레이는 목업 DOM 순서(하트 위)를 따르되 pointer-events-none — 품절이어도 찜·상세 이동은 가능해야 한다.
//  - 뱃지·CTA 라운드는 목업 리터럴(7px·radius-3px) 대신 디자인 시스템 프리셋(Badge tag=rounded-sm, Button rounded-md)으로 수렴.

import Link from "next/link"
import { useRouter } from "next/navigation"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { discountRate } from "@/domain/product"
import { formatKrw } from "@/lib/format"
import { useTRPC } from "@/trpc/client"
import type { ProductCard } from "@/server/services/product.service"

import { ImagePlaceholder } from "./image-placeholder"
import { WishlistHeartButton } from "./wishlist-heart-button"

export type StoreProductCardProps = {
  productCard: ProductCard
  /** 메인 베스트(항상)·큐레이션(조건부) 진열 순위 — 지정 시 "n위" 뱃지. 목록·신상품은 미지정 */
  rankNumber?: number
}

export function StoreProductCard({ productCard, rankNumber }: StoreProductCardProps) {
  const { showToast } = useToast()
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const addItemMutation = useMutation(trpc.cart.addItem.mutationOptions())
  const {
    productId,
    slug,
    name,
    makerName,
    badgeLabel,
    sellingPrice,
    compareAtPrice,
    soldOut,
    singleVariantId,
    thumbnailPath,
    thumbnailAlt,
  } = productCard

  const discountPercent = discountRate(sellingPrice, compareAtPrice)

  /**
   * 카드에서 담기 — **옵션이 하나뿐일 때만** 실제로 담는다.
   * 여러 개면 상세로 보낸다: 고르지 않은 옵션이 담기면 되돌리는 건 고객 몫이 된다.
   */
  function handleAddCartClick() {
    if (addItemMutation.isPending) return
    if (singleVariantId === null) {
      router.push(`/products/${slug}?from=card`)
      return
    }
    addItemMutation.mutate(
      { variantId: singleVariantId, quantity: 1 },
      {
        onSuccess: (addResult) => {
          // 카트 화면 캐시 + 헤더 뱃지(서버 렌더 레이아웃)를 함께 갱신한다 — 상세 패널과 같은 처리
          void queryClient.invalidateQueries(trpc.cart.pathFilter())
          router.refresh()

          if (addResult.mergedIntoExisting) {
            // 조용히 수량만 늘리면 지금 몇 개가 됐는지 알 수 없다.
            // 상세와 달리 카드는 확인 모달을 띄우지 않는다 — 목록에서 담기는 연속 동작이라 흐름을 끊으면 안 된다
            showToast(`이미 담겨 있어 ${addResult.appliedQuantity}개가 됐어요 · ${name}`, {
              toastVariant: "info",
            })
            return
          }
          if (addResult.stockLimited) {
            showToast(
              `재고가 ${addResult.availableStock}개 남아 ${addResult.appliedQuantity}개로 담았어요.`,
              { toastVariant: "info" },
            )
            return
          }
          showToast(`장바구니에 담았어요 · ${name}`)
        },
        onError: (addError) => showToast(addError.message, { toastVariant: "error" }),
      },
    )
  }

  // 재입고 알림은 알림 채널(알림톡·메일)이 붙어야 의미가 있다 — 채널이 없는 상태에서
  // 신청만 받으면 "신청했는데 연락이 없다"가 된다. 지금은 문의로 안내하고 상세로 보낸다.
  function handleRestockNotifyClick() {
    showToast("재입고 알림은 준비 중이에요. 상품 문의로 남겨 주시면 알려드릴게요.", {
      toastVariant: "info",
    })
    router.push(`/products/${slug}#qna`)
  }

  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* [1] 이미지 영역 — 정방형 고정, 실사진 없으면 회색 플레이스홀더 */}
      <div className="relative aspect-square bg-muted">
        {thumbnailPath ? (
          // 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailPath}
            alt={thumbnailAlt ?? name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <ImagePlaceholder className="absolute inset-0 h-full" />
        )}

        {/* [1a] 뱃지 스택 — 순위 → 할인율 → 태그 순. 넘치면 줄바꿈(max-w 82%) */}
        {(rankNumber !== undefined || discountPercent !== null || badgeLabel) && (
          <div className="absolute top-2 left-2 flex max-w-[82%] flex-wrap gap-1">
            {rankNumber !== undefined && (
              // Badge에 primary solid 톤이 없어 클래스로 덮는다(ui는 수정 금지 — 톤 승격 시 교체)
              <Badge
                badgeSize="xs"
                badgeShape="tag"
                className="bg-primary text-primary-foreground"
              >
                {rankNumber}위
              </Badge>
            )}
            {discountPercent !== null && (
              <Badge badgeTone="destructiveSolid" badgeSize="xs" badgeShape="tag">
                -{discountPercent}%
              </Badge>
            )}
            {badgeLabel && (
              <Badge badgeTone="accentSolid" badgeSize="xs" badgeShape="tag">
                {badgeLabel}
              </Badge>
            )}
          </div>
        )}

        {/* [1b] 찜 버튼 — 실배선(WishlistHeartButton). 목업 위치(top/right 6px)만 카드가 소유한다 */}
        <WishlistHeartButton
          productId={productId}
          productName={name}
          heartAppearance="cardOverlay"
          className="absolute top-1.5 right-1.5 z-[2]"
        />

        {/* [1c] 품절 오버레이 — 색+텍스트 병행(KWCAG). 클릭은 아래 하트·링크로 통과시킨다 */}
        {soldOut && (
          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[color-mix(in_oklch,var(--background)_52%,transparent)]">
            <Badge badgeTone="inverse" badgeSize="xl">
              품절
            </Badge>
          </div>
        )}
      </div>

      {/* [2] 정보 영역 */}
      <div className="flex flex-1 flex-col gap-1.5 px-3 pt-3 pb-3.5">
        {makerName && (
          <div className="text-[12px] text-muted-foreground">{makerName}</div>
        )}
        {/* 상품명 = 상세 진입 링크. min-height 2줄 고정으로 그리드 행 내 가격·CTA 세로 정렬 유지 */}
        <Link
          href={`/products/${slug}`}
          className="line-clamp-2 min-h-[2.7em] text-[15px] leading-[1.35] font-semibold after:absolute after:inset-0 after:z-[1] after:content-['']"
        >
          {name}
        </Link>

        {/* [2c] 가격 줄 — 할인율·판매가·취소선 정가. 취소선은 색+<del>+sr-only "정가" 병기 */}
        <div className="mt-auto flex flex-wrap items-baseline gap-1.5 pt-1">
          {discountPercent !== null && (
            <span className="text-[16px] font-extrabold text-destructive">
              -{discountPercent}%
            </span>
          )}
          <span className="text-[17px] font-extrabold">{formatKrw(sellingPrice)}</span>
          {discountPercent !== null && compareAtPrice !== null && (
            <del className="text-[12px] text-muted-foreground">
              <span className="sr-only">정가 </span>
              {formatKrw(compareAtPrice)}
            </del>
          )}
        </div>

        {/* [2d] CTA — 구매 가능/품절 분기. 스트레치드 링크 위로 올린다(z-2) */}
        {soldOut ? (
          <Button
            type="button"
            variant="outline"
            size="sm-44"
            onClick={handleRestockNotifyClick}
            className="relative z-[2] mt-1 w-full bg-muted text-muted-foreground hover:border-foreground hover:bg-muted"
          >
            품절 · 재입고 알림
          </Button>
        ) : (
          <Button
            type="button"
            variant="soft"
            size="sm-44"
            onClick={handleAddCartClick}
            aria-disabled={addItemMutation.isPending}
            className="relative z-[2] mt-1 w-full"
          >
            {addItemMutation.isPending
              ? "담는 중…"
              : singleVariantId === null
                ? "옵션 선택"
                : "장바구니 담기"}
          </Button>
        )}
      </div>
    </article>
  )
}
