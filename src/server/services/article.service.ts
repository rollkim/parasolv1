import "server-only";

import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";

import type { db as Database } from "@/db";
import { article, commonCode, product, productImage } from "@/db/schema";
import { calcReadMinutes, parseArticleBlocks, type ArticleBlock } from "@/domain/article";

/**
 * 이야기(브랜드 스토리) 조회 서비스 — 핸드오프 'PaRaSOL 이야기.dc.html'.
 *
 * 공개 기준은 `published_at IS NOT NULL AND published_at <= now()` 한 가지다.
 * 예약 발행을 따로 만들지 않고 미래 시각으로 두면 자동으로 감춰지게 했다 — 상태 컬럼이
 * 하나 늘면 "발행됐는데 안 보임"류 불일치가 생긴다.
 *
 * [범위 결정 2026-07-29] article은 **이야기 전용**이다. 뉴스·보도자료까지 담는 범용 통으로
 * 만들지 않는다 — 범용 컨테이너는 board/post가 이미 하고 있어서, 둘이 되면 새 콘텐츠마다
 * "게시판인가 아티클인가"를 매번 판단해야 한다. 경계는 '읽히려고 쓴 편집 콘텐츠'(article)
 * 대 '기록하고 주고받는 글'(post).
 * 나중에 이야기와 섞이면 안 되는 글 묶음이 생기면 그때 `channel_code`(기본값 'story') 한 컬럼과
 * 라우트 하나를 더한다 — 안전한 기본값이 있어 운영 중에도 싼 변경이다.
 */

type DatabaseClient = typeof Database;

const ARTICLE_CATEGORY_GROUP = "article_category";

/** 공개 조건 — 목록·상세·연관글이 전부 이걸 쓴다(한 군데서만 정의) */
const publishedCondition = and(
  isNotNull(article.publishedAt),
  sql`${article.publishedAt} <= now()`,
);

export type StoryCategoryChip = { categoryCode: string; categoryName: string };

export type StoryCard = {
  slug: string;
  title: string;
  summary: string | null;
  categoryName: string | null;
  coverImagePath: string | null;
  publishedAt: Date;
  readMinutes: number;
};

export type StoryListPage = {
  /** 이달의 이야기 — 없으면 null(가장 최근 글을 승격시키지 않는다) */
  featured: StoryCard | null;
  /** featured를 뺀 나머지 */
  cards: StoryCard[];
  /** 글이 실제로 있는 카테고리만. 좁힐 게 없으면 빈 배열이고 화면은 줄을 숨긴다 */
  categoryChips: StoryCategoryChip[];
  activeCategoryCode: string | null;
};

export type StoryDetail = {
  slug: string;
  title: string;
  categoryName: string | null;
  authorName: string | null;
  publishedAt: Date;
  readMinutes: number;
  coverImagePath: string | null;
  blocks: ArticleBlock[];
  /** 이 이야기의 제품 — 판매 중지·삭제된 상품은 내려주지 않는다 */
  relatedProduct: {
    slug: string;
    name: string;
    thumbnailPath: string | null;
    thumbnailAlt: string | null;
  } | null;
  otherStories: { slug: string; title: string; categoryName: string | null }[];
};

/** 카테고리 코드 → 한글 표시명. 목록·상세가 같이 쓴다 */
async function loadCategoryNames(
  database: DatabaseClient,
): Promise<Map<string, string>> {
  const codeRows = await database
    .select({ code: commonCode.code, name: commonCode.name })
    .from(commonCode)
    .where(
      and(
        eq(commonCode.groupCode, ARTICLE_CATEGORY_GROUP),
        eq(commonCode.isActive, true),
      ),
    )
    .orderBy(asc(commonCode.sortOrder));
  return new Map(codeRows.map((codeRow) => [codeRow.code, codeRow.name]));
}

/**
 * 이야기 목록.
 *
 * 카테고리를 고르면 대표 이야기는 내리지 않는다 — 필터는 "이 분류의 글"을 뜻하는데
 * 대표 자리에 다른 분류 글이 남아 있으면 필터가 안 먹은 것처럼 보인다.
 */
