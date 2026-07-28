import "server-only";

import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";

import { customer, product, review, reviewReport } from "@/db/schema";

import type { DatabaseClient, TransactionClient } from "./db-client";

/**
 * 관리자 리뷰 관리 — 목록·답글·숨김·신고 처리.
 *
 * 이 모듈의 핵심 불변식: **상품의 별점 캐시는 보이는 리뷰만 센다.**
 * product.review_count / rating_sum은 스토어 카드·상세가 읽는 캐시인데, 숨긴 리뷰가
 * 계속 평균에 들어가면 "별점 1점짜리 스팸을 숨겼는데 평점이 그대로"가 된다.
 * 증감(+/-)이 아니라 **매번 다시 세서** 반영한다 — 델타는 어긋나면 영영 어긋난 채로 남는다.
 */

export type AdminReviewTab = "all" | "reported" | "hidden" | "unanswered";

export type AdminReviewCard = {
  reviewId: number;
  productId: number;
  productName: string;
  authorName: string;
  rating: number;
  content: string;
  imageCount: number;
  isHidden: boolean;
  reportCount: number;
  /** 미처리 신고 사유 — 배너 문구가 된다 */
  pendingReportReasons: string[];
  adminReply: string | null;
  adminReplyAt: Date | null;
  createdAt: Date;
};

export type AdminReviewListResult = {
  cards: AdminReviewCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  tabCounts: Record<AdminReviewTab, number>;
  /** 별점 분포 — 필터 칩의 건수 */
  ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
};

const ADMIN_REVIEW_PAGE_SIZE = 20;

