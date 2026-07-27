"use client"

// 핸드오프 규격: 장바구니.dc.html — 리스트 헤더(전체선택/선택삭제)·품목 행·요약 패널·모바일 하단 결제 바,
// 빈 상태는 오류빈상태.dc.html 'cart' 케이스. [탭 순서](장바구니 L109): 전체선택 → 품목 체크박스 → 수량 → 삭제 → 결제하기
// (행 내부 실제 포커스 순서는 목업 DOM 실측과 동일: 체크박스 → 삭제 → 수량−/+)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 선택 체크박스는 '선택 삭제' 전용이며 결제 예정 금액에 반영하지 않는다: 합계는 서버(getCart.summary)만
//    신뢰한다(RULE-11). 서버 카트에 선택 개념이 없어 부분 선택 결제는 체크아웃 배선 때 서버 계산으로 넘긴다.
//  - 정가 취소선·'상품 할인' 행 아직 미표시: 서버는 이제 내려준다(CartLine.listPrice,
//    summary.listTotal·productDiscount). 목업 4행 요약(총 상품금액/상품 할인/추가상품/배송비)으로
//    교체하는 것은 체크아웃 화면과 함께 처리한다 — 두 화면이 같은 요약을 써야 하기 때문.
//  - '3만원 이상 무료배송' 고정 캡션 없음: 임계값은 site_setting 정책이라 하드코딩 금지(RULE-11) —
//    서버 계산값(freeShippingRemaining) 기반 안내 박스가 같은 정보를 전달한다.
//  - 삭제는 확인 모달이 아니라 실행취소 토스트(핸드오프 UX 규칙 7 — 장바구니 확정 방식). 선택 삭제도 동일하게
//    스냅샷 일괄 재담기로 실행취소를 지원한다.
//  - 수량 상한 QMAX=20 미적용: 상한은 서버가 재고 기준으로 보정한다(응답 stockLimited로 안내).
//  - 상품명에 상세 링크 추가(목업 미포함): 카트에서 상품을 재확인할 동선이 없어 보완.
//  - 컨테이너 쿼리(@container store)는 셸 선례를 따라 뷰포트 기준(md:768px / min-[1040px])으로 환산.
//  - 결제하기 CTA는 체크아웃 미구현이라 안내 토스트 스텁. TODO(체크아웃 배선 시 이동으로 교체)

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  CartLine,
  RemovedCartLineSnapshot,
} from "@/server/services/cart.service"
import { useTRPC } from "@/trpc/client"

import { ImagePlaceholder } from "./image-placeholder"

/* 수량 스테퍼 공통 클래스 — 목업 38×40px 실측 유지 + after로 히트 영역 44×46px 확장(KWCAG).
   상품상세 추가상품 스테퍼와 같은 규격이다.
   hard disabled가 아니라 aria-disabled인 이유: 뮤테이션 pending마다 disabled가 걸리면 포커스가
   body로 유실돼 키보드 구매 완주(RULE-11)가 깨진다. 재진입은 핸들러 가드가 이미 막는다. */
const cartStepButtonClass =
  "relative flex h-10 w-[38px] cursor-pointer items-center justify-center border border-border bg-card text-lg after:absolute after:-inset-[3px] after:content-[''] aria-disabled:cursor-not-allowed aria-disabled:opacity-35"

