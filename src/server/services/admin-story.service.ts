import "server-only";

import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";

import { article, commonCode, product } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { sanitizeRichText, richTextToPlainText } from "./html-sanitize.service";
import { serializeActor, type TransitionActor } from "./order-status.service";
import { claimFiles, releaseOwnerFiles } from "./uploaded-file.service";

/**
 * 관리자 이야기 관리 — 목록·조회·저장·발행.
 *
 * 발행 상태를 별도 컬럼으로 두지 않는다. `published_at` 하나가 전부다:
 *   null = 작성 중 · 과거 시각 = 공개 · 미래 시각 = 예약 발행.
 * 상태 컬럼을 더하면 "발행 상태인데 발행일이 미래" 같은 모순 조합이 생기고,
 * 그때부터 "발행했는데 왜 안 보이지"를 사람이 조사해야 한다.
 */

const ADMIN_STORY_PAGE_SIZE = 15;

export type AdminStoryTab = "all" | "published" | "draft" | "scheduled";

export type AdminStoryCard = {
  articleId: number;
  slug: string;
  title: string;
  categoryName: string | null;
  coverImagePath: string | null;
  isFeatured: boolean;
  publishedAt: Date | null;
  /** 지금 스토어에 보이는가 — 발행일이 있고 이미 지났는가 */
  isLiveNow: boolean;
  createdAt: Date;
};

export type AdminStoryListResult = {
  cards: AdminStoryCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  tabCounts: Record<AdminStoryTab, number>;
};

export class AdminStoryNotFoundError extends Error {
  constructor(readonly articleId: number) {
    super(`이야기를 찾을 수 없습니다: id=${articleId}`);
    this.name = "AdminStoryNotFoundError";
  }
}

export class DuplicateStorySlugError extends Error {
  constructor(readonly slug: string) {
    super(`이미 쓰고 있는 URL 주소입니다: ${slug}. 다른 주소를 입력해 주세요.`);
    this.name = "DuplicateStorySlugError";
  }
}

