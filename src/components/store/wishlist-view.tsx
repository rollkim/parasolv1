"use client"

// 핸드오프 규격: 위시리스트.dc.html — 타이틀+개수 · 선택 바(전체선택/선택 삭제) · 찜 카드 그리드
// (2열 → 3열 640px → 4열 920px, gap 14px) · 하단 담기 바 · 빈 상태.
// [탭 순서](위시리스트 L97): 전체선택 → 카드 하트/담기 → 하단 담기 바 (로고는 공통 셸 몫)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 카드 '담기'·'선택 상품 담기'·'재입고 알림'은 스텁(안내 토스트): cart.addItem·재입고 신청은
//    variantId가 필요한데 찜 카드(ProductCard)에는 variant 정보가 내려오지 않는다. 옵션 상품은
//    어차피 옵션 확정 없이 담을 수 없어, 상세로 안내하는 동선이 정직하다. TODO(찜 카드 담기 배선)
//  - 찜 해제 하트는 toggle이 아니라 removeMany 단건 호출: 찜 목록 안에서는 항상 '해제'가 의도라
//    동시 클릭·재조회 경합에도 재등록되는 일이 없어야 한다. 확인 다이얼로그 없이 토스트만(목업 실측).
//  - 상품명에 상세 링크 추가(목업 미포함): 담기 스텁이 상세로 보내는 동선과 짝을 맞춘다(상품 카드 선례).
//  - 초기 선택 상태는 '없음': 목업 데모의 초기값은 미확정이고, 선택은 삭제·담기를 위한 opt-in이라
//    기본 전체선택(장바구니 방식)이면 전 카드가 primary 테두리로 뜨는 과한 첫 화면이 된다.
//  - 전체선택·선택 삭제·체크박스 히트는 40px 실측에서 44px로 상향(KWCAG 터치 타겟).
//  - 컨테이너 쿼리(@container store)는 셸 선례를 따라 뷰포트 기준(sm:640px / min-[920px])으로 환산.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/toast"
import { discountRate } from "@/domain/product"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ProductCard } from "@/server/services/product.service"
import { useTRPC } from "@/trpc/client"

import { ImagePlaceholder } from "./image-placeholder"

