// 핸드오프 규격: 상품목록.dc.html — 브레드크럼·h1(L176~184) · 그리드 2/3/4열(L59,81,88) ·
// 페이지네이션 44px·전체 번호 나열(L77~80, L509) · 빈 상태(L241~248) · PAGE_SIZE=12(L419)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업의 사이드바(카테고리별 개수·가격대·혜택 필터)와 모바일 필터 바텀시트는 미구현 —
//    getProductListPage가 카테고리·정렬·페이지만 지원한다(서비스는 읽기 전용). 카테고리는 칩(컨트롤)이 담당.
//  - 컨테이너 쿼리(@container store) 대신 뷰포트 기준 min-[600px]/md/min-[1080px]로 환산 — store-header 선례.
//  - 페이지네이션은 목업의 button+state가 아니라 링크 — URL이 상태 원본이라 새로고침·공유·뒤로가기가 보존된다.
//    현재 페이지는 이동할 곳이 없어 링크가 아닌 span(aria-current="page"), 양끝 화살표도 비활성 시 span(opacity .4).
//  - 빈 상태는 EmptyState panel 티어 — 목업 실측(테두리 카드·이모지 40px·18px/800 제목·44px 버튼)이
//    panel 규격과 일치하고, empty-state.tsx 스스로 '상품목록(panel)'로 매핑해 두었다.
//  - 범위 초과 page는 마지막 페이지로 클램프(목업 Math.min(s.page,pages)와 동일 의도) — 이때만 1회 재조회.

import Link from "next/link"

import { ProductListControls } from "@/components/store/product-list-controls"
import { StoreProductCard } from "@/components/store/product-card"
import { EmptyState } from "@/components/ui/empty-state"
import { db } from "@/db"
import {
  getStoreNavCategories,
  resolveCategoryPlacement,
} from "@/server/services/category.service"
import {
  getProductListPage,
  type ProductSort,
} from "@/server/services/product.service"
import { cn } from "@/lib/utils"

const PRODUCT_SORT_VALUES: readonly ProductSort[] = [
  "latest",
  "price_low",
  "price_high",
  "popular",
]

type ProductListSearchParams = {
  category?: string | string[]
  /** 검색어 — 통합검색(/search)의 "전체 보기"가 이 목록으로 넘긴다 */
  q?: string | string[]
  sort?: string | string[]
  page?: string | string[]
}

/** 같은 키가 중복 전달되면(?sort=a&sort=b) 첫 값만 쓴다 */
function firstParam(rawValue: string | string[] | undefined): string | undefined {
  return Array.isArray(rawValue) ? rawValue[0] : rawValue
}

function parseCategorySlug(rawValue: string | string[] | undefined): string | null {
  const categoryValue = firstParam(rawValue)
  // "all"은 category 테이블에 없는 UI 전용 값(store-header ALL_CATEGORY_SLUG) — 미필터로 정규화
  if (!categoryValue || categoryValue === "all") return null
  return categoryValue
}

function parseSort(rawValue: string | string[] | undefined): ProductSort {
  const sortValue = firstParam(rawValue)
  return PRODUCT_SORT_VALUES.find((candidate) => candidate === sortValue) ?? "latest"
}

function parsePage(rawValue: string | string[] | undefined): number {
  const pageValue = Number.parseInt(firstParam(rawValue) ?? "", 10)
  return Number.isNaN(pageValue) || pageValue < 1 ? 1 : pageValue
}

/** 목록 쿼리 조립 — 기본값은 파라미터를 생략해 정규 URL을 유지한다(컨트롤의 조립 규칙과 동일해야 함) */
function productListHref(
  categorySlug: string | null,
  sort: ProductSort,
  pageNumber: number,
  keyword: string,
): string {
  const listQuery = new URLSearchParams()
  if (categorySlug) listQuery.set("category", categorySlug)
  // 검색어를 빠뜨리면 2페이지로 넘어가는 순간 검색이 풀려 전체 목록이 나온다
  if (keyword) listQuery.set("q", keyword)
  if (sort !== "latest") listQuery.set("sort", sort)
  if (pageNumber > 1) listQuery.set("page", String(pageNumber))
  const queryString = listQuery.toString()
  return queryString ? `/products?${queryString}` : "/products"
}

/** 페이지네이션 공통 규격 — 44×44 터치 타겟(목업 [data-pg]) */
const PAGE_ITEM_CLASS =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-sm px-1 text-sm font-semibold"

function PageArrowIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        d={direction === "prev" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default async function ProductListPage({
  searchParams,
}: {
  searchParams: Promise<ProductListSearchParams>
}) {
  const rawParams = await searchParams
  const categorySlug = parseCategorySlug(rawParams.category)
  const keyword = (firstParam(rawParams.q) ?? "").trim()
  const sort = parseSort(rawParams.sort)
  const requestedPage = parsePage(rawParams.page)

  const [navCategories, firstFetch] = await Promise.all([
    getStoreNavCategories(db),
    getProductListPage(db, {
      categorySlug: categorySlug ?? undefined,
      keyword: keyword || undefined,
      sort,
      page: requestedPage,
    }),
  ])

  const lastPage = Math.max(1, Math.ceil(firstFetch.totalCount / firstFetch.pageSize))
  const productListPage =
    requestedPage > lastPage
      ? await getProductListPage(db, {
          categorySlug: categorySlug ?? undefined,
          keyword: keyword || undefined,
          sort,
          page: lastPage,
        })
      : firstFetch
  const currentPage = Math.min(requestedPage, lastPage)

  // 계층 위치 — 빵부스러기·칩·제목이 같은 판정을 쓴다(서버가 단일 진실원).
  // 존재하지 않는 slug면 slug 원문을 그대로 보여 빈 결과의 원인이 드러나게 한다.
  const placement = resolveCategoryPlacement(navCategories, categorySlug)
  const categoryLabel =
    categorySlug === null
      ? "전체"
      : (placement.child?.name ?? placement.root?.name ?? categorySlug)

  const pageNumbers = Array.from({ length: lastPage }, (_, pageIndex) => pageIndex + 1)

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-10 md:px-10">
      {/* 브레드크럼 — 현재 위치는 링크가 아니므로 span + aria-current */}
      <nav aria-label="위치" className="flex items-center gap-1.5 text-xs">
        <Link href="/" className="text-muted-foreground transition-colors hover:text-primary">
          홈
        </Link>
        <span aria-hidden="true" className="text-muted-foreground">
          ›
        </span>
        {/* 중분류를 보고 있으면 대분류가 한 단계 끼어든다 — 계층을 보여주고 상위로 올라갈 길을 준다 */}
        {placement.child && placement.root ? (
          <>
            <Link
              href={productListHref(placement.root.slug, sort, 1, keyword)}
              className="text-muted-foreground transition-colors hover:text-primary"
            >
              {placement.root.name}
            </Link>
            <span aria-hidden="true" className="text-muted-foreground">
              ›
            </span>
          </>
        ) : null}
        <span aria-current="page" className="font-semibold text-foreground">
          {categoryLabel}
        </span>
      </nav>

      <div className="mt-2.5 mb-[18px] flex flex-wrap items-baseline gap-2.5">
        <h1 className="font-heading text-[clamp(22px,3.4vw,32px)] font-extrabold tracking-[-0.01em]">
          {categoryLabel}
        </h1>
        <span className="text-sm text-muted-foreground">
          총{" "}
          <b className="font-bold text-foreground">
            {productListPage.totalCount.toLocaleString("ko-KR")}
          </b>
          개
        </span>
      </div>

      <ProductListControls
        categoryChips={placement.chips}
        chipsAllSlug={placement.chipsAllSlug}
        activeCategorySlug={categorySlug}
        activeKeyword={keyword}
        activeSort={sort}
      />

      {productListPage.cards.length === 0 ? (
        <EmptyState
          size="panel"
          icon={<span>🫙</span>}
          iconSize={40}
          // 검색으로 들어온 빈 결과에 "필터를 조정하세요"라고 하면 조정할 필터가 없어 막힌다
          title={keyword ? `‘${keyword}’ 검색 결과가 없어요` : "조건에 맞는 상품이 없어요"}
          description={
            keyword
              ? "다른 검색어로 찾아보시거나 전체 상품에서 둘러보세요."
              : "필터를 조정하면 더 많은 상품을 볼 수 있어요."
          }
          // 초기화는 카테고리·검색어·페이지를 되돌린다 — 정렬은 필터가 아니다(목업 초기화도 정렬은 유지)
          actions={[
            {
              label: keyword ? "전체 상품 보기" : "필터 초기화",
              href: productListHref(null, sort, 1, ""),
            },
          ]}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3 min-[600px]:gap-4 min-[1080px]:grid-cols-4 min-[1080px]:gap-[18px]">
          {productListPage.cards.map((productCard) => (
            <StoreProductCard key={productCard.productId} productCard={productCard} />
          ))}
        </div>
      )}

      {lastPage > 1 && (
        <nav
          aria-label="페이지 이동"
          className="mt-8 flex flex-wrap items-center justify-center gap-1.5"
        >
          {currentPage > 1 ? (
            <Link
              href={productListHref(categorySlug, sort, currentPage - 1, keyword)}
              aria-label="이전 페이지"
              className={cn(PAGE_ITEM_CLASS, "text-foreground transition-colors hover:bg-muted")}
            >
              <PageArrowIcon direction="prev" />
            </Link>
          ) : (
            // 첫 페이지의 '이전'은 목적지가 없다 — 자리 유지용 비활성 표시(목업 disabled opacity .4)
            <span
              aria-hidden="true"
              className={cn(PAGE_ITEM_CLASS, "cursor-not-allowed text-foreground opacity-40")}
            >
              <PageArrowIcon direction="prev" />
            </span>
          )}

          {pageNumbers.map((pageNumber) =>
            pageNumber === currentPage ? (
              <span
                key={pageNumber}
                aria-current="page"
                className={cn(PAGE_ITEM_CLASS, "bg-primary text-primary-foreground")}
              >
                {pageNumber}
              </span>
            ) : (
              <Link
                key={pageNumber}
                href={productListHref(categorySlug, sort, pageNumber, keyword)}
                aria-label={`${pageNumber}페이지`}
                className={cn(
                  PAGE_ITEM_CLASS,
                  "text-foreground transition-colors hover:bg-muted",
                )}
              >
                {pageNumber}
              </Link>
            ),
          )}

          {currentPage < lastPage ? (
            <Link
              href={productListHref(categorySlug, sort, currentPage + 1, keyword)}
              aria-label="다음 페이지"
              className={cn(PAGE_ITEM_CLASS, "text-foreground transition-colors hover:bg-muted")}
            >
              <PageArrowIcon direction="next" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className={cn(PAGE_ITEM_CLASS, "cursor-not-allowed text-foreground opacity-40")}
            >
              <PageArrowIcon direction="next" />
            </span>
          )}
        </nav>
      )}
    </div>
  )
}
