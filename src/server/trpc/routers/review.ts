import { z } from "zod";

import { STORED_IMAGE_PATH_PATTERN } from "@/server/services/image-storage.service";
import {
  createReview,
  getMyReviews,
  getProductReviews,
  getReviewWriteView,
  getReviewableItems,
} from "@/server/services/review.service";

import { protectedProcedure, publicProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 리뷰 라우터 — 목록은 누구나, 작성은 회원만.
 *
 * 비회원도 주문할 수 있지만 리뷰는 회원만 쓴다: 리뷰는 계정에 귀속되는 발언이라
 * 소유자를 특정할 수 없으면 수정·삭제·신고 대응이 불가능하다.
 * 구매 검증(주문 소유·배송완료·중복)은 서비스가 한다(RULE-14).
 */

const productIdSchema = z.number().int().positive();

export const reviewRouter = router({
  listByProduct: publicProcedure
    .input(
      z.object({
        productId: productIdSchema,
        page: z.number().int().min(1).optional(),
        photoOnly: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) => getProductReviews(ctx.db, input)),

  /** 리뷰 쓸 수 있는 구매 상품 — 마이페이지 */
  listReviewable: protectedProcedure.query(({ ctx }) =>
    getReviewableItems(ctx.db, { customerId: ctx.customerId }),
  ),

  listMine: protectedProcedure.query(({ ctx }) =>
    getMyReviews(ctx.db, { customerId: ctx.customerId }),
  ),

  writeView: protectedProcedure
    .input(z.object({ orderItemId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        getReviewWriteView(ctx.db, {
          orderItemId: input.orderItemId,
          customerId: ctx.customerId,
        }),
      ),
    ),

  create: protectedProcedure
    .input(
      z.object({
        orderItemId: z.number().int().positive(),
        rating: z.number().int().min(1).max(5),
        // 최소 길이는 광고성 한 줄을 거르는 최소 장치다(목업 안내 문구와 같은 기준)
        content: z.string().trim().min(10, "리뷰는 10자 이상 입력해 주세요.").max(2000),
        tags: z.array(z.string().trim().max(30)).max(6),
        images: z
          .array(z.string().trim().regex(STORED_IMAGE_PATH_PATTERN, "이미지 경로가 올바르지 않습니다."))
          .max(5),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        createReview(ctx.db, { ...input, customerId: ctx.customerId }),
      ),
    ),
});
