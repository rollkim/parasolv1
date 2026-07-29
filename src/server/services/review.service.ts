import "server-only";

import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { customer, orderItem, orders, product, review } from "@/db/schema";
import { maskOrdererName } from "@/domain/order";

import { getActiveCommonCodesWithMeta } from "./common-code.service";
import type { DatabaseClient, QueryClient, TransactionClient } from "./db-client";
import { earnReviewPoints } from "./point-earn.service";

/**
 * 리뷰 도메인 서비스 — 스토어프론트 조회·작성.
 *
 * 두 가지가 이 모듈의 전부다:
 *   ① **산 사람만 쓴다** — order_item 소유 + 배송완료 이후. 검증 없이 열면 광고가 들어온다.
 *   ② **별점 캐시는 보이는 리뷰만 센다** — 관리자 숨김과 같은 규칙이라 계산을 한 함수로 둔다
 *      (admin-review.service가 이 함수를 가져다 쓴다. 두 벌이면 반드시 어긋난다).
 */

/** 작성 가능한 주문 상태 — 받아본 사람만 쓴다 */
const REVIEWABLE_ORDER_STATUSES = ["delivered", "confirmed"] as const;

export class ReviewNotPurchasedError extends Error {
  constructor() {
    super("구매하신 상품에만 리뷰를 남길 수 있어요.");
    this.name = "ReviewNotPurchasedError";
  }
}

export class ReviewNotDeliveredError extends Error {
  constructor() {
    super("상품을 받으신 뒤에 리뷰를 남길 수 있어요.");
    this.name = "ReviewNotDeliveredError";
  }
}

export class ReviewAlreadyWrittenError extends Error {
  constructor() {
    super("이미 리뷰를 작성한 주문 상품이에요.");
    this.name = "ReviewAlreadyWrittenError";
  }
}

/**
 * 상품의 별점 캐시를 다시 세서 맞춘다(보이는 리뷰만).
 * 증감이 아니라 재계산이다 — 델타는 한 번 어긋나면 영영 어긋난 채로 남는다.
 */
export async function recomputeProductRating(
  tx: TransactionClient,
  productId: number,
): Promise<void> {
  await tx
    .update(product)
    .set({
      reviewCount: sql`(select count(*) from ${review} r where r.product_id = ${productId} and not r.is_hidden)`,
      ratingSum: sql`(select coalesce(sum(r.rating), 0) from ${review} r where r.product_id = ${productId} and not r.is_hidden)`,
    })
    .where(eq(product.id, productId));
}

export type ProductReviewCard = {
  reviewId: number;
  rating: number;
  content: string;
  /** 표시명 — 개인정보라 마스킹한다(홍**) */
  authorName: string;
  optionLabel: string | null;
  tagLabels: string[];
  images: string[];
  adminReply: string | null;
  adminReplyAt: Date | null;
  createdAt: Date;
};

export type ProductReviewList = {
  cards: ProductReviewCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** 별점 분포 — 요약 막대에 쓴다 */
  ratingBuckets: Record<1 | 2 | 3 | 4 | 5, number>;
  photoReviewCount: number;
};

const REVIEW_PAGE_SIZE = 10;

/** 태그 코드 → 표시명. 코드가 그대로 보이면 안 된다 */
async function loadReviewTagLabels(client: QueryClient): Promise<Map<string, string>> {
  const rows = await getActiveCommonCodesWithMeta(client, "review_tag");
  return new Map(rows.map((row) => [row.code, row.name]));
}

