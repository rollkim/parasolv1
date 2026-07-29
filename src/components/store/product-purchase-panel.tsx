"use client"

// 핸드오프 규격: 상품상세.dc.html L154~282(갤러리·구매정보) · L385~397(모바일 하단 구매바) ·
// L427~592(옵션·재고 스크립트) / 바텀시트는 오버레이모음.dc.html L210~227 마스터 패턴.
// [탭 순서](상세 L115): 썸네일 → 옵션 → 수량 → 추가상품 → 장바구니 담기 → 바로 구매 — DOM 순서로 보장한다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 옵션값별 추가금(+2,000) 별도 계산 없음: 가격은 variant가 소유한다(RULE-11 'variant가 판매 단위').
//    표기가 필요하면 관리자가 옵션값 라벨에 직접 적는다(목업도 라벨 문자열에 포함하는 방식).
//  - 추가상품 수량에 product_addon.stock 상한 적용(목업은 상한 없음 — 미발견): 실데이터에 재고 컬럼이
//    있고, 초과 시 즉시 보정+안내(UX 규칙 6)가 수량 전반의 규칙이라서다. 품절 추가상품은 텍스트로 병기.
//  - +스테퍼는 최대치에서 disabled가 아니라 토스트 안내(목업 스크립트 L495 실측 · '원인+해결' 안내 규칙).
//  - 모바일 하단 바의 담기·구매는 목업의 즉시 실행 대신 바텀시트로 같은 패널을 연다(지시 사양).
//  - '누적 판매 N' 표기는 ProductDetail에 판매량 필드가 없어 생략(서비스 읽기 전용 — 필드 추가 시 복원).
//  - 컨테이너 쿼리(@container store)는 헤더 선례를 따라 뷰포트 기준(md:768px / min-[1040px])으로 환산.
//  - 장바구니 담기는 cart.addItem 실배선. '바로 구매'는 체크아웃 미구현이라 담기 후 /cart 이동으로
//    대체한다 — TODO(체크아웃 배선 시 직행으로 교체).
//  - 찜은 WishlistHeartButton 실배선 — 로그인 판별·토글·하트 규격은 그 컴포넌트가 소유한다.
//  - 재입고 알림은 스텁 — 클릭 시 안내 토스트만. TODO(3주차)

import * as React from "react"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet"
import { useToast } from "@/components/ui/toast"
import { discountRate, findVariantByOptionValues } from "@/domain/product"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ProductDetail } from "@/server/services/product.service"
import { useTRPC } from "@/trpc/client"

import { ImagePlaceholder } from "./image-placeholder"
import { WishlistHeartButton } from "./wishlist-heart-button"

export type ProductPurchasePanelProps = {
  productDetail: ProductDetail
  /** 탭 영역(상세설명·리뷰·문의·배송안내) — 그리드 아래·모바일 구매바 위에 놓여야 해서 페이지가 주입한다 */
  children?: React.ReactNode
}

/** 저재고 안내 임계값 — 목업 실측(stock<=5 → '서두르세요') */
const LOW_STOCK_THRESHOLD = 5

function stockNoticeText(stock: number) {
  if (stock <= 0) return "품절"
  if (stock <= LOW_STOCK_THRESHOLD) return `재고 ${stock}개 · 서두르세요`
  return `재고 ${stock}개`
}

/* 추가상품 미니 스테퍼 공통 클래스 — 목업 38×40px 실측 유지 + after로 히트 영역 44×46px 확장(KWCAG) */
const addonStepButtonClass =
  "relative flex h-10 w-[38px] cursor-pointer items-center justify-center border border-border bg-card text-lg after:absolute after:-inset-[3px] after:content-[''] disabled:cursor-not-allowed disabled:opacity-35"