export async function listAdminStories(
  database: DatabaseClient,
  input: { tab?: AdminStoryTab; keyword?: string; page?: number } = {},
): Promise<AdminStoryListResult> {
  const tab = input.tab ?? "all";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  const liveCondition = sql`${article.publishedAt} is not null and ${article.publishedAt} <= now()`;
  const scheduledCondition = sql`${article.publishedAt} > now()`;

  const tabFilter =
    tab === "published"
      ? liveCondition
      : tab === "draft"
        ? isNull(article.publishedAt)
        : tab === "scheduled"
          ? and(isNotNull(article.publishedAt), scheduledCondition)
          : undefined;

  const keywordFilter = keyword
    ? or(ilike(article.title, `%${keyword}%`), ilike(article.slug, `%${keyword}%`))
    : undefined;

  const listFilter = and(tabFilter, keywordFilter);

  const [totalRow] = await database.select({ total: count() }).from(article).where(listFilter);

  const rows = await database
    .select({
      articleId: article.id,
      slug: article.slug,
      title: article.title,
      categoryCode: article.categoryCode,
      coverImagePath: article.coverImagePath,
      isFeatured: article.isFeatured,
      publishedAt: article.publishedAt,
      createdAt: article.createdAt,
      categoryName: commonCode.name,
    })
    .from(article)
    .leftJoin(
      commonCode,
      and(eq(commonCode.groupCode, "article_category"), eq(commonCode.code, article.categoryCode)),
    )
    .where(listFilter)
    // 작성 중인 글이 위로 — 마무리하지 않은 글이 아래 묻히면 다시 못 찾는다.
    // 그다음은 최신순
    .orderBy(asc(sql`${article.publishedAt} is not null`), desc(article.id))
    .limit(ADMIN_STORY_PAGE_SIZE)
    .offset((page - 1) * ADMIN_STORY_PAGE_SIZE);

  const [tabCountRow] = await database
    .select({
      all: count(),
      published: sql<number>`count(*) filter (where ${liveCondition})::int`,
      draft: sql<number>`count(*) filter (where ${article.publishedAt} is null)::int`,
      scheduled: sql<number>`count(*) filter (where ${scheduledCondition})::int`,
    })
    .from(article);

  const now = Date.now();
  return {
    cards: rows.map((row) => ({
      articleId: row.articleId,
      slug: row.slug,
      title: row.title,
      categoryName: row.categoryName,
      coverImagePath: row.coverImagePath,
      isFeatured: row.isFeatured,
      publishedAt: row.publishedAt,
      isLiveNow: row.publishedAt !== null && row.publishedAt.getTime() <= now,
      createdAt: row.createdAt,
    })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_STORY_PAGE_SIZE,
    tabCounts: {
      all: tabCountRow?.all ?? 0,
      published: Number(tabCountRow?.published ?? 0),
      draft: Number(tabCountRow?.draft ?? 0),
      scheduled: Number(tabCountRow?.scheduled ?? 0),
    },
  };
}

export type AdminStoryFormData = {
  articleId: number | null;
  slug: string;
  title: string;
  summary: string;
  content: string;
  categoryCode: string | null;
  productId: number | null;
  authorName: string;
  coverImagePath: string | null;
  isFeatured: boolean;
  /** 날짜+시각 문자열(YYYY-MM-DDTHH:mm) — 비우면 작성 중 */
  publishedAt: string;
};

export type AdminStoryFormView = {
  form: AdminStoryFormData;
  categoryOptions: { code: string; name: string }[];
  productOptions: { productId: number; name: string }[];
};

const EMPTY_STORY_FORM: AdminStoryFormData = {
  articleId: null,
  slug: "",
  title: "",
  summary: "",
  content: "",
  categoryCode: null,
  productId: null,
  authorName: "",
  coverImagePath: null,
  isFeatured: false,
  publishedAt: "",
};

/** datetime-local 입력 형식 — 브라우저 시간대 기준으로 그대로 보여준다 */
function toDateTimeInput(value: Date | null): string {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}`
  );
}

async function loadStoryChoices(database: DatabaseClient) {
  const categoryRows = await database
    .select({ code: commonCode.code, name: commonCode.name })
    .from(commonCode)
    .where(and(eq(commonCode.groupCode, "article_category"), eq(commonCode.isActive, true)))
    .orderBy(asc(commonCode.sortOrder));

  // 이야기에 걸 수 있는 상품은 실제로 팔고 있는 것만 — 숨김 상품을 걸면 고객이 막다른 길을 만난다
  const productRows = await database
    .select({ productId: product.id, name: product.name })
    .from(product)
    .where(and(eq(product.status, "active"), isNull(product.deletedAt)))
    .orderBy(asc(product.name));

  return { categoryOptions: categoryRows, productOptions: productRows };
}

export async function getAdminStoryForm(
  database: DatabaseClient,
  articleId: number | null,
): Promise<AdminStoryFormView> {
  const choices = await loadStoryChoices(database);
  if (articleId === null) return { form: EMPTY_STORY_FORM, ...choices };

  const [row] = await database
    .select()
    .from(article)
    .where(eq(article.id, articleId))
    .limit(1);
  if (!row) throw new AdminStoryNotFoundError(articleId);

  return {
    form: {
      articleId: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary ?? "",
      content: row.content,
      categoryCode: row.categoryCode,
      productId: row.productId,
      authorName: row.authorName ?? "",
      coverImagePath: row.coverImagePath,
      isFeatured: row.isFeatured,
      publishedAt: toDateTimeInput(row.publishedAt),
    },
    ...choices,
  };
}

export type SaveAdminStoryInput = {
  articleId: number | null;
  slug: string;
  title: string;
  summary: string | null;
  content: string;
  categoryCode: string | null;
  productId: number | null;
  authorName: string | null;
  coverImagePath: string | null;
  isFeatured: boolean;
  publishedAt: Date | null;
  actor: TransitionActor;
};

/**
 * 저장. 본문은 여기서 씻는다 — 렌더 시점에 씻으면 이 값을 쓰는 화면이 늘 때마다
 * 잊을 수 있고, 잊은 화면 하나가 곧 저장형 XSS 구멍이다(상품 설명과 같은 규약).
 */
export async function saveAdminStory(
  database: DatabaseClient,
  input: SaveAdminStoryInput,
): Promise<{ articleId: number }> {
  const actorText = serializeActor(input.actor);
  const cleanContent = sanitizeRichText(input.content);

  return database.transaction(async (tx) => {
    // 대표는 하나뿐 — 새 대표를 세우면 기존 대표를 내린다.
    // 여럿이면 목록의 '이달의 이야기' 자리에 무엇이 오는지 예측할 수 없다
    if (input.isFeatured) {
      await tx.update(article).set({ isFeatured: false }).where(eq(article.isFeatured, true));
    }

    const values = {
      slug: input.slug,
      title: input.title,
      summary: input.summary,
      content: cleanContent,
      categoryCode: input.categoryCode,
      productId: input.productId,
      authorName: input.authorName,
      coverImagePath: input.coverImagePath,
      isFeatured: input.isFeatured,
      publishedAt: input.publishedAt,
    };

    let articleId: number;
    if (input.articleId === null) {
      const inserted = await tx
        .insert(article)
        .values({ ...values, createdBy: actorText })
        .onConflictDoNothing({ target: article.slug })
        .returning({ id: article.id });
      if (inserted.length === 0) throw new DuplicateStorySlugError(input.slug);
      articleId = inserted[0].id;
    } else {
      // 다른 글이 쓰는 주소로 바꾸려 하면 유니크 위반 전에 읽을 수 있는 문구로 거른다
      const [slugOwner] = await tx
        .select({ id: article.id })
        .from(article)
        .where(eq(article.slug, input.slug))
        .limit(1);
      if (slugOwner && slugOwner.id !== input.articleId) {
        throw new DuplicateStorySlugError(input.slug);
      }

      const updated = await tx
        .update(article)
        .set({ ...values, updatedBy: actorText, updatedAt: sql`now()` })
        .where(eq(article.id, input.articleId))
        .returning({ id: article.id });
      if (updated.length === 0) throw new AdminStoryNotFoundError(input.articleId);
      articleId = updated[0].id;
    }

    // 커버 + 본문에 박힌 이미지가 이 글이 쓰는 파일이다. 본문에서 뺀 이미지는 여기서
    // 삭제 예약되고 배치가 유예 뒤 지운다 — 안 하면 디스크에만 남아 고아가 된다
    await claimFiles(tx, {
      ownerType: "article",
      ownerId: articleId,
      keepPaths: collectStoryImagePaths(input.coverImagePath, cleanContent),
    });

    return { articleId };
  });
}

/**
 * 이 글이 쓰는 저장 경로 — 커버 + 본문 `<img src="/api/uploads/…">`.
 * 서빙 URL에서 저장 경로만 떼어낸다(원장은 저장 경로로 파일을 소유한다).
 */
function collectStoryImagePaths(
  coverImagePath: string | null,
  contentHtml: string,
): string[] {
  const paths = coverImagePath ? [coverImagePath] : [];
  for (const match of contentHtml.matchAll(/src="\/api\/uploads\/([^"]+)"/g)) {
    paths.push(match[1]);
  }
  return [...new Set(paths)];
}

export async function deleteAdminStory(
  database: DatabaseClient,
  input: { articleId: number },
): Promise<{ articleId: number }> {
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(article)
      .where(eq(article.id, input.articleId))
      .returning({ id: article.id });
    if (deleted.length === 0) throw new AdminStoryNotFoundError(input.articleId);
    // 글이 사라지면 이미지도 쓸 곳이 없다 — 유예 뒤 배치가 지운다
    await releaseOwnerFiles(tx, { ownerType: "article", ownerId: deleted[0].id });
    return { articleId: deleted[0].id };
  });
}

/** 본문 미리보기(목록·검색용) — HTML을 잘라 쓰면 태그가 중간에서 끊겨 화면이 깨진다 */
export function storyPreviewText(contentHtml: string, maxLength = 80): string {
  const plain = richTextToPlainText(contentHtml);
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}
