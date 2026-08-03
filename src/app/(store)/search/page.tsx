import type { Metadata } from "next";
import Link from "next/link";

import { StoreProductCard } from "@/components/store/product-card";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { SEARCH_KEYWORD_MIN_LENGTH, searchStore } from "@/server/services/search.service";

/**
 * 통합 검색 결과 — 헤더 검색창이 `?q=`로 GET 제출한다.
 *
 * 상품·이야기·도움말을 한 화면에 모은다. 상품만 찾으면 "배송비" 같은 질문에 아무것도
 * 안 나오고, 고객은 검색창을 두 번 쓰지 않는다.
 *
 * 서버 컴포넌트로 그린다 — 검색 결과는 URL이 곧 상태라 뒤로가기·공유가 그대로 동작해야 한다.
 */
export const metadata: Metadata = { title: "검색" };
export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const keyword = (Array.isArray(q) ? q[0] : q) ?? "";
  const searchResult = await searchStore(db, { keyword });

  const hasAnyResult =
    searchResult.products.length > 0 || searchResult.documents.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 font-heading text-2xl font-extrabold">
        {searchResult.keyword ? `‘${searchResult.keyword}’ 검색 결과` : "검색"}
      </h1>

      {/* 검색어가 없거나 너무 짧은 경우 — 결과 0건과 구분해서 알린다.
          "결과가 없습니다"만 보여주면 고객은 상품이 없다고 오해한다 */}
      {!searchResult.keyword ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          title="찾으시는 것을 입력해 주세요"
          description="상품 이름은 물론 배송·교환 같은 안내도 함께 찾아드려요."
          actions={[{ label: "전체 상품 보기", href: "/products" }]}
        />
      ) : searchResult.keywordTooShort ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          title={`검색어를 ${SEARCH_KEYWORD_MIN_LENGTH}자 이상 입력해 주세요`}
          description="한 글자로는 결과가 너무 많아 원하시는 것을 찾기 어려워요."
        />
      ) : !hasAnyResult ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          title="검색 결과가 없어요"
          description="다른 검색어로 찾아보시거나, 전체 상품에서 둘러보세요."
          actions={[
            { label: "전체 상품 보기", href: "/products" },
            { label: "고객센터", actionVariant: "ghost", href: "/support" },
          ]}
        />
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          {searchResult.products.length > 0 && (
            <section aria-labelledby="search-products-heading">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id="search-products-heading"
                  className="m-0 font-heading text-lg font-extrabold"
                >
                  상품
                </h2>
                <span className="text-[13px] text-muted-foreground">
                  {searchResult.productTotalCount}건
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                {searchResult.products.map((productCard) => (
                  <StoreProductCard key={productCard.productId} productCard={productCard} />
                ))}
              </div>
              {/* 상품이 한 페이지를 넘으면 목록 화면으로 넘긴다 — 검색 결과에 페이징을 또 두면
                  같은 목록을 두 곳에서 관리하게 된다 */}
              {searchResult.productTotalCount > searchResult.products.length && (
                <p className="m-0 mt-4 text-center text-[13px]">
                  <Link
                    href={`/products?q=${encodeURIComponent(searchResult.keyword)}`}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    상품 {searchResult.productTotalCount}건 전체 보기
                  </Link>
                </p>
              )}
            </section>
          )}

          {searchResult.documents.length > 0 && (
            <section aria-labelledby="search-documents-heading">
              <h2
                id="search-documents-heading"
                className="m-0 mb-3 font-heading text-lg font-extrabold"
              >
                이야기 · 도움말
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {searchResult.documents.map((searchDocument) => (
                  <li key={searchDocument.href}>
                    <Link
                      href={searchDocument.href}
                      className="block rounded-[var(--radius)] border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="text-[12px] font-bold text-primary">
                        {searchDocument.documentKind === "story"
                          ? "이야기"
                          : (searchDocument.groupLabel ?? "도움말")}
                      </span>
                      <b className="mt-0.5 block text-sm font-bold">{searchDocument.title}</b>
                      {searchDocument.excerpt && (
                        <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
                          {searchDocument.excerpt}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