export async function getProductReviews(
  database: DatabaseClient,
  input: { productId: number; page?: number; photoOnly?: boolean },
): Promise<ProductReviewList> {
  const page = Math.max(1, input.page ?? 1);

  // 숨긴 리뷰는 스토어에 없다 — 관리자 화면과 같은 기준
  const listFilter = and(
    eq(review.productId, input.productId),
    eq(review.isHidden, false),
    input.photoOnly ? sql`jsonb_array_length(coalesce(${review.images}, '[]'::jsonb)) > 0` : undefined,
  );

  const [totalRow] = await database.select({ total: count() }).from(review).where(listFilter);

  const rows = await database
    .select({
      reviewId: review.id,
      rating: review.rating,
      content: review.content,
      tags: review.tags,
      images: review.images,
      adminReply: review.adminReply,
      adminReplyAt: review.adminReplyAt,
      createdAt: review.createdAt,
      authorName: customer.name,
      optionLabel: orderItem.variantName,
    })
    .from(review)
    .leftJoin(customer, eq(review.customerId, customer.id))
    .leftJoin(orderItem, eq(review.orderItemId, orderItem.id))
    .where(listFilter)
    .orderBy(desc(review.id))
    .limit(REVIEW_PAGE_SIZE)
    .offset((page - 1) * REVIEW_PAGE_SIZE);

  const [statsRow] = await database
    .select({
      rating1: sql<number>`count(*) filter (where ${review.rating} = 1)::int`,
      rating2: sql<number>`count(*) filter (where ${review.rating} = 2)::int`,
      rating3: sql<number>`count(*) filter (where ${review.rating} = 3)::int`,
      rating4: sql<number>`count(*) filter (where ${review.rating} = 4)::int`,
      rating5: sql<number>`count(*) filter (where ${review.rating} = 5)::int`,
      photoCount: sql<number>`count(*) filter (where jsonb_array_length(coalesce(${review.images}, '[]'::jsonb)) > 0)::int`,
    })
    .from(review)
    .where(and(eq(review.productId, input.productId), eq(review.isHidden, false)));

  const tagLabels = await loadReviewTagLabels(database);

  return {
    cards: rows.map((row) => ({
      reviewId: row.reviewId,
      rating: row.rating,
      content: row.content,
      // 탈퇴 회원 리뷰도 남는다 — 이름만 없다
      authorName: row.authorName ? maskOrdererName(row.authorName) : "탈퇴회원",
      optionLabel: row.optionLabel,
      tagLabels: Array.isArray(row.tags)
        ? (row.tags as string[]).map((code) => tagLabels.get(code) ?? code)
        : [],
      images: Array.isArray(row.images) ? (row.images as string[]) : [],
      adminReply: row.adminReply,
      adminReplyAt: row.adminReplyAt,
      createdAt: row.createdAt,
    })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: REVIEW_PAGE_SIZE,
    ratingBuckets: {
      1: Number(statsRow?.rating1 ?? 0),
      2: Number(statsRow?.rating2 ?? 0),
      3: Number(statsRow?.rating3 ?? 0),
      4: Number(statsRow?.rating4 ?? 0),
      5: Number(statsRow?.rating5 ?? 0),
    },
    photoReviewCount: Number(statsRow?.photoCount ?? 0),
  };
}

export type ReviewableItem = {
  orderItemId: number;
  orderNo: string;
  productId: number;
  productName: string;
  optionLabel: string | null;
  thumbnailPath: string | null;
  deliveredAt: Date | null;
};

/**
 * 아직 리뷰를 쓰지 않은 구매 상품 — 마이페이지 "리뷰 쓸 상품" 목록.
 * 회원만이다: 비회원은 주문 조회는 되지만 리뷰 소유자를 특정할 수 없어 작성 대상이 아니다.
 */
export async function getReviewableItems(
  database: DatabaseClient,
  input: { customerId: number },
): Promise<ReviewableItem[]> {
  return database
    .select({
      orderItemId: orderItem.id,
      orderNo: orders.orderNo,
      productId: orderItem.productId,
      productName: orderItem.productName,
      optionLabel: orderItem.variantName,
      thumbnailPath: orderItem.thumbnailPath,
      deliveredAt: orders.deliveredAt,
    })
    .from(orderItem)
    .innerJoin(orders, eq(orderItem.orderId, orders.id))
    .where(
      and(
        eq(orders.customerId, input.customerId),
        inArray(orders.status, [...REVIEWABLE_ORDER_STATUSES]),
        // 상품이 삭제된 주문 항목은 리뷰를 붙일 곳이 없다
        sql`${orderItem.productId} is not null`,
        sql`not exists (select 1 from ${review} r where r.order_item_id = ${orderItem.id})`,
      ),
    )
    .orderBy(desc(orders.deliveredAt), desc(orderItem.id))
    .limit(50) as Promise<ReviewableItem[]>;
}

export type CreateReviewInput = {
  orderItemId: number;
  customerId: number;
  rating: number;
  content: string;
  tags: string[];
  images: string[];
};

/**
 * 리뷰 작성.
 *
 * 소유·상태·중복을 **한 트랜잭션 안에서** 확인한다 — 확인과 삽입 사이가 벌어지면
 * 같은 주문 상품에 리뷰가 두 개 생긴다(유니크 인덱스가 막지만, 그때는 읽을 수 없는 오류가 뜬다).
 */
export async function createReview(
  database: DatabaseClient,
  input: CreateReviewInput,
): Promise<{ reviewId: number; productId: number }> {
  return database.transaction(async (tx) => {
    const [purchased] = await tx
      .select({
        orderItemId: orderItem.id,
        productId: orderItem.productId,
        orderStatus: orders.status,
        ownerCustomerId: orders.customerId,
      })
      .from(orderItem)
      .innerJoin(orders, eq(orderItem.orderId, orders.id))
      .where(eq(orderItem.id, input.orderItemId))
      .limit(1);

    // 남의 주문 항목 id를 넣어도 "구매하지 않았다"로 끝난다 — 존재 여부를 알려주지 않는다
    if (!purchased || purchased.ownerCustomerId !== input.customerId) {
      throw new ReviewNotPurchasedError();
    }
    if (purchased.productId === null) throw new ReviewNotPurchasedError();
    if (!REVIEWABLE_ORDER_STATUSES.includes(purchased.orderStatus as "delivered" | "confirmed")) {
      throw new ReviewNotDeliveredError();
    }

    const [existing] = await tx
      .select({ id: review.id })
      .from(review)
      .where(eq(review.orderItemId, input.orderItemId))
      .limit(1);
    if (existing) throw new ReviewAlreadyWrittenError();

    const [inserted] = await tx
      .insert(review)
      .values({
        productId: purchased.productId,
        orderItemId: input.orderItemId,
        customerId: input.customerId,
        rating: input.rating,
        content: input.content,
        tags: input.tags,
        images: input.images,
      })
      .returning({ id: review.id });

    // 작성 즉시 상품 카드·상세의 별점이 맞아야 한다
    await recomputeProductRating(tx, purchased.productId);

    // 리뷰 적립 — 사진이 있으면 추가분이 붙는다.
    // 중복 방지는 주문 항목 기준이라(리뷰 id가 아니라) 지웠다 다시 써도 한 번뿐이다
    await earnReviewPoints(tx, {
      customerId: input.customerId,
      orderItemId: input.orderItemId,
      hasPhoto: (input.images?.length ?? 0) > 0,
    });

    return { reviewId: inserted.id, productId: purchased.productId };
  });
}

/** 리뷰 작성 화면 진입 데이터 — 대상 상품과 고를 수 있는 태그 */
export async function getReviewWriteView(
  database: DatabaseClient,
  input: { orderItemId: number; customerId: number },
): Promise<{
  target: { orderItemId: number; productName: string; optionLabel: string | null; thumbnailPath: string | null };
  tagOptions: { code: string; name: string }[];
}> {
  const [row] = await database
    .select({
      orderItemId: orderItem.id,
      productName: orderItem.productName,
      optionLabel: orderItem.variantName,
      thumbnailPath: orderItem.thumbnailPath,
      orderStatus: orders.status,
      ownerCustomerId: orders.customerId,
    })
    .from(orderItem)
    .innerJoin(orders, eq(orderItem.orderId, orders.id))
    .where(eq(orderItem.id, input.orderItemId))
    .limit(1);

  if (!row || row.ownerCustomerId !== input.customerId) throw new ReviewNotPurchasedError();
  if (!REVIEWABLE_ORDER_STATUSES.includes(row.orderStatus as "delivered" | "confirmed")) {
    throw new ReviewNotDeliveredError();
  }

  const [alreadyWritten] = await database
    .select({ id: review.id })
    .from(review)
    .where(eq(review.orderItemId, input.orderItemId))
    .limit(1);
  if (alreadyWritten) throw new ReviewAlreadyWrittenError();

  const tagRows = await getActiveCommonCodesWithMeta(database, "review_tag");

  return {
    target: {
      orderItemId: row.orderItemId,
      productName: row.productName,
      optionLabel: row.optionLabel,
      thumbnailPath: row.thumbnailPath,
    },
    tagOptions: tagRows.map(({ code, name }) => ({ code, name })),
  };
}

/** 내가 쓴 리뷰 — 마이페이지 */
export async function getMyReviews(
  database: DatabaseClient,
  input: { customerId: number },
): Promise<
  {
    reviewId: number;
    productId: number;
    productName: string;
    rating: number;
    content: string;
    isHidden: boolean;
    createdAt: Date;
  }[]
> {
  return database
    .select({
      reviewId: review.id,
      productId: review.productId,
      productName: product.name,
      rating: review.rating,
      content: review.content,
      isHidden: review.isHidden,
      createdAt: review.createdAt,
    })
    .from(review)
    .innerJoin(product, eq(review.productId, product.id))
    .where(and(eq(review.customerId, input.customerId), isNull(product.deletedAt)))
    .orderBy(desc(review.id))
    .limit(50);
}