export async function listAdminReviews(
  database: DatabaseClient,
  input: {
    tab?: AdminReviewTab;
    /** 0이면 전체 */
    rating?: number;
    keyword?: string;
    page?: number;
  } = {},
): Promise<AdminReviewListResult> {
  const tab = input.tab ?? "all";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  const tabFilter =
    tab === "reported"
      ? sql`${review.reportCount} > 0`
      : tab === "hidden"
        ? eq(review.isHidden, true)
        : tab === "unanswered"
          ? isNull(review.adminReply)
          : undefined;

  const ratingFilter = input.rating ? eq(review.rating, input.rating) : undefined;
  const keywordFilter = keyword
    ? or(ilike(review.content, `%${keyword}%`), ilike(product.name, `%${keyword}%`))
    : undefined;

  const listFilter = and(tabFilter, ratingFilter, keywordFilter);

  const [totalRow] = await database
    .select({ total: count() })
    .from(review)
    .innerJoin(product, eq(review.productId, product.id))
    .where(listFilter);

  const reviewRows = await database
    .select({
      reviewId: review.id,
      productId: review.productId,
      productName: product.name,
      authorName: customer.name,
      rating: review.rating,
      content: review.content,
      images: review.images,
      isHidden: review.isHidden,
      reportCount: review.reportCount,
      adminReply: review.adminReply,
      adminReplyAt: review.adminReplyAt,
      createdAt: review.createdAt,
    })
    .from(review)
    .innerJoin(product, eq(review.productId, product.id))
    .leftJoin(customer, eq(review.customerId, customer.id))
    .where(listFilter)
    .orderBy(desc(review.id))
    .limit(ADMIN_REVIEW_PAGE_SIZE)
    .offset((page - 1) * ADMIN_REVIEW_PAGE_SIZE);

  // 미처리 신고 사유 — 배너에 "왜 신고됐는지"를 보여줘야 판단할 수 있다
  const reviewIds = reviewRows.map((row) => row.reviewId);
  const reportRows =
    reviewIds.length === 0
      ? []
      : await database
          .select({ reviewId: reviewReport.reviewId, reason: reviewReport.reason })
          .from(reviewReport)
          .where(
            and(inArray(reviewReport.reviewId, reviewIds), isNull(reviewReport.handledAt)),
          );

  const [tabCountRow] = await database
    .select({
      all: count(),
      reported: sql<number>`count(*) filter (where ${review.reportCount} > 0)::int`,
      hidden: sql<number>`count(*) filter (where ${review.isHidden})::int`,
      unanswered: sql<number>`count(*) filter (where ${review.adminReply} is null)::int`,
      rating1: sql<number>`count(*) filter (where ${review.rating} = 1)::int`,
      rating2: sql<number>`count(*) filter (where ${review.rating} = 2)::int`,
      rating3: sql<number>`count(*) filter (where ${review.rating} = 3)::int`,
      rating4: sql<number>`count(*) filter (where ${review.rating} = 4)::int`,
      rating5: sql<number>`count(*) filter (where ${review.rating} = 5)::int`,
    })
    .from(review);

  return {
    cards: reviewRows.map((row) => ({
      reviewId: row.reviewId,
      productId: row.productId,
      productName: row.productName,
      // 탈퇴 회원의 리뷰는 작성자가 없다 — 리뷰 자체는 남는다
      authorName: row.authorName ?? "탈퇴회원",
      rating: row.rating,
      content: row.content,
      imageCount: Array.isArray(row.images) ? row.images.length : 0,
      isHidden: row.isHidden,
      reportCount: row.reportCount,
      pendingReportReasons: reportRows
        .filter((report) => report.reviewId === row.reviewId)
        .map((report) => report.reason),
      adminReply: row.adminReply,
      adminReplyAt: row.adminReplyAt,
      createdAt: row.createdAt,
    })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_REVIEW_PAGE_SIZE,
    tabCounts: {
      all: tabCountRow?.all ?? 0,
      reported: Number(tabCountRow?.reported ?? 0),
      hidden: Number(tabCountRow?.hidden ?? 0),
      unanswered: Number(tabCountRow?.unanswered ?? 0),
    },
    ratingCounts: {
      1: Number(tabCountRow?.rating1 ?? 0),
      2: Number(tabCountRow?.rating2 ?? 0),
      3: Number(tabCountRow?.rating3 ?? 0),
      4: Number(tabCountRow?.rating4 ?? 0),
      5: Number(tabCountRow?.rating5 ?? 0),
    },
  };
}

export class AdminReviewNotFoundError extends Error {
  constructor(readonly reviewId: number) {
    super(`리뷰를 찾을 수 없습니다: id=${reviewId}`);
    this.name = "AdminReviewNotFoundError";
  }
}

/**
 * 상품의 별점 캐시를 **다시 세서** 맞춘다(보이는 리뷰만).
 *
 * 증감으로 관리하면 한 번 어긋난 값이 영영 어긋난 채로 남는다. 리뷰 수가 상품당
 * 수백 건 규모라 매번 세도 비싸지 않고, 무엇보다 이 함수를 부르면 반드시 맞는다.
 */
async function recomputeProductRating(tx: TransactionClient, productId: number): Promise<void> {
  await tx
    .update(product)
    .set({
      reviewCount: sql`(select count(*) from ${review} r where r.product_id = ${productId} and not r.is_hidden)`,
      ratingSum: sql`(select coalesce(sum(r.rating), 0) from ${review} r where r.product_id = ${productId} and not r.is_hidden)`,
    })
    .where(eq(product.id, productId));
}

/** 관리자 답글 — 리뷰 아래에 그대로 노출된다 */
export async function replyToAdminReview(
  database: DatabaseClient,
  input: { reviewId: number; reply: string },
): Promise<{ reviewId: number }> {
  const reply = input.reply.trim();
  const updated = await database
    .update(review)
    .set({
      adminReply: reply.length > 0 ? reply : null,
      // 답글을 지우면 시각도 지운다 — 답글 없이 시각만 남으면 '답변함'으로 집계된다
      adminReplyAt: reply.length > 0 ? sql`now()` : null,
    })
    .where(eq(review.id, input.reviewId))
    .returning({ id: review.id });
  if (updated.length === 0) throw new AdminReviewNotFoundError(input.reviewId);
  return { reviewId: updated[0].id };
}

/** 숨김·노출 — 별점 캐시를 함께 맞춘다 */
export async function setAdminReviewHidden(
  database: DatabaseClient,
  input: { reviewId: number; isHidden: boolean },
): Promise<{ reviewId: number; isHidden: boolean; productId: number }> {
  return database.transaction(async (tx) => {
    const updated = await tx
      .update(review)
      .set({ isHidden: input.isHidden })
      .where(eq(review.id, input.reviewId))
      .returning({ id: review.id, productId: review.productId, isHidden: review.isHidden });
    if (updated.length === 0) throw new AdminReviewNotFoundError(input.reviewId);

    await recomputeProductRating(tx, updated[0].productId);

    return {
      reviewId: updated[0].id,
      isHidden: updated[0].isHidden,
      productId: updated[0].productId,
    };
  });
}

/**
 * 신고 반려 — 신고를 처리 완료로 표시하고 배지를 지운다. 리뷰 자체는 그대로 둔다.
 * (신고가 타당하면 반려가 아니라 숨김 처리를 한다.)
 */
export async function dismissAdminReviewReports(
  database: DatabaseClient,
  input: { reviewId: number },
): Promise<{ reviewId: number; dismissedCount: number }> {
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: review.id })
      .from(review)
      .where(eq(review.id, input.reviewId))
      .limit(1);
    if (!existing) throw new AdminReviewNotFoundError(input.reviewId);

    const dismissed = await tx
      .update(reviewReport)
      .set({ handledAt: sql`now()` })
      .where(and(eq(reviewReport.reviewId, input.reviewId), isNull(reviewReport.handledAt)))
      .returning({ id: reviewReport.id });

    await tx.update(review).set({ reportCount: 0 }).where(eq(review.id, input.reviewId));

    return { reviewId: input.reviewId, dismissedCount: dismissed.length };
  });
}