export function ProductPurchasePanel({
  productDetail,
  children,
}: ProductPurchasePanelProps) {
  const { showToast } = useToast()
  const {
    productId,
    name,
    makerName,
    reviewCount,
    ratingAverage,
    thumbnails,
    options,
    variants,
    addons,
  } = productDetail

  // 값이 하나도 없는 옵션 그룹은 조합 확정이 불가능한 데이터 이상이므로 제외한다
  const purchaseOptions = options.filter((group) => group.values.length > 0)
  const hasOptions = purchaseOptions.length > 0

  const [activeThumbIndex, setActiveThumbIndex] = React.useState(0)
  const [selectedValueByOptionId, setSelectedValueByOptionId] = React.useState<
    Record<number, number>
  >({})
  const [quantity, setQuantity] = React.useState(1)
  const [addonQuantityById, setAddonQuantityById] = React.useState<
    Record<number, number>
  >({})
  const [purchaseSheetOpen, setPurchaseSheetOpen] = React.useState(false)
  const [sheetIntent, setSheetIntent] = React.useState<"cart" | "buy">("cart")

  // ── variant 확정 (도메인 규칙 위임) ─────────────────────────────
  const selectedValueIds = purchaseOptions
    .map((group) => selectedValueByOptionId[group.optionId])
    .filter((valueId): valueId is number => valueId !== undefined)

  // 옵션 없는 상품은 단일 variant를 즉시 확정 — 옵션 UI 없이 바로 수량(핸드오프 UX 규칙 1)
  const confirmedVariant = !hasOptions
    ? (variants[0] ?? null)
    : selectedValueIds.length === purchaseOptions.length
      ? findVariantByOptionValues(variants, selectedValueIds)
      : null

  const variantSold = confirmedVariant !== null && confirmedVariant.stock <= 0
  const variantBuyable = confirmedVariant !== null && confirmedVariant.stock > 0

  const valueLabelById = new Map<number, string>()
  for (const group of purchaseOptions)
    for (const value of group.values)
      valueLabelById.set(value.optionValueId, value.valueLabel)

  const variantLabel = purchaseOptions
    .map((group) => {
      const selectedId = selectedValueByOptionId[group.optionId]
      return selectedId !== undefined ? valueLabelById.get(selectedId) : null
    })
    .filter(Boolean)
    .join(" · ")

  /* 품절 조합 판정(목업 renderVals L529~548): 상대 그룹이 선택돼 있으면 그 값과의 조합,
     미선택이면 전체 조합 후보 중 재고>0이 하나도 없으면 품절. 조합에 해당하는 variant가
     아예 없는 경우도 구매 불가이므로 품절로 본다([].every → true). */
  const isOptionValueSoldOut = (optionId: number, optionValueId: number) =>
    variants
      .filter(
        (variant) =>
          variant.optionValueIds.includes(optionValueId) &&
          purchaseOptions.every((group) => {
            if (group.optionId === optionId) return true
            const selectedId = selectedValueByOptionId[group.optionId]
            return (
              selectedId === undefined ||
              variant.optionValueIds.includes(selectedId)
            )
          })
      )
      .every((variant) => variant.stock <= 0)

  // ── 가격 표기: 확정 전 = 최저가 variant 기준("기본 구성 기준") ──
  const lowestPriceVariant =
    variants.length === 0
      ? null
      : variants.reduce((lowest, candidate) =>
          candidate.price < lowest.price ? candidate : lowest
        )
  const displayVariant = confirmedVariant ?? lowestPriceVariant
  const displayDiscountPercent = displayVariant
    ? discountRate(displayVariant.price, displayVariant.compareAtPrice)
    : null

  // ── 합계 ────────────────────────────────────────────────────────
  const addonTotalAmount = addons.reduce(
    (sum, addon) => sum + addon.price * (addonQuantityById[addon.addonId] ?? 0),
    0
  )
  const addonTotalCount = addons.reduce(
    (sum, addon) => sum + (addonQuantityById[addon.addonId] ?? 0),
    0
  )
  const totalAmount = (confirmedVariant?.price ?? 0) * quantity + addonTotalAmount
  const totalCount = quantity + addonTotalCount

  // ── 상호작용 ────────────────────────────────────────────────────
  const pickOptionValue = (optionId: number, optionValueId: number) => {
    setSelectedValueByOptionId((prev) => ({ ...prev, [optionId]: optionValueId }))
    // 옵션이 바뀌면 확정 variant가 달라지므로 수량·추가상품을 초기화한다(목업 pickOpt 실측)
    setQuantity(1)
    setAddonQuantityById({})
  }

  const resetOptions = () => {
    setSelectedValueByOptionId({})
    setQuantity(1)
    setAddonQuantityById({})
  }

  const increaseQuantity = () => {
    if (!confirmedVariant) return
    if (quantity >= confirmedVariant.stock) {
      showToast(
        `재고가 ${confirmedVariant.stock}개 남았습니다. 수량을 조정해 주세요.`,
        { toastVariant: "info" }
      )
      return
    }
    setQuantity((prev) => prev + 1)
  }

  const decreaseQuantity = () => setQuantity((prev) => Math.max(1, prev - 1))

  const handleQuantityInput: React.ChangeEventHandler<HTMLInputElement> = (
    changeEvent
  ) => {
    if (!confirmedVariant) return
    const parsed = Number.parseInt(
      changeEvent.target.value.replace(/[^0-9]/g, ""),
      10
    )
    if (!Number.isNaN(parsed) && parsed > confirmedVariant.stock) {
      showToast(
        `재고가 ${confirmedVariant.stock}개 남았습니다. 수량을 조정했어요.`,
        { toastVariant: "info" }
      )
    }
    // 목업 _clampQty: NaN·1 미만 → 1, 재고 초과 → 재고 (즉시 보정)
    setQuantity(
      Number.isNaN(parsed) || parsed < 1
        ? 1
        : Math.min(parsed, confirmedVariant.stock)
    )
  }

  const increaseAddonQuantity = (addon: ProductDetail["addons"][number]) => {
    const currentQuantity = addonQuantityById[addon.addonId] ?? 0
    if (currentQuantity >= addon.stock) {
      showToast(`재고가 ${addon.stock}개 남았습니다. 수량을 조정해 주세요.`, {
        toastVariant: "info",
      })
      return
    }
    setAddonQuantityById((prev) => ({
      ...prev,
      [addon.addonId]: currentQuantity + 1,
    }))
  }

  const decreaseAddonQuantity = (addonId: number) =>
    setAddonQuantityById((prev) => ({
      ...prev,
      [addonId]: Math.max(0, (prev[addonId] ?? 0) - 1),
    }))

  // ── 장바구니 담기 (cart.addItem 실배선) ─────────────────────────
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const addCartItemMutation = useMutation(trpc.cart.addItem.mutationOptions())
  const directBuyMutation = useMutation(trpc.cart.startDirectBuy.mutationOptions())
  /** 이미 담겨 있던 상품에 합쳐진 경우의 현재 수량 — null이면 안내가 뜨지 않는다 */
  const [mergedCartQuantity, setMergedCartQuantity] = React.useState<number | null>(null)

  const submitAddToCart = (afterAdd: "stay" | "goCart") => {
    if (!confirmedVariant || !variantBuyable || addCartItemMutation.isPending) return
    const selectedAddons = addons
      .filter((addon) => (addonQuantityById[addon.addonId] ?? 0) > 0)
      .map((addon) => ({
        addonId: addon.addonId,
        quantity: addonQuantityById[addon.addonId],
      }))
    addCartItemMutation.mutate(
      {
        variantId: confirmedVariant.variantId,
        quantity,
        addons: selectedAddons.length > 0 ? selectedAddons : undefined,
      },
      {
        onSuccess: (addResult) => {
          // 카트 화면 캐시 + 헤더 뱃지(서버 렌더 (store) 레이아웃)를 함께 갱신한다
          void queryClient.invalidateQueries(trpc.cart.pathFilter())
          router.refresh()

          // 이미 담겨 있던 상품 — 조용히 수량만 늘리면 지금 몇 개가 됐는지 알 수 없다.
          // 수량을 조정할 곳(장바구니)으로 갈지 물어본다.
          // 핸드오프 §5는 '파괴적 동작만 확인 모달'이지만, 이건 알림이 아니라 **선택을 묻는 것**이라
          // 토스트로는 표현할 수 없다(사용자 결정: 이동 여부를 묻는다).
          if (addResult.mergedIntoExisting) {
            setMergedCartQuantity(addResult.appliedQuantity)
            return
          }

          // 서버가 재고 초과를 보정해 담은 경우 — 원인+해결을 함께 안내(RULE-11)
          if (addResult.stockLimited) {
            showToast(
              `재고가 ${addResult.availableStock}개 남아 ${addResult.appliedQuantity}개로 담았어요.`,
              { toastVariant: "info" }
            )
          } else {
            showToast("장바구니에 담았어요")
          }
          if (afterAdd === "goCart") router.push("/cart")
        },
        onError: (addError) =>
          showToast(addError.message, { toastVariant: "error" }),
      }
    )
  }

  const handleAddCartClick = () => submitAddToCart("stay")

  /**
   * 바로 구매 — **장바구니와 무관하다.** 지금 화면에서 고른 옵션·수량 그대로 결제로 간다.
   *
   * 장바구니에 담아 합치면 담긴 수량과 더해져, 화면에서 1개를 골랐는데 결제창에 3개가 뜬다.
   * 서버가 임시 카트를 만들어 토큰을 주고, 체크아웃은 그 토큰으로 주문서를 그린다 —
   * 장바구니 쿠키는 그대로다.
   */
  const handleBuyNowClick = () => {
    if (!confirmedVariant || !variantBuyable || directBuyMutation.isPending) return
    const selectedAddons = addons
      .filter((addon) => (addonQuantityById[addon.addonId] ?? 0) > 0)
      .map((addon) => ({
        addonId: addon.addonId,
        quantity: addonQuantityById[addon.addonId],
      }))
    directBuyMutation.mutate(
      {
        variantId: confirmedVariant.variantId,
        quantity,
        addons: selectedAddons.length > 0 ? selectedAddons : undefined,
      },
      {
        onSuccess: (buyResult) => {
          // 재고가 모자라 수량이 줄었으면 결제 화면으로 넘어가기 전에 알린다
          if (buyResult.stockLimited) {
            showToast(
              `재고가 부족해 ${buyResult.appliedQuantity}개로 진행해요.`,
              { toastVariant: "info" },
            )
          }
          router.push(`/checkout?buy=${buyResult.buyToken}`)
        },
        onError: (buyError) => showToast(buyError.message, { toastVariant: "error" }),
      },
    )
  }
  // TODO(3주차): 재입고 알림 실배선으로 교체 — 지금은 안내 토스트만
  const handleRestockNotifyClick = () =>
    showToast(`재입고 알림은 3주차에 열려요 · ${name}`, { toastVariant: "info" })

  const openPurchaseSheet = (intent: "cart" | "buy") => {
    setSheetIntent(intent)
    setPurchaseSheetOpen(true)
  }
  const handleSheetConfirm = () => {
    setPurchaseSheetOpen(false)
    if (sheetIntent === "cart") handleAddCartClick()
    else handleBuyNowClick()
  }

  // ── 옵션 선택 + 확정 블록: 구매정보 열·바텀시트가 같은 UI를 공유한다 ──
  const purchaseOptionArea = (
    <div>
      {hasOptions && (
        <div className="flex flex-col gap-[18px] py-[18px]">
          {purchaseOptions.map((group) => (
            <div key={group.optionId} role="group" aria-label={group.optionName}>
              <div className="mb-2.5 text-[13px] font-extrabold">
                {group.optionName}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.values.map((value) => {
                  const valueSoldOut = isOptionValueSoldOut(
                    group.optionId,
                    value.optionValueId
                  )
                  const valueSelected =
                    selectedValueByOptionId[group.optionId] ===
                    value.optionValueId
                  return (
                    <Button
                      key={value.optionValueId}
                      type="button"
                      variant="toggle"
                      size="md-48"
                      className="px-4 text-[14px] font-semibold"
                      aria-pressed={valueSelected}
                      disabled={valueSoldOut}
                      onClick={() =>
                        pickOptionValue(group.optionId, value.optionValueId)
                      }
                    >
                      {value.valueLabel}
                      {/* 품절 = 색+점선·취소선(toggle disabled 내장)+텍스트 3중 전달(KWCAG) */}
                      {valueSoldOut && (
                        <span className="text-[11px] font-bold">품절</span>
                      )}
                    </Button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasOptions && !confirmedVariant && (
        <p className="border-t border-border pt-4 text-[13px] text-muted-foreground">
          옵션을 모두 선택하면 수량·추가상품과 합계가 표시됩니다.
        </p>
      )}

      {confirmedVariant && (
        <div className={cn("pt-4", hasOptions && "border-t border-border")}>
          {hasOptions ? (
            /* 선택 요약 칩 — variant 라벨 + 재고 문구 + 다시 선택 */
            <div className="flex items-start justify-between gap-2.5 rounded-md bg-secondary px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-sm font-bold text-secondary-foreground">
                  {variantLabel}
                </div>
                <div className="mt-[3px] text-xs font-bold text-secondary-foreground">
                  {stockNoticeText(confirmedVariant.stock)}
                </div>
              </div>
              {/* 텍스트 버튼 실측(12px) 유지 + after로 히트 영역 확장(KWCAG) */}
              <button
                type="button"
                onClick={resetOptions}
                className="relative shrink-0 cursor-pointer text-xs font-semibold text-secondary-foreground underline after:absolute after:-inset-x-2.5 after:-inset-y-3.5 after:content-['']"
              >
                다시 선택
              </button>
            </div>
          ) : (
            // 옵션 없는 상품은 칩 없이 재고 안내만 — 색이 아니라 텍스트로 전달
            <p className="text-xs font-bold text-muted-foreground">
              {stockNoticeText(confirmedVariant.stock)}
            </p>
          )}

          {variantSold && (
            <div className="mt-3.5 rounded-md border border-border bg-muted px-4 py-3.5">
              <p className="text-sm font-bold">
                {hasOptions ? "선택하신 옵션은 품절입니다" : "지금은 품절입니다"}
              </p>
              <p className="mt-1 mb-3 text-[13px] text-muted-foreground">
                {hasOptions
                  ? "다른 옵션을 선택하시거나 재입고 알림을 신청해 주세요."
                  : "재입고 알림을 신청하시면 입고 소식을 알려드려요."}
              </p>
              {/* 목업은 토스트 처리 — 정식 패턴(연락처 모달)은 3주차 재입고 알림 배선 때 도입 */}
              <Button
                type="button"
                variant="outline"
                size="md-48"
                className="w-full hover:border-foreground hover:bg-card"
                onClick={handleRestockNotifyClick}
              >
                재입고 알림 신청
              </Button>
            </div>
          )}

          {variantBuyable && (
            <>
              {/* 수량 스테퍼 — 44×46 버튼 / 56×46 인풋 (목업 실측) */}
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[13px] font-extrabold">수량</span>
                <div className="flex" role="group" aria-label="수량 선택">
                  <button
                    type="button"
                    aria-label="수량 줄이기"
                    disabled={quantity <= 1}
                    onClick={decreaseQuantity}
                    className="flex h-[46px] w-11 cursor-pointer items-center justify-center rounded-l-sm border border-border bg-card text-xl disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    −
                  </button>
                  <input
                    inputMode="numeric"
                    aria-label="수량"
                    value={quantity}
                    onChange={handleQuantityInput}
                    className="h-[46px] w-14 border-y border-border bg-card text-center text-[15px] font-bold"
                  />
                  <button
                    type="button"
                    aria-label="수량 늘리기"
                    onClick={increaseQuantity}
                    className="flex h-[46px] w-11 cursor-pointer items-center justify-center rounded-r-sm border border-border bg-card text-xl"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* 추가상품 — 옵션 확정 + 재고 있을 때만 노출(핸드오프 UX 규칙 3) */}
              {addons.length > 0 && (
                <div className="mt-[18px] rounded-md border border-dashed border-border bg-[color-mix(in_oklch,var(--accent)_8%,var(--card))] px-4 py-3.5">
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                    <svg
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="text-accent-foreground"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                    <span className="text-[13px] font-extrabold">
                      함께하면 좋은 추가상품
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      · 옵션과 별도로 담깁니다
                    </span>
                  </div>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {addons.map((addon) => {
                      const addonQuantity = addonQuantityById[addon.addonId] ?? 0
                      const addonSoldOut = addon.stock <= 0
                      return (
                        <li
                          key={addon.addonId}
                          className="flex items-center justify-between gap-2.5"
                        >
                          <span className="min-w-0 flex-1 text-sm font-semibold">
                            {addon.addonName}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            +{formatKrw(addon.price)}
                            {addonSoldOut && (
                              <span className="font-bold"> · 품절</span>
                            )}
                          </span>
                          <div className="flex items-center">
                            <button
                              type="button"
                              aria-label={`${addon.addonName} 줄이기`}
                              disabled={addonQuantity <= 0}
                              onClick={() => decreaseAddonQuantity(addon.addonId)}
                              className={cn(
                                addonStepButtonClass,
                                "rounded-l-[calc(var(--radius)-5px)]"
                              )}
                            >
                              −
                            </button>
                            <span
                              aria-live="polite"
                              className="flex h-10 w-10 items-center justify-center text-sm font-bold"
                            >
                              {addonQuantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`${addon.addonName} 늘리기`}
                              disabled={addonSoldOut}
                              onClick={() => increaseAddonQuantity(addon)}
                              className={cn(
                                addonStepButtonClass,
                                "rounded-r-[calc(var(--radius)-5px)]"
                              )}
                            >
                              +
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* 합계 — 변형가×수량 + 추가상품 합 */}
              <div className="mt-[18px] flex items-baseline justify-between border-t border-border pt-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-sm font-bold">합계</span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    총 {totalCount}개
                  </span>
                </div>
                <span className="font-heading text-[clamp(22px,3vw,28px)] font-extrabold">
                  {formatKrw(totalAmount)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  const activeThumbnail = thumbnails[activeThumbIndex] ?? thumbnails[0] ?? null

  return (
    <>
      {/* 2단 그리드: 갤러리 | 구매정보(360px → 1040px에서 408px). 모바일은 세로 적층 */}
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_360px] md:items-start md:gap-8 min-[1040px]:grid-cols-[minmax(0,1fr)_408px] min-[1040px]:gap-11">
        {/* ── 갤러리 ── */}
        <div className="mb-6 md:mb-0">
          <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
            {activeThumbnail ? (
              // 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeThumbnail.path}
                alt={activeThumbnail.alt}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <ImagePlaceholder className="absolute inset-0 h-full" />
            )}
          </div>
          {thumbnails.length > 1 && (
            <div className="mt-2.5 grid grid-cols-5 gap-2">
              {thumbnails.map((thumbnail, thumbnailIndex) => (
                <button
                  key={thumbnail.path}
                  type="button"
                  aria-label={`${thumbnail.alt} 이미지`}
                  aria-pressed={thumbnailIndex === activeThumbIndex}
                  onClick={() => setActiveThumbIndex(thumbnailIndex)}
                  className={cn(
                    "aspect-square cursor-pointer overflow-hidden rounded-sm border-2 bg-muted",
                    thumbnailIndex === activeThumbIndex
                      ? "border-primary"
                      : "border-transparent"
                  )}
                >
                  {/* 이름은 버튼 aria-label이 전달 — 이미지는 장식 취급 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbnail.path}
                    alt=""
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 구매정보 열 (데스크톱 sticky) ── */}
        <section
          aria-label="구매 정보"
          className="min-w-0 md:sticky md:top-4 md:self-start"
        >
          {makerName && (
            <div className="text-[13px] font-semibold text-muted-foreground">
              {makerName}
            </div>
          )}
          <h1 className="mt-1.5 mb-2.5 font-heading text-[clamp(22px,3.2vw,30px)] leading-[1.25] font-extrabold tracking-[-0.01em]">
            {name}
          </h1>

          {/* 별점 행 — ★는 장식, 수치·리뷰 수는 텍스트로 병기(색 단독 전달 금지) */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            {ratingAverage !== null && (
              <>
                <span
                  aria-hidden="true"
                  className="text-[15px] tracking-[1px] text-accent"
                >
                  ★★★★★
                </span>
                <span className="text-sm font-bold">{ratingAverage}점</span>
              </>
            )}
            {/* #reviews 해시 이동 — 탭 컴포넌트가 hashchange로 리뷰 탭을 활성화한다 */}
            <a
              href="#reviews"
              className="text-[13px] text-muted-foreground hover:text-primary"
            >
              리뷰 {reviewCount}개
            </a>
          </div>

          {/* 가격 행 — 확정 전엔 최저가 variant("기본 구성 기준") */}
          {displayVariant && (
            <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-4">
              {displayDiscountPercent !== null && (
                <span className="text-[clamp(22px,3vw,28px)] font-extrabold text-destructive">
                  {displayDiscountPercent}%
                </span>
              )}
              <span className="text-[clamp(22px,3vw,28px)] font-extrabold">
                {formatKrw(displayVariant.price)}
              </span>
              {displayDiscountPercent !== null &&
                displayVariant.compareAtPrice !== null && (
                  <del className="text-[15px] text-muted-foreground">
                    <span className="sr-only">정가 </span>
                    {formatKrw(displayVariant.compareAtPrice)}
                  </del>
                )}
              {hasOptions && (
                <span className="ml-auto text-[13px] text-muted-foreground">
                  {confirmedVariant ? "선택 옵션 기준" : "기본 구성 기준"}
                </span>
              )}
            </div>
          )}

          {purchaseOptionArea}

          {/* CTA — 데스크톱 전용(모바일은 하단 구매바) */}
          <div className="mt-5 hidden gap-2.5 md:flex">
            <WishlistHeartButton
              productId={productId}
              productName={name}
              heartAppearance="detailCta"
            />
            {/* pending은 hard disabled가 아니라 aria-disabled — disabled는 포커스를 body로
                떨어뜨려 키보드 완주(RULE-11)를 깬다. 재진입은 submitAddToCart 가드가 막는다 */}
            <Button
              type="button"
              variant="primary-outline"
              size="xl-56"
              className="flex-1"
              disabled={!variantBuyable}
              aria-disabled={addCartItemMutation.isPending}
              onClick={handleAddCartClick}
            >
              장바구니 담기
            </Button>
            <Button
              type="button"
              variant="primary"
              size="xl-56"
              className="flex-1"
              disabled={!variantBuyable}
              aria-disabled={addCartItemMutation.isPending}
              onClick={handleBuyNowClick}
            >
              바로 구매하기
            </Button>
          </div>
        </section>
      </div>

      {/* 탭 영역 슬롯 (상세설명·리뷰·문의·배송안내) */}
      {children}

      {/* ── 모바일 하단 구매바 — 담기·구매는 바텀시트로 같은 패널을 연다.
            -mx-4는 페이지 래퍼의 px-4(모바일)를 상쇄해 전폭으로 깐다 ── */}
      <div className="sticky bottom-0 z-[150] -mx-4 flex flex-col gap-2 border-t border-border bg-card px-3.5 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] md:hidden">
        {variantBuyable && (
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              합계 총 {totalCount}개
            </span>
            <span className="text-lg font-extrabold">
              {formatKrw(totalAmount)}
            </span>
          </div>
        )}
        <div className="flex items-stretch gap-2">
          <WishlistHeartButton
            productId={productId}
            productName={name}
            heartAppearance="detailBar"
          />
          <Button
            type="button"
            variant="outline"
            size="md-50"
            className="flex-1 font-extrabold"
            disabled={variantSold}
            onClick={() => openPurchaseSheet("cart")}
          >
            장바구니
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md-50"
            className="flex-[1.4]"
            disabled={variantSold}
            onClick={() => openPurchaseSheet("buy")}
          >
            바로 구매
          </Button>
        </div>
      </div>

      {/* 모바일 바텀시트 — 오버레이모음 마스터 패턴. 구매정보 열과 같은 상태를 공유한다 */}
      <Sheet open={purchaseSheetOpen} onOpenChange={setPurchaseSheetOpen}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          <SheetTitle className="mb-3.5">
            {hasOptions ? "옵션을 선택하세요" : "수량을 선택하세요"}
          </SheetTitle>
          <SheetBody>{purchaseOptionArea}</SheetBody>
          <SheetFooter>
            <Button
              type="button"
              variant="primary"
              size="lg-52"
              className="w-full"
              disabled={!variantBuyable || addCartItemMutation.isPending}
              onClick={handleSheetConfirm}
            >
              {sheetIntent === "cart" ? "장바구니 담기" : "바로 구매하기"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 이미 담겨 있던 상품 — 수량을 조정할 곳으로 갈지 묻는다.
          핸드오프 §5는 '파괴적 동작만 확인 모달'이지만 이건 알림이 아니라 선택을 묻는 것이라
          토스트로 표현할 수 없다(사용자 결정) */}
      <Dialog
        open={mergedCartQuantity !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setMergedCartQuantity(null)
        }}
      >
        <DialogContent className="max-w-[380px]">
          <DialogHeader>
            <DialogTitle>이미 장바구니에 있어요</DialogTitle>
            <DialogDescription>
              같은 옵션의 상품이 담겨 있어 수량이 {mergedCartQuantity ?? 0}개가 되었어요.
              장바구니에서 수량을 조정하시겠어요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="md-48"
              onClick={() => setMergedCartQuantity(null)}
            >
              계속 둘러보기
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md-48"
              onClick={() => {
                setMergedCartQuantity(null)
                router.push("/cart")
              }}
            >
              장바구니로 이동
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