/** 표시용 체크박스 — 목업 [data-check] 실측 24px·radius 7px(장바구니 22px과 다른 이 화면 고유 규격) */
function WishSelectCheckMark({
  checked,
  disabled = false,
  uncheckedClassName,
}: {
  checked: boolean
  disabled?: boolean
  /** 카드 이미지 위에서는 반투명 유리 배경(목업 card 85% mix) — 호출부가 지정한다 */
  uncheckedClassName?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-[7px] border-[1.5px]",
        checked
          ? "border-primary bg-primary"
          : cn("border-border bg-card", uncheckedClassName),
        disabled && "opacity-40"
      )}
    >
      {checked && (
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          className="text-primary-foreground"
          aria-hidden="true"
        >
          <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

type WishCardItemProps = {
  wishCard: ProductCard
  cardSelected: boolean
  removePending: boolean
  onToggleSelect: () => void
  onRelease: () => void
  onAddCart: () => void
  onRestockNotify: () => void
}

function WishCardItem({
  wishCard,
  cardSelected,
  removePending,
  onToggleSelect,
  onRelease,
  onAddCart,
  onRestockNotify,
}: WishCardItemProps) {
  const { slug, name, makerName, sellingPrice, compareAtPrice, soldOut } = wishCard
  const discountPercent = discountRate(sellingPrice, compareAtPrice)

  return (
    <li
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-card",
        // 테두리 강조는 선택 + 가용(품절 제외)일 때만 — 목업 실측
        cardSelected && !soldOut ? "border-primary" : "border-border"
      )}
    >
      {/* [1] 이미지 영역 — 체크박스·하트는 z-2로 스트레치드 링크(z-1) 위에 올린다 */}
      <div className="relative aspect-square bg-muted">
        {wishCard.thumbnailPath ? (
          // 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img (상품 카드와 동일)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={wishCard.thumbnailPath}
            alt={wishCard.thumbnailAlt ?? name}
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <ImagePlaceholder className="absolute inset-0 h-full" />
        )}

        {/* [1a] 선택 체크박스 — 품절 카드는 선택 불가(전체선택·합계 집계 제외, 목업 실측) */}
        <button
          type="button"
          role="checkbox"
          aria-checked={cardSelected}
          aria-label={cardSelected ? `선택 해제 ${name}` : `선택 ${name}`}
          disabled={soldOut}
          onClick={onToggleSelect}
          className="absolute top-2.5 left-2.5 z-[2] cursor-pointer disabled:cursor-not-allowed after:absolute after:-inset-2.5 after:content-['']"
        >
          <WishSelectCheckMark
            checked={cardSelected && !soldOut}
            disabled={soldOut}
            uncheckedClassName="bg-[color-mix(in_oklch,var(--card)_85%,transparent)]"
          />
        </button>

        {/* [1b] 찜 해제 하트 — 채운 하트 22px destructive, 즉시 해제 + 토스트(확인 다이얼로그 없음) */}
        <button
          type="button"
          aria-label={`${name} 찜 해제`}
          aria-disabled={removePending}
          onClick={onRelease}
          className="absolute top-2 right-2 z-[2] flex size-[38px] cursor-pointer items-center justify-center rounded-full border-none bg-[color-mix(in_oklch,var(--card)_85%,transparent)] text-destructive backdrop-blur-[4px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 after:absolute after:-inset-[3px] after:rounded-full after:content-['']"
        >
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path d="M12 20.5 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5Z" />
          </svg>
        </button>

        {/* [1c] 품절 오버레이 — 색+텍스트 병행(KWCAG). 클릭은 아래 하트·링크로 통과시킨다 */}
        {soldOut && (
          <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[color-mix(in_oklch,var(--background)_55%,transparent)]">
            <Badge badgeTone="inverse" badgeSize="lg">
              품절
            </Badge>
          </div>
        )}
      </div>

      {/* [2] 본문 — padding 12px, 가격줄은 mt-auto(목업 실측) */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {makerName && (
          <div className="text-[12px] text-muted-foreground">{makerName}</div>
        )}
        <Link
          href={`/products/${slug}`}
          className="text-[14px] leading-[1.35] font-semibold after:absolute after:inset-0 after:z-[1] after:content-['']"
        >
          {name}
        </Link>

        <div className="mt-auto flex flex-wrap items-baseline gap-1.5">
          {discountPercent !== null && (
            <span className="text-[13px] font-extrabold text-destructive">
              {discountPercent}%
            </span>
          )}
          <span className="text-[16px] font-extrabold">{formatKrw(sellingPrice)}</span>
        </div>

        {soldOut ? (
          <Button
            type="button"
            variant="outline"
            size="sm-44"
            onClick={onRestockNotify}
            className="relative z-[2] w-full text-[13px] text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            재입고 알림
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary-outline"
            size="sm-44"
            onClick={onAddCart}
            className="relative z-[2] w-full text-[13px]"
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
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
            담기
          </Button>
        )}
      </div>
    </li>
  )
}

/** 로딩 골격 — 카드 그리드와 치수를 맞춰 시프트를 막는다 */
function WishlistViewSkeleton() {
  return (
    <SkeletonGroup loadingLabel="찜 목록을 불러오는 중입니다" className="mt-4">
      <div className="grid grid-cols-2 gap-[14px] sm:grid-cols-3 min-[920px]:grid-cols-4">
        {[0, 1, 2, 3].map((cardIndex) => (
          <div
            key={cardIndex}
            className="overflow-hidden rounded-lg border border-border"
          >
            <Skeleton className="aspect-square rounded-none" />
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonGroup>
  )
}

export function WishlistView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { showToast } = useToast()

  const wishlistCardsQuery = useQuery(trpc.wishlist.getCards.queryOptions())
  const removeWishMutation = useMutation(trpc.wishlist.removeMany.mutationOptions())

  /* 선택은 opt-in — 선택된 productId 집합만 들고, 표시값은 현재 카드 목록과 교집합으로 계산한다
     (재조회로 카드가 사라져도 유령 선택이 남지 않는다) */
  const [selectedProductIds, setSelectedProductIds] = React.useState<Set<number>>(
    () => new Set()
  )

  /** 해제·선택 삭제 공용 — removeMany 성공 후 하트 상태 캐시와 목록을 함께 맞춘다 */
  const releaseWishes = (productIds: number[], successMessage: string) => {
    if (removeWishMutation.isPending) return
    removeWishMutation.mutate(
      { productIds },
      {
        onSuccess: () => {
          // 같은 상품의 카드·상세 하트(aria-pressed)가 재조회 없이 즉시 풀리도록 캐시를 직접 맞춘다
          for (const productId of productIds) {
            queryClient.setQueryData(
              trpc.wishlist.isWished.queryKey({ productId }),
              false
            )
          }
          void queryClient.invalidateQueries(trpc.wishlist.getCards.pathFilter())
          setSelectedProductIds((previousIds) => {
            const nextIds = new Set(previousIds)
            for (const productId of productIds) nextIds.delete(productId)
            return nextIds
          })
          showToast(successMessage)
        },
        onError: (removeError) =>
          showToast(removeError.message, { toastVariant: "error" }),
      }
    )
  }

  // TODO(찜 카드 담기 배선): 카드에 variant 정보가 내려오면 실담기로 교체 — 사유는 파일 머리 주석
  const handleAddCartFromCard = (wishCard: ProductCard) => {
    showToast("찜 목록에서 바로 담기는 준비 중이에요. 상품 상세에서 담아 주세요.", {
      toastVariant: "info",
      undoAction: {
        undoLabel: "상세 보기",
        onUndo: () => router.push(`/products/${wishCard.slug}`),
      },
    })
  }
  const handleRestockNotifyFromCard = () => {
    showToast("재입고 알림 신청은 준비 중이에요. 곧 열릴 예정입니다.", {
      toastVariant: "info",
    })
  }
  const handleBulkAddCart = () => {
    showToast("선택 상품 담기는 준비 중이에요. 상품 상세에서 담아 주세요.", {
      toastVariant: "info",
    })
  }

  const wishCards = wishlistCardsQuery.data ?? []
  const availableCards = wishCards.filter((wishCard) => !wishCard.soldOut)
  const selectedCards = availableCards.filter((wishCard) =>
    selectedProductIds.has(wishCard.productId)
  )
  const allSelected =
    availableCards.length > 0 && selectedCards.length === availableCards.length
  const selectedTotalAmount = selectedCards.reduce(
    (sum, wishCard) => sum + wishCard.sellingPrice,
    0
  )

  const handleToggleAll = () => {
    // 가용 카드가 전부 선택돼 있으면 전부 해제, 아니면 전부 선택 — 품절은 항상 제외(목업 실측)
    setSelectedProductIds(
      allSelected
        ? new Set()
        : new Set(availableCards.map((wishCard) => wishCard.productId))
    )
  }

  const handleToggleCard = (productId: number) => {
    setSelectedProductIds((previousIds) => {
      const nextIds = new Set(previousIds)
      if (nextIds.has(productId)) nextIds.delete(productId)
      else nextIds.add(productId)
      return nextIds
    })
  }

  const handleRemoveSelected = () => {
    if (selectedCards.length === 0) {
      // 목업 실측: 선택 0개는 삭제 없이 안내만
      showToast("선택된 상품이 없어요", { toastVariant: "info" })
      return
    }
    releaseWishes(
      selectedCards.map((wishCard) => wishCard.productId),
      "선택한 상품을 찜 목록에서 삭제했어요"
    )
  }

  const titleRow = (
    <div className="flex items-baseline gap-2">
      <h1 className="m-0 font-heading text-[clamp(17px,2.4vw,20px)] font-extrabold">
        찜한 상품
      </h1>
      {wishCards.length > 0 && (
        <span className="text-sm font-semibold text-muted-foreground">
          {wishCards.length}개
        </span>
      )}
    </div>
  )

  if (wishlistCardsQuery.isPending) {
    return (
      <>
        {titleRow}
        <WishlistViewSkeleton />
      </>
    )
  }

  if (wishlistCardsQuery.isError) {
    return (
      <>
        {titleRow}
        <EmptyState
          role="alert"
          size="section"
          stateTone="danger"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
              <path d="M12 8v5" strokeLinecap="round" />
              <path d="M12 16.5v.2" strokeLinecap="round" />
            </svg>
          }
          title="찜 목록을 불러오지 못했어요"
          description="일시적인 문제일 수 있어요. 잠시 후 다시 시도해 주세요."
          actions={[{ label: "다시 시도", onAction: () => void wishlistCardsQuery.refetch() }]}
        />
      </>
    )
  }

  // 빈 상태 — 원형 88px + 아웃라인 하트 44px(목업 실측). 데모용 '샘플 다시 담기'는 프로덕션 제외
  if (wishCards.length === 0) {
    return (
      <>
        {titleRow}
        <EmptyState
          size="section"
          stateTone="neutral"
          iconSize={44}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M12 20.5 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5Z" />
            </svg>
          }
          title="찜한 상품이 없어요"
          description="마음에 드는 상품의 하트를 눌러 찜 목록에 담아 보세요."
          actions={[{ label: "쇼핑하러 가기", href: "/products" }]}
        />
      </>
    )
  }

  return (
    <>
      {titleRow}

      {/* 선택 바 — 분모는 품절 제외 가용 카드 수(목업 availText). 40px 실측에서 44px 상향(KWCAG) */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          aria-pressed={allSelected}
          disabled={availableCards.length === 0}
          onClick={handleToggleAll}
          className="flex min-h-11 cursor-pointer items-center gap-[9px] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <WishSelectCheckMark
            checked={allSelected}
            disabled={availableCards.length === 0}
          />
          전체선택{" "}
          <span className="font-semibold text-muted-foreground">
            ({selectedCards.length}/{availableCards.length})
          </span>
        </button>
        {/* pending은 aria-disabled — hard disabled는 포커스를 body로 유실시킨다(장바구니 선례) */}
        <button
          type="button"
          aria-disabled={removeWishMutation.isPending}
          onClick={handleRemoveSelected}
          className="min-h-11 cursor-pointer rounded-full border border-border bg-card px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          선택 삭제
        </button>
      </div>

      <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-[14px] p-0 sm:grid-cols-3 min-[920px]:grid-cols-4">
        {wishCards.map((wishCard) => (
          <WishCardItem
            key={wishCard.productId}
            wishCard={wishCard}
            cardSelected={selectedProductIds.has(wishCard.productId)}
            removePending={removeWishMutation.isPending}
            onToggleSelect={() => handleToggleCard(wishCard.productId)}
            onRelease={() => releaseWishes([wishCard.productId], "찜을 해제했어요")}
            onAddCart={() => handleAddCartFromCard(wishCard)}
            onRestockNotify={handleRestockNotifyFromCard}
          />
        ))}
      </ul>

      {/* 하단 담기 바 — 합계·건수는 품절 제외 선택분(목업 실측). -mx는 페이지 래퍼 패딩 상쇄 */}
      <div className="sticky bottom-0 z-[150] -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-border bg-card px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:-mx-10 md:px-10">
        <span className="text-sm">
          선택 <strong className="font-extrabold">{selectedCards.length}건</strong>
          {" · "}
          <strong className="font-extrabold">{formatKrw(selectedTotalAmount)}</strong>
        </span>
        <Button
          type="button"
          variant="primary"
          size="md-50"
          disabled={selectedCards.length === 0}
          onClick={handleBulkAddCart}
          className="px-6"
        >
          선택 상품 담기
        </Button>
      </div>
    </>
  )
}