export async function getStoryListPage(
  database: DatabaseClient,
  input: { categoryCode: string | null } = { categoryCode: null },
): Promise<StoryListPage> {
  const categoryNameByCode = await loadCategoryNames(database);

  const articleRows = await database
    .select({
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      categoryCode: article.categoryCode,
      coverImagePath: article.coverImagePath,
      content: article.content,
      isFeatured: article.isFeatured,
      publishedAt: article.publishedAt,
    })
    .from(article)
    .where(publishedCondition)
    .orderBy(desc(article.publishedAt));

  const toCard = (row: (typeof articleRows)[number]): StoryCard => ({
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    categoryName: row.categoryCode
      ? (categoryNameByCode.get(row.categoryCode) ?? null)
      : null,
    coverImagePath: row.coverImagePath,
    // publishedAt은 공개 조건이 이미 not-null을 보장한다
    publishedAt: row.publishedAt as Date,
    readMinutes: calcReadMinutes(row.content),
  });

  // 칩은 '글이 있는 분류'만 — 눌러도 빈 목록이 나오는 칩을 두지 않는다
  const categoryCodesWithArticles = new Set(
    articleRows
      .map((row) => row.categoryCode)
      .filter((code): code is string => code !== null),
  );
  const categoryChips: StoryCategoryChip[] = [...categoryNameByCode.entries()]
    .filter(([code]) => categoryCodesWithArticles.has(code))
    .map(([categoryCode, categoryName]) => ({ categoryCode, categoryName }));

  // 요청한 분류에 글이 없으면 필터를 무시하고 전체를 보여준다 — 빈 화면보다 낫다
  const effectiveCategoryCode =
    input.categoryCode !== null && categoryCodesWithArticles.has(input.categoryCode)
      ? input.categoryCode
      : null;

  const visibleRows =
    effectiveCategoryCode === null
      ? articleRows
      : articleRows.filter((row) => row.categoryCode === effectiveCategoryCode);

  const featuredRow = visibleRows.find((row) => row.isFeatured) ?? null;

  return {
    featured: featuredRow ? toCard(featuredRow) : null,
    cards: visibleRows
      .filter((row) => row.slug !== featuredRow?.slug)
      .map(toCard),
    // 칩이 1개뿐이면 좁힐 수단이 아니라 그냥 라벨이다 — 화면에서 줄을 숨기도록 비워 보낸다
    categoryChips: categoryChips.length > 1 ? categoryChips : [],
    activeCategoryCode: effectiveCategoryCode,
  };
}

/** 이야기 상세 — 없거나 미공개면 null(화면은 notFound) */
export async function getStoryDetail(
  database: DatabaseClient,
  slug: string,
): Promise<StoryDetail | null> {
  const [articleRow] = await database
    .select({
      articleId: article.id,
      slug: article.slug,
      title: article.title,
      content: article.content,
      categoryCode: article.categoryCode,
      authorName: article.authorName,
      coverImagePath: article.coverImagePath,
      publishedAt: article.publishedAt,
      productId: article.productId,
    })
    .from(article)
    .where(and(eq(article.slug, slug), publishedCondition))
    .limit(1);

  if (!articleRow) return null;

  const categoryNameByCode = await loadCategoryNames(database);

  const [relatedProductRow] = articleRow.productId
    ? await database
        .select({
          slug: product.slug,
          name: product.name,
          thumbnailPath: productImage.path,
          thumbnailAlt: productImage.alt,
        })
        .from(product)
        .leftJoin(
          productImage,
          and(
            eq(productImage.productId, product.id),
            eq(productImage.kind, "thumbnail"),
            eq(productImage.isPrimary, true),
          ),
        )
        // 숨김·작성중 상품으로 보내면 고객이 막다른 길을 만난다(상품 목록과 같은 공개 기준)
        .where(and(eq(product.id, articleRow.productId), eq(product.status, "active")))
        .limit(1)
    : [];

  const otherStoryRows = await database
    .select({
      slug: article.slug,
      title: article.title,
      categoryCode: article.categoryCode,
    })
    .from(article)
    .where(and(publishedCondition, ne(article.slug, slug)))
    .orderBy(desc(article.publishedAt))
    .limit(3);

  return {
    slug: articleRow.slug,
    title: articleRow.title,
    categoryName: articleRow.categoryCode
      ? (categoryNameByCode.get(articleRow.categoryCode) ?? null)
      : null,
    authorName: articleRow.authorName,
    publishedAt: articleRow.publishedAt as Date,
    readMinutes: calcReadMinutes(articleRow.content),
    coverImagePath: articleRow.coverImagePath,
    blocks: parseArticleBlocks(articleRow.content),
    relatedProduct: relatedProductRow
      ? {
          slug: relatedProductRow.slug,
          name: relatedProductRow.name,
          thumbnailPath: relatedProductRow.thumbnailPath,
          thumbnailAlt: relatedProductRow.thumbnailAlt,
        }
      : null,
    otherStories: otherStoryRows.map((row) => ({
      slug: row.slug,
      title: row.title,
      categoryName: row.categoryCode
        ? (categoryNameByCode.get(row.categoryCode) ?? null)
        : null,
    })),
  };
}

/** 사이트맵·정적 생성용 — 공개된 이야기 slug 전부 */
export async function listPublishedStorySlugs(
  database: DatabaseClient,
): Promise<string[]> {
  const rows = await database
    .select({ slug: article.slug })
    .from(article)
    .where(publishedCondition);
  return rows.map((row) => row.slug);
}
