"use client"

// 핸드오프 규격: 상품목록.dc.html L252~283(카드 마크업) · 메인.dc.html L272~392(큐레이션/신상품/베스트) —
// 카드 자체 규격은 두 화면이 문자 단위 동일. 그리드·4열 전환점은 페이지가 소유하고 카드는 유동 폭이다.
// README L64: 카드 hover(그림자·이동)는 인덱스·이야기 카드 전용 — 상품 카드에는 카드 단위 hover 없음.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - "use client"인 이유: 찜·장바구니·재입고가 3주차 스텁(클릭 시 안내 토스트)이라 이벤트 핸들러가 필요하다.
//    직렬화 가능한 ProductCard 데이터만 받으므로 서버 페이지(메인·목록)가 그대로 임포트해 쓴다.
//  - 목업에는 카드→상세 링크가 없으나(전 카드 공통) 상품명에 /products/[slug] 스트레치드 링크를 추가 —
//    after 오버레이(z-1)가 카드 전체를 덮고, 하트(z-2)·CTA(z-2)만 그 위에서 클릭을 가로챈다.
//  - 하트 버튼은 목업 실측 38px 유지 + after 의사요소로 히트 영역만 44px 확장(KWCAG 터치 타겟).
//  - 품절 오버레이는 목업 DOM 순서(하트 위)를 따르되 pointer-events-none — 품절이어도 찜·상세 이동은 가능해야 한다.
//  - 뱃지·CTA 라운드는 목업 리터럴(7px·radius-3px) 대신 디자인 시스템 프리셋(Badge tag=rounded-sm, Button rounded-md)으로 수렴.

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { discountRate } from "@/domain/product"
import { formatKrw } from "@/lib/format"
import type { ProductCard } from "@/server/services/product.service"

import { ImagePlaceholder } from "./image-placeholder"

export type StoreProductCardProps = {
  productCard: ProductCard
  /** 메인 베스트(항상)·큐레이션(조건부) 진열 순위 — 지정 시 "n위" 뱃지. 목록·신상품은 미지정 */
  rankNumber?: number
}

export function StoreProductCard({ productCard, rankNumber }: StoreProductCardProps) {
  const { showToast } = useToast()
  const {
    slug,
    name,
    makerName,
    badgeLabel,
    sellingPrice,
    compareAtPrice,
    soldOut,
    thumbnailPath,
    thumbnailAlt,
  } = productCard

  const discountPercent = discountRate(sellingPrice, compareAtPrice)

  // TODO(3주차): 찜 토글·장바구니 담기·재입고 알림 실배선으로 교체 — 지금은 안내 토스트만
  const handleWishClick = () =>
    showToast(`찜 기능은 3주차에 열려요 · ${name}`, { toastVariant: "info" })
  const handleAddCartClick = () =>
    showToast(`장바구니 기능은 3주차에 열려요 · ${name}`, { toastVariant: "info" })
  const handleRestockNotifyClick = () =>
    showToast(`재입고 알림은 3주차에 열려요 · ${name}`, { toastVariant: "info" })

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

        {/* [1b] 찜 버튼 — 반투명 유리 원형 38px, after로 히트 영역 44px 확보 */}
        <button
          type="button"
          onClick={handleWishClick}
          aria-label={`찜하기 ${name}`}
          className="absolute top-1.5 right-1.5 z-[2] flex size-[38px] cursor-pointer items-center justify-center rounded-full border-none bg-[color-mix(in_oklch,var(--card)_78%,transparent)] text-muted-foreground backdrop-blur-[4px] after:absolute after:-inset-[3px] after:rounded-full after:content-['']"
        >
          <svg
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden="true"
          >
            <path d="M12 20.5 4.2 12.9a4.6 4.6 0 0 1 6.5-6.5l1.3 1.3 1.3-1.3a4.6 4.6 0 0 1 6.5 6.5Z" />
          </svg>
        </button>

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
            className="relative z-[2] mt-1 w-full"
          >
            장바구니 담기
          </Button>
        )}
      </div>
    </article>
  )
}
