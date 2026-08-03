import { z } from "zod";

import {
  createAdminPromotion,
  deactivateAdminPromotion,
  getAdminPromotion,
  listAdminPromotions,
  listCouponChoices,
  updateAdminPromotion,
} from "@/server/services/admin-promotion.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/** 관리자 기획전 라우터 — 전부 adminProcedure. 정합성 판정은 서비스가 한다(RULE-14) */

const promotionInputSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1, "기획전 제목을 입력해 주세요.").max(120),
  description: z.string().trim().max(2000).nullable(),
  heroImagePath: z.string().trim().max(500).nullable(),
  heroMobileImagePath: z.string().trim().max(500).nullable(),
  startsAt: z.coerce.date().nullable(),
  endsAt: z.coerce.date().nullable(),
  couponId: z.number().int().positive().nullable(),
  isActive: z.boolean(),
  // 배열 순서가 곧 진열 순서 — 100개 상한은 한 기획전이 전 상품을 삼키는 실수 방지
  productIds: z.array(z.number().int().positive()).min(1).max(100),
});

export const adminPromotionRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          keyword: z.string().trim().max(80).optional(),
          page: z.number().int().min(1).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => listAdminPromotions(ctx.db, input ?? {})),

  get: adminProcedure
    .input(z.object({ promotionId: z.number().int().positive() }))
    .query(({ ctx, input }) => getAdminPromotion(ctx.db, input.promotionId)),

  /** 쿠폰 연결 선택지 — 활성 쿠폰만 */
  couponChoices: adminProcedure.query(({ ctx }) => listCouponChoices(ctx.db)),

  create: adminProcedure
    .input(promotionInputSchema)
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        createAdminPromotion(ctx.db, {
          promotion: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  update: adminProcedure
    .input(promotionInputSchema.extend({ promotionId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const { promotionId, ...promotionInput } = input;
      return withOrderErrorMapping(() =>
        updateAdminPromotion(ctx.db, {
          promotionId,
          promotion: promotionInput,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      );
    }),

  /** 중지 — 삭제가 아니다. 지난 기획전 기록은 남는다 */
  deactivate: adminProcedure
    .input(z.object({ promotionId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        deactivateAdminPromotion(ctx.db, {
          promotionId: input.promotionId,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),
});
