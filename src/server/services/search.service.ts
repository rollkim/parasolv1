import "server-only";

import { and, desc, eq, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { article, board, post } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { getProductListPage, type ProductCard } from "./product.service";

/**
 * 통합 검색 — 헤더 검색창(`/search?q=`)이 소비한다.
 *
 * **상품만 찾으면 검색이 아니라 상품 필터다.** 고객이 "배송비"를 검색하면 상품은 안 나오는 게
 * 정상이고, 그때 공지·FAQ가 나와야 검색창이 쓸모가 있다. 그래서 세 갈래를 함께 본다:
 * 상품 · 이야기 · 도움말(공지·FAQ).
 *
 * 검색 방식은 ILIKE 부분일치다. 상품 수천 건 규모까지는 충분하고, 그 이상으로 커지면
 * pg_trgm GIN 인덱스나 전문검색(tsvector)으로 갈아탄다 — 지금 넣으면 쓰지도 않는
 * 인덱스를 운영이 떠안는다.
 */

export const SEARCH_KEYWORD_MIN_LENGTH = 2;

export type SearchDocument = {
  /** 결과 묶음 구분 — 화면이 섹션을 나눈다 */
  documentKind: "story" | "help";
  title: string;
  /** 본문 미리보기 — 태그를 걷어낸 평문 */
  excerpt: string;
  href: string;
  /** 도움말은 게시판 이름(공지사항·자주 묻는 질문) */
  groupLabel: string | null;
};

export type StoreSearchResult = {
  keyword: string;
  /** 검색어가 너무 짧아 아예 조회하지 않았는지 — 화면이 "2자 이상" 안내를 띄운다 */
  keywordTooShort: boolean;
  products: ProductCard[];
  productTotalCount: number;
  documents: SearchDocument[];
};

const DOCUMENT_LIMIT = 8;
const EXCERPT_LENGTH = 120;

/** HTML 본문에서 태그를 걷어내 미리보기를 만든다 — 저장된 본문은 살균을 마친 HTML이다 */
function toExcerpt(bodyText: string | null): string {
  if (!bodyText) return "";
  const plain = bodyText
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH)}…` : plain;
}

export async function searchStore(
  database: DatabaseClient,
  input: { keyword: string; page?: number },
): Promise<StoreSearchResult> {
  const keyword = input.keyword.trim();

  // 한 글자로 검색하면 사실상 전체 목록이 나온다 — 결과가 아니라 소음이다
  if (keyword.length < SEARCH_KEYWORD_MIN_LENGTH) {
    return {
      keyword,
      keywordTooShort: keyword.length > 0,
      products: [],
      productTotalCount: 0,
      documents: [],
    };
  }

  const likePattern = `%${keyword}%`;

  // 상품은 기존 목록 서비스를 그대로 쓴다 — 품절·가격·썸네일 조립 규칙이 목록과 갈리면
  // 같은 상품이 검색과 목록에서 다르게 보인다
  const productPage = await getProductListPage(database, { keyword, page: input.page });

  const storyRows = await database
    .select({
      title: article.title,
      slug: article.slug,
      bodyText: article.content,
      summary: article.summary,
    })
    .from(article)
    .where(
      and(
        eq(article.categoryCode, "story"),
        // 발행 상태는 published_at 하나로 정한다(비었으면 작성 중, 미래면 예약)
        isNotNull(article.publishedAt),
        lte(article.publishedAt, sql`now()`),
        or(ilike(article.title, likePattern), ilike(article.content, likePattern)),
      ),
    )
    .orderBy(desc(article.publishedAt))
    .limit(DOCUMENT_LIMIT);

  const helpRows = await database
    .select({
      postId: post.id,
      title: post.title,
      bodyText: post.content,
      boardName: board.name,
      boardSlug: board.slug,
    })
    .from(post)
    .innerJoin(board, eq(post.boardId, board.id))
    .where(
      and(
        // 공개 게시판만 — 1:1 문의는 본인만 볼 수 있어야 한다
        inArray(board.slug, ["notice", "faq"]),
        or(ilike(post.title, likePattern), ilike(post.content, likePattern)),
      ),
    )
    .orderBy(desc(post.createdAt))
    .limit(DOCUMENT_LIMIT);

  const documents: SearchDocument[] = [
    ...storyRows.map((row) => ({
      documentKind: "story" as const,
      title: row.title,
      excerpt: toExcerpt(row.summary ?? row.bodyText),
      href: `/story/${row.slug}`,
      groupLabel: null,
    })),
    ...helpRows.map((row) => ({
      documentKind: "help" as const,
      title: row.title,
      excerpt: toExcerpt(row.bodyText),
      href: row.boardSlug === "faq" ? `/support/faq#post-${row.postId}` : `/notice/${row.postId}`,
      groupLabel: row.boardName,
    })),
  ];

  return {
    keyword,
    keywordTooShort: false,
    products: productPage.cards,
    productTotalCount: productPage.totalCount,
    documents,
  };
}

/** 상품 검색만 쓰는 화면(상품 목록)이 참조할 수 있도록 이름을 노출한다 */
export type { ProductCard };