/** 표시용 체크박스 — 목업 [data-check] 22×22 실측. 상태는 감싸는 버튼의 aria가 전달한다 */
function CartCheckMark({
  checked,
  disabled = false,
}: {
  checked: boolean
  disabled?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px]",
        checked ? "border-primary bg-primary" : "border-border bg-card",
        disabled && "opacity-40"
      )}
    >
      {checked && (
        <svg
          width={14}
          height={14}
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

type CartLineRowProps = {
  cartLine: CartLine
  lineSelected: boolean
  /** 품절·판매중지 라인은 선택(=선택 삭제) 대상에서 제외한다 — 목업 toggleAll 실측과 동일 */
  lineSelectable: boolean
  quantityPending: boolean
  removePending: boolean
  onToggleSelect: () => void
  onRemove: () => void
  onChangeQuantity: (nextQuantity: number) => void
}

function CartLineRow({
  cartLine,
  lineSelected,
  lineSelectable,
  quantityPending,
  removePending,
  onToggleSelect,
  onRemove,
  onChangeQuantity,
}: CartLineRowProps) {
  const lineOrderable = !cartLine.soldOut && !cartLine.unavailable
  const hasMetaBox = cartLine.optionLabel !== null || cartLine.addons.length > 0

  return (
    <li className="flex items-start gap-3 border-b border-border py-[18px]">
      {/* ① 선택 체크박스 — mt-[30px]은 88px 썸네일 세로 중앙 정렬(목업 실측), after로 44px 히트 확보 */}
      <button
        type="button"
        role="checkbox"
        aria-checked={lineSelected}
        aria-label={`${cartLine.productName} 선택`}
        disabled={!lineSelectable}
        onClick={onToggleSelect}
        className="relative mt-[30px] shrink-0 cursor-pointer disabled:cursor-not-allowed after:absolute after:-inset-[11px] after:content-['']"
      >
        <CartCheckMark checked={lineSelected} disabled={!lineSelectable} />
      </button>

      {/* ② 썸네일 88×88 — 품절/판매중지 오버레이는 색+텍스트 이중 전달(KWCAG) */}
      <div className="relative size-[88px] shrink-0 overflow-hidden rounded-[calc(var(--radius)-3px)] border border-border bg-muted">
        {cartLine.thumbnailPath ? (
          // 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img (상품상세와 동일)
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cartLine.thumbnailPath}
            alt={cartLine.thumbnailAlt ?? ""}
            className="size-full object-cover"
          />
        ) : (
          <ImagePlaceholder className="size-full" />
        )}
        {!lineOrderable && (
          <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_oklch,var(--background)_55%,transparent)]">
            <span className="rounded-full bg-foreground px-2.5 py-[3px] text-xs font-bold text-background">
              {cartLine.soldOut ? "품절" : "판매중지"}
            </span>
          </div>
        )}
      </div>

      {/* ③ 본문 컬럼 */}
      <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/products/${cartLine.productSlug}`}
            className="min-w-0 pt-0.5 text-[15px] leading-[1.35] font-semibold hover:text-primary"
          >
            {cartLine.productName}
          </Link>
          {/* pending 중 hard disabled는 포커스를 body로 떨어뜨린다 — aria-disabled + 핸들러 가드로 대체 */}
          <button
            type="button"
            aria-label={`${cartLine.productName} 삭제`}
            aria-disabled={removePending}
            onClick={onRemove}
            className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-40 after:absolute after:-inset-1.5 after:content-['']"
          >
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 옵션·추가상품 메타 박스 — 있을 때만 렌더(목업 실측) */}
        {hasMetaBox && (
          <div className="rounded-[calc(var(--radius)-5px)] bg-muted px-[11px] py-2 text-xs leading-[1.6] text-muted-foreground">
            {cartLine.optionLabel && <div>옵션 · {cartLine.optionLabel}</div>}
            {cartLine.addons.map((lineAddon) => (
              <div key={lineAddon.addonId}>
                추가 · {lineAddon.addonName} (+{formatKrw(lineAddon.addonPrice)})
                {lineAddon.addonQuantity > 1 && ` ×${lineAddon.addonQuantity}`}
              </div>
            ))}
          </div>
        )}

        {/* 담은 뒤 재고가 줄어든 라인 — 서버는 읽기 시 자동 보정하지 않으므로 여기서 안내한다 */}
        {lineOrderable && cartLine.quantity > cartLine.stock && (
          <p className="m-0 text-[13px] font-bold text-destructive">
            재고가 {cartLine.stock}개 남았습니다. 수량을 조정해 주세요.
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2.5">
          {lineOrderable ? (
            <div className="flex" role="group" aria-label={`${cartLine.productName} 수량 선택`}>
              <button
                type="button"
                aria-label="수량 줄이기"
                aria-disabled={cartLine.quantity <= 1 || quantityPending}
                onClick={() => onChangeQuantity(cartLine.quantity - 1)}
                className={cn(cartStepButtonClass, "rounded-l-[calc(var(--radius)-5px)]")}
              >
                −
              </button>
              <span
                aria-live="polite"
                className="flex h-10 min-w-11 items-center justify-center border-y border-border bg-card text-sm font-bold"
              >
                {cartLine.quantity}
              </span>
              <button
                type="button"
                aria-label="수량 늘리기"
                aria-disabled={quantityPending}
                onClick={() => onChangeQuantity(cartLine.quantity + 1)}
                className={cn(cartStepButtonClass, "rounded-r-[calc(var(--radius)-5px)]")}
              >
                +
              </button>
            </div>
          ) : (
            // 품절/판매중지 = 색 + 텍스트 이중 전달(KWCAG)
            <span className="text-[13px] font-bold text-destructive">
              {cartLine.soldOut
                ? "주문할 수 없는 상품입니다"
                : "지금은 판매하지 않는 상품입니다"}
            </span>
          )}

          {/* 라인 합계 — 서버 계산값. 품절 라인도 금액은 표시한다(목업 실측) */}
          <span className="ml-auto text-right text-[17px] font-extrabold">
            {formatKrw(cartLine.lineTotal)}
          </span>
        </div>
      </div>
    </li>
  )
}

/** 로딩 골격 — 실제 레이아웃(리스트+요약 2컬럼)과 치수를 맞춰 시프트를 막는다 */
function CartViewSkeleton() {
  return (
    <SkeletonGroup
      loadingLabel="장바구니를 불러오는 중입니다"
      className="mt-[18px] md:grid md:grid-cols-[minmax(0,1fr)_340px] md:items-start md:gap-8 min-[1040px]:grid-cols-[minmax(0,1fr)_372px] min-[1040px]:gap-10"
    >
      <div className="min-w-0">
        <div className="border-b-2 border-foreground pb-3">
          <Skeleton className="h-6 w-40" />
        </div>
        {[0, 1, 2].map((rowIndex) => (
          <div key={rowIndex} className="flex gap-3 border-b border-border py-[18px]">
            <Skeleton className="size-[88px] shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-auto h-6 w-24 self-end" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-7 h-[280px] rounded-lg md:mt-0" />
    </SkeletonGroup>
  )
}

export function CartView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { showToast } = useToast()

  const cartQuery = useQuery(trpc.cart.getCart.queryOptions())

  /* 선택 상태는 '해제된 라인' 집합으로 관리한다 — 기본이 전체선택이라(목업 실측),
     재조회로 새 라인이 늘어나도 자동으로 선택 상태가 된다 */
  const [deselectedCartItemIds, setDeselectedCartItemIds] = React.useState<Set<number>>(
    () => new Set()
  )
  const [bulkRemovePending, setBulkRemovePending] = React.useState(false)

  const updateQuantityMutation = useMutation(trpc.cart.updateQuantity.mutationOptions())
  const removeItemMutation = useMutation(trpc.cart.removeItem.mutationOptions())
  const restoreItemMutation = useMutation(trpc.cart.addItem.mutationOptions())

  /* 카트 화면 캐시와 헤더 뱃지(서버 렌더)를 함께 갱신한다 —
     뱃지는 (store) 레이아웃이 서버에서 세므로 router.refresh()가 필요하다 */
  const refreshCartEverywhere = React.useCallback(() => {
    void queryClient.invalidateQueries(trpc.cart.pathFilter())
    router.refresh()
  }, [queryClient, router, trpc])

  /* 실행취소 = 삭제 스냅샷 재담기(removeItem 반환값이 addItem 입력과 호환) */
  const restoreRemovedLines = React.useCallback(
    async (removedSnapshots: RemovedCartLineSnapshot[]) => {
      try {
        const restoreResults = await Promise.all(
          removedSnapshots.map((removedSnapshot) =>
            restoreItemMutation.mutateAsync({
              variantId: removedSnapshot.variantId,
              quantity: removedSnapshot.quantity,
              addons:
                removedSnapshot.addons.length > 0 ? removedSnapshot.addons : undefined,
            })
          )
        )
        // 삭제와 실행취소 사이 재고가 줄었을 수 있다 — 보정 발생 시 원인+해결을 안내
        if (restoreResults.some((restoreResult) => restoreResult.stockLimited)) {
          showToast("다시 담았어요. 일부 상품은 남은 재고만큼만 담겼어요.", {
            toastVariant: "info",
          })
        } else {
          showToast("상품을 다시 담았어요")
        }
      } catch (restoreError) {
        showToast(
          restoreError instanceof Error
            ? restoreError.message
            : "다시 담지 못했어요. 잠시 후 시도해 주세요.",
          { toastVariant: "error" }
        )
      } finally {
        refreshCartEverywhere()
      }
    },
    [restoreItemMutation, showToast, refreshCartEverywhere]
  )

  if (cartQuery.isPending) return <CartViewSkeleton />

  if (cartQuery.isError) {
    return (
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
        title="장바구니를 불러오지 못했어요"
        description="일시적인 문제일 수 있어요. 잠시 후 다시 시도해 주세요."
        actions={[{ label: "다시 시도", onAction: () => void cartQuery.refetch() }]}
      />
    )
  }

  const { lines: cartLines, summary: cartSummary } = cartQuery.data

  // 빈 카트 — 오류빈상태.dc.html 'cart' 케이스. 무료배송 문구는 서버 정책값으로 조립(하드코딩 금지)
  if (cartLines.length === 0) {
    return (
      <EmptyState
        size="section"
        stateTone="brand"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path
              d="M6 7h13l-1.2 8.4a2 2 0 0 1-2 1.7H9.2a2 2 0 0 1-2-1.7L6 4H3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M9.5 20.5v.2" strokeLinecap="round" />
            <path d="M16.5 20.5v.2" strokeLinecap="round" />
          </svg>
        }
        title="장바구니가 비어 있어요"
        description={
          cartSummary.freeShippingRemaining > 0
            ? `마음에 드는 상품을 담아 보세요. ${formatKrw(cartSummary.freeShippingRemaining)} 이상 구매 시 무료배송 혜택도 받을 수 있어요.`
            : "마음에 드는 상품을 담아 보세요."
        }
        actions={[{ label: "쇼핑하러 가기", href: "/products" }]}
      />
    )
  }

  const selectableLines = cartLines.filter(
    (cartLine) => !cartLine.soldOut && !cartLine.unavailable
  )
  const selectedLines = selectableLines.filter(
    (cartLine) => !deselectedCartItemIds.has(cartLine.cartItemId)
  )
  const allSelected =
    selectableLines.length > 0 && selectedLines.length === selectableLines.length

  /* 표시용 분해 행 — 합계 확정은 서버 summary가 한다(RULE-11).
     아래 두 값은 서버가 내려준 라인 데이터의 산술 재배열이라 grandTotal과 어긋나지 않는다. */
  const goodsAmount = selectableLines.reduce(
    (sum, cartLine) => sum + cartLine.unitPrice * cartLine.quantity,
    0
  )
  const addonAmount = selectableLines.reduce(
    (sum, cartLine) =>
      sum +
      cartLine.addons.reduce(
        (lineSum, lineAddon) => lineSum + lineAddon.addonPrice * lineAddon.addonQuantity,
        0
      ),
    0
  )

  const handleToggleAll = () => {
    // 가용 라인이 전부 선택돼 있으면 전부 해제, 아니면 전부 선택 — 품절 라인은 건드리지 않는다(목업 실측)
    setDeselectedCartItemIds(
      allSelected
        ? new Set(selectableLines.map((cartLine) => cartLine.cartItemId))
        : new Set()
    )
  }

  const handleToggleLine = (cartItemId: number) => {
    setDeselectedCartItemIds((previousIds) => {
      const nextIds = new Set(previousIds)
      if (nextIds.has(cartItemId)) nextIds.delete(cartItemId)
      else nextIds.add(cartItemId)
      return nextIds
    })
  }

  const handleChangeQuantity = (targetLine: CartLine, nextQuantity: number) => {
    if (nextQuantity < 1 || updateQuantityMutation.isPending) return
    // 재고 초과 '증가'는 왕복 없이 즉시 원인+해결을 안내한다(상품 패널과 동일 규칙).
    // 감소는 재고 초과 상태(담은 뒤 재고가 줄어든 라인)에서도 허용 — 서버가 재고로 클램프해 준다.
    if (nextQuantity > targetLine.stock && nextQuantity > targetLine.quantity) {
      showToast(`재고가 ${targetLine.stock}개 남았습니다. 수량을 조정해 주세요.`, {
        toastVariant: "info",
      })
      return
    }
    updateQuantityMutation.mutate(
      { cartItemId: targetLine.cartItemId, quantity: nextQuantity },
      {
        onSuccess: (updateResult) => {
          if (updateResult.stockLimited) {
            showToast(
              `재고가 ${updateResult.availableStock}개 남았습니다. 수량을 조정했어요.`,
              { toastVariant: "info" }
            )
          }
          void queryClient.invalidateQueries(trpc.cart.pathFilter())
        },
        onError: (updateError) => {
          showToast(updateError.message, { toastVariant: "error" })
          // 실패 원인(라인 소실·품절 전환 등)이 화면에 반영되도록 재조회한다
          void queryClient.invalidateQueries(trpc.cart.pathFilter())
        },
      }
    )
  }

  const handleRemoveLine = (targetLine: CartLine) => {
    if (removeItemMutation.isPending || bulkRemovePending) return
    removeItemMutation.mutate(
      { cartItemId: targetLine.cartItemId },
      {
        onSuccess: (removedSnapshot) => {
          refreshCartEverywhere()
          showToast("상품을 삭제했어요", {
            undoAction: { onUndo: () => void restoreRemovedLines([removedSnapshot]) },
          })
        },
        onError: (removeError) => showToast(removeError.message, { toastVariant: "error" }),
      }
    )
  }

  const handleRemoveSelected = async () => {
    // aria-disabled는 클릭을 막지 않는다 — 재진입은 여기서 차단
    if (removeItemMutation.isPending || bulkRemovePending) return
    if (selectedLines.length === 0) {
      // 목업 실측: 선택 0개는 모달·삭제 없이 안내만
      showToast("선택된 상품이 없어요", { toastVariant: "info" })
      return
    }
    setBulkRemovePending(true)
    try {
      const removedSnapshots = await Promise.all(
        selectedLines.map((selectedLine) =>
          removeItemMutation.mutateAsync({ cartItemId: selectedLine.cartItemId })
        )
      )
      showToast(`상품 ${removedSnapshots.length}개를 삭제했어요`, {
        undoAction: { onUndo: () => void restoreRemovedLines(removedSnapshots) },
      })
    } catch (bulkRemoveError) {
      showToast(
        bulkRemoveError instanceof Error
          ? bulkRemoveError.message
          : "삭제하지 못했어요. 잠시 후 다시 시도해 주세요.",
        { toastVariant: "error" }
      )
    } finally {
      setBulkRemovePending(false)
      refreshCartEverywhere()
    }
  }

  // TODO(체크아웃 배선): /checkout 이동으로 교체 — 지금은 안내 토스트 스텁
  const handleCheckoutClick = () => {
    showToast("주문/결제 화면은 아직 준비 중이에요. 곧 열릴 예정입니다.", {
      toastVariant: "info",
    })
  }

  const pendingQuantityCartItemId = updateQuantityMutation.isPending
    ? (updateQuantityMutation.variables?.cartItemId ?? null)
    : null
  const removeControlsPending = removeItemMutation.isPending || bulkRemovePending
  const checkoutDisabled = cartSummary.subtotal === 0 || removeControlsPending

  return (
    <>
      <div className="mt-[18px] md:grid md:grid-cols-[minmax(0,1fr)_340px] md:items-start md:gap-8 min-[1040px]:grid-cols-[minmax(0,1fr)_372px] min-[1040px]:gap-10">
        {/* ── 품목 리스트 ── */}
        <section aria-label="장바구니 상품 목록" className="min-w-0">
          <div className="flex items-center justify-between gap-3 border-b-2 border-foreground pb-3">
            {/* 전체선택 — 분모는 품절 제외 가용 라인 수(목업 availText) */}
            <button
              type="button"
              aria-pressed={allSelected}
              disabled={selectableLines.length === 0}
              onClick={handleToggleAll}
              className="flex min-h-11 cursor-pointer items-center gap-[9px] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CartCheckMark checked={allSelected} disabled={selectableLines.length === 0} />
              전체선택{" "}
              <span className="font-semibold text-muted-foreground">
                ({selectedLines.length}/{selectableLines.length})
              </span>
            </button>
            {/* 필 버튼 — 목업 40px에서 44px 상향(KWCAG 터치 타겟).
                pending은 aria-disabled — hard disabled는 포커스를 유실시킨다(재진입은 핸들러 가드) */}
            <button
              type="button"
              aria-disabled={removeControlsPending}
              onClick={() => void handleRemoveSelected()}
              className="min-h-11 cursor-pointer rounded-full border border-border bg-card px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-foreground hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              선택 삭제
            </button>
          </div>

          <ul className="m-0 list-none p-0">
            {cartLines.map((cartLine) => {
              const lineSelectable = !cartLine.soldOut && !cartLine.unavailable
              return (
                <CartLineRow
                  key={cartLine.cartItemId}
                  cartLine={cartLine}
                  lineSelectable={lineSelectable}
                  lineSelected={
                    lineSelectable && !deselectedCartItemIds.has(cartLine.cartItemId)
                  }
                  quantityPending={pendingQuantityCartItemId === cartLine.cartItemId}
                  removePending={removeControlsPending}
                  onToggleSelect={() => handleToggleLine(cartLine.cartItemId)}
                  onRemove={() => handleRemoveLine(cartLine)}
                  onChangeQuantity={(nextQuantity) =>
                    handleChangeQuantity(cartLine, nextQuantity)
                  }
                />
              )
            })}
          </ul>

          <Link
            href="/products"
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 pt-4 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            쇼핑 계속하기
          </Link>
        </section>

        {/* ── 요약 패널 ── */}
        <aside aria-label="결제 예정 금액" className="mt-7 md:sticky md:top-4 md:mt-0 md:self-start">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="m-0 mb-4 font-heading text-[17px] font-extrabold">
              결제 예정 금액
            </h2>
            <dl className="m-0 flex flex-col gap-2.5 text-sm">
              <div className="flex justify-between gap-2.5">
                <dt className="text-muted-foreground">총 상품금액</dt>
                <dd className="m-0 font-semibold">{formatKrw(goodsAmount)}</dd>
              </div>
              {addonAmount > 0 && (
                <div className="flex justify-between gap-2.5">
                  <dt className="text-muted-foreground">추가상품</dt>
                  <dd className="m-0 font-semibold">+{formatKrw(addonAmount)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2.5">
                <dt className="text-muted-foreground">배송비</dt>
                <dd className="m-0 font-semibold">
                  {cartSummary.shippingFee === 0
                    ? "무료"
                    : formatKrw(cartSummary.shippingFee)}
                </dd>
              </div>
            </dl>

            {/* 무료배송 진행 안내 — 서버 계산값(freeShippingRemaining) 기준 3분기 */}
            <div className="mt-3 rounded-[calc(var(--radius)-5px)] bg-secondary px-3 py-2.5 text-xs leading-[1.5] font-bold text-secondary-foreground">
              {cartSummary.subtotal === 0
                ? "주문할 수 있는 상품을 담으면 배송비가 계산돼요"
                : cartSummary.freeShippingRemaining > 0
                  ? `${formatKrw(cartSummary.freeShippingRemaining)} 더 담으면 무료배송!`
                  : "무료배송이 적용됐어요"}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2.5 border-t border-border pt-4">
              <span className="text-[15px] font-extrabold">결제 예정</span>
              <span className="font-heading text-[clamp(22px,3vw,26px)] font-extrabold">
                {formatKrw(cartSummary.grandTotal)}
              </span>
            </div>

            {/* CTA — 데스크톱 전용(모바일은 하단 결제 바) */}
            <div className="mt-[18px] hidden md:block">
              <Button
                type="button"
                variant="primary"
                size="lg-54"
                className="w-full"
                disabled={checkoutDisabled}
                onClick={handleCheckoutClick}
              >
                {cartSummary.subtotal === 0
                  ? "주문할 상품을 담아 주세요"
                  : `${formatKrw(cartSummary.grandTotal)} 결제하기`}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* ── 모바일 하단 결제 바 — -mx-4는 페이지 래퍼의 px-4(모바일)를 상쇄해 전폭으로 깐다 ── */}
      <div className="sticky bottom-0 z-[150] -mx-4 mt-4 flex flex-col gap-2 border-t border-border bg-card px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] md:hidden">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold text-muted-foreground">결제 예정</span>
          <span className="text-lg font-extrabold">
            {formatKrw(cartSummary.grandTotal)}
          </span>
        </div>
        <Button
          type="button"
          variant="primary"
          size="lg-52"
          className="w-full"
          disabled={checkoutDisabled}
          onClick={handleCheckoutClick}
        >
          {cartSummary.subtotal === 0
            ? "주문할 상품을 담아 주세요"
            : `${formatKrw(cartSummary.grandTotal)} 결제하기`}
        </Button>
      </div>
    </>
  )
}
