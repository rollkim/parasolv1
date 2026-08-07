"use client";

// 핸드오프 규격: 상품목록.dc.html L230~236(정렬 select) · L383~386(CATS) · L437~446(필터·정렬 변경 시 page:1 리셋)
//
// URL 쿼리(/products?category&sort&page)가 상태의 단일 원본이다 — 칩·정렬 변경은 내부 state가 아니라
// router.push로 쿼리를 갱신하고 서버 페이지가 재조회한다. page 파라미터는 항상 제거 = page 1 리셋.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 정렬 5종 중 '추천순(recommend)'을 뺀 4종 — ProductSort(latest|price_low|price_high|popular)에 없고,
//    목업에서도 추천순·인기순 정렬 함수가 동일(sales 내림차순)이라 구분 근거가 없다. 기본값은 latest(신상품순).
//  - 칩 높이 38px → 44px 상향(KWCAG 터치 타겟 · store-header 칩 스트립 선례와 동일 규격).
//  - 가격대·혜택(할인/품절 제외) 필터와 모바일 필터 바텀시트는 미구현 —
//    getProductListPage가 카테고리·정렬·페이지만 지원해 화면만 먼저 만들 수 없다(서비스 확장 시 추가).

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProductSort } from "@/server/services/product.service";

import { ScrollRail } from "./scroll-rail";

export type ProductListCategoryChip = { slug: string; name: string };

export type ProductListControlsProps = {
  /**
   * 이 위치에서 한 단계 더 좁히는 칩('전체' 제외). 대분류를 보고 있으면 그 중분류가,
   * 전체를 보고 있으면 대분류가 온다 — 서버(resolveCategoryPlacement)가 정한다.
   */
  categoryChips: ProductListCategoryChip[];
  /**
   * '전체' 칩이 가리킬 slug. 대분류 안에서는 '그 대분류 전체'를 뜻하므로 대분류 slug가 오고,
   * 최상위에서는 null(필터 없음)이다.
   */
  chipsAllSlug: string | null;
  /** 현재 선택된 카테고리 — 중분류면 그 중분류 칩이 활성화된다 */
  activeCategorySlug: string | null;
  activeSort: ProductSort;
  /** 검색어 — 칩·정렬을 바꿔도 검색이 풀리지 않게 함께 싣는다 */
  activeKeyword: string;
};

const PRODUCT_SORT_OPTIONS: { sortValue: ProductSort; sortLabel: string }[] = [
  { sortValue: "latest", sortLabel: "신상품순" },
  { sortValue: "popular", sortLabel: "인기순" },
  { sortValue: "price_low", sortLabel: "낮은가격순" },
  { sortValue: "price_high", sortLabel: "높은가격순" },
];

/** 목록 쿼리 조립 — 기본값(전체·신상품순)은 파라미터를 생략해 /products가 정규 URL이 되게 한다 */
function productListHref(
  categorySlug: string | null,
  sort: ProductSort,
  keyword: string,
): string {
  const listQuery = new URLSearchParams();
  if (categorySlug) listQuery.set("category", categorySlug);
  if (keyword) listQuery.set("q", keyword);
  if (sort !== "latest") listQuery.set("sort", sort);
  const queryString = listQuery.toString();
  return queryString ? `/products?${queryString}` : "/products";
}

export function ProductListControls({
  categoryChips,
  chipsAllSlug,
  activeCategorySlug,
  activeSort,
  activeKeyword,
}: ProductListControlsProps) {
  const router = useRouter();

  // '전체'는 category 테이블에 없는 UI 항목이다. 최상위에서는 미필터(slug null)지만,
  // 대분류 안에서는 '그 대분류 전체'라 대분류 slug를 가리킨다.
  const chipItems: { slug: string | null; name: string }[] = [
    { slug: chipsAllSlug, name: "전체" },
    ...categoryChips,
  ];

  // 하위가 없는 대분류(잼·스프레드 등)에서는 줄 전체를 숨긴다.
  // 좁힐 것이 없는데 '전체' 하나만 남으면, 그 칩은 카테고리를 벗어나는 링크라 오히려 헷갈린다.
  const hasCategoryChips = categoryChips.length > 0;

  return (
    // [탭 순서] 목업 L121 주석의 7 카테고리 → 8 정렬을 DOM 순서로 그대로 구현 — tabindex 조작 없음
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {hasCategoryChips ? (
        <ScrollRail
          role="group"
          aria-label="카테고리 필터"
          // 이 레일은 페이지 배경 위에 있다 — 페이드를 card로 만들면 회색 띠처럼 보인다
          surface="background"
          // md에서는 flex-wrap이라 스크롤이 사라진다 → 장식도 함께 감춘다
          decorationsMobileOnly
          wrapperClassName="min-w-0 basis-full md:flex-1 md:basis-auto"
          // 모바일은 가로 스크롤, 데스크톱은 줄바꿈. -my는 스크롤 컨테이너가 포커스 링을 세로로 자르지 않게 하는 여유분
          className="-my-1 flex gap-2 overflow-x-auto py-1 pb-2 md:flex-wrap md:overflow-visible md:pb-1"
        >
          {chipItems.map((chipItem) => (
            <button
              key={chipItem.slug ?? "all"}
              type="button"
              aria-pressed={chipItem.slug === activeCategorySlug}
              onClick={() =>
                router.push(productListHref(chipItem.slug, activeSort, activeKeyword))
              }
              // 선택은 딥그린 솔리드가 아니라 소프트 그린(secondary = primary 계열 연한 색)이다.
              // 위 대분류 탭과 형태·농도를 다르게 해야 두 줄이 형제가 아니라 상하로 읽힌다.
              // 색만으로 알리지 않도록 굵기(600)와 테두리 색을 함께 바꾼다.
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border border-border bg-card px-[15px] text-[13px] whitespace-nowrap text-foreground transition-[colors,transform] duration-100 hover:bg-muted active:scale-[0.96] aria-pressed:border-primary aria-pressed:bg-secondary aria-pressed:font-semibold aria-pressed:text-primary aria-pressed:hover:bg-secondary"
            >
              {chipItem.name}
            </button>
          ))}
        </ScrollRail>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {/* 라벨 텍스트는 데스크톱 전용(목업 툴바) — 접근명은 트리거 aria-label이 담당하므로 장식 처리 */}
        <span
          aria-hidden="true"
          className="hidden text-[13px] font-semibold text-muted-foreground md:inline"
        >
          정렬
        </span>
        <Select
          value={activeSort}
          onValueChange={(nextSort) =>
            router.push(
              productListHref(activeCategorySlug, nextSort as ProductSort, activeKeyword),
            )
          }
        >
          <SelectTrigger selectPreset="storefrontSort" aria-label="정렬">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRODUCT_SORT_OPTIONS.map((sortOption) => (
              <SelectItem
                key={sortOption.sortValue}
                value={sortOption.sortValue}
              >
                {sortOption.sortLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
