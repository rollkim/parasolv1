import { z } from "zod";

import { issueCouponToCustomer } from "@/server/services/coupon.service";
import {
  getStorePromotionDetail,
  listStorePromotions,
} from "@/server/services/promotion.service";

import { protectedProcedure, publicProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 기획전 + 쿠폰 다운로드 라우터.
 *
 * 다운로드(issueCoupon)를 여기 둔 이유: 지금 쿠폰을 받는 입구가 기획전뿐이다.
 * 상품 상세 등 입구가 늘면 그대로 재사용한다 — 수량·기간·인당 한도 판정은 전부
 * 발급 서비스(조건부 UPDATE)가 하므로 입구는 몇 개가 되어도 안전하다.
 */
export const promotionRouter = router({
  /** 진행 중 기획전 목록 — 종료 임박순, 예정 포함 */
  list: publicProcedure.query(({ ctx }) => listStorePromotions(ctx.db)),

  /** 기획전 상세 — 종료돼도 내려준다(공유 링크 보호). 중지된 것만 null */
  detail: publicProcedure
    .input(z.object({ slug: z.string().trim().min(1).max(80) }))
    .query(({ ctx, input }) => getStorePromotionDetail(ctx.db, input.slug)),

  /** 쿠폰 받기 — 회원 전용. 발급 가능 여부는 서비스가 판정한다(화면 목록을 믿지 않는다) */
  issueCoupon: protectedProcedure
    .input(z.object({ couponId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        ctx.db.transaction((tx) =>
          issueCouponToCustomer(tx, {
            couponId: input.couponId,
            customerId: ctx.customerId,
          }),
        ),
      ),
    ),
});
