import { z } from "zod";

import {
  dismissAdminReviewReports,
  listAdminReviews,
  replyToAdminReview,
  setAdminReviewHidden,
} from "@/server/services/admin-review.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/** 관리자 리뷰 라우터 — 전부 adminProcedure. 별점 캐시 갱신은 서비스가 맡는다(RULE-14) */

const reviewIdSchema = z.number().int().positive();

export const adminReviewRouter = router({
  list: adminProcedure
    .input(
      z.object({
        tab: z.enum(["all", "reported", "hidden", "unanswered"]).optional(),
        /** 0이면 전체 별점 */
        rating: z.number().int().min(0).max(5).optional(),
        keyword: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminReviews(ctx.db, input)),

  /** 답글 — 빈 문자열이면 답글을 지운다 */
  reply: adminProcedure
    .input(z.object({ reviewId: reviewIdSchema, reply: z.string().trim().max(2000) }))
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => replyToAdminReview(ctx.db, input))),

  /** 숨김·노출 — 상품 별점 캐시가 함께 갱신된다 */
  setHidden: adminProcedure
    .input(z.object({ reviewId: reviewIdSchema, isHidden: z.boolean() }))
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => setAdminReviewHidden(ctx.db, input))),

  dismissReports: adminProcedure
    .input(z.object({ reviewId: reviewIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => dismissAdminReviewReports(ctx.db, input)),
    ),
});
