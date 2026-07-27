import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  getWishlistCards,
  isProductWished,
  removeWishlistMany,
  requestRestockNotification,
  toggleWishlist,
} from "@/server/services/wishlist.service";

import { protectedProcedure, publicProcedure, router } from "../init";

/**
 * 찜·재입고 알림 라우터 — 찜은 회원 전용(protectedProcedure),
 * 재입고 알림만 비회원 phone 신청을 허용해 public이다. 로직은 서비스에 위임(RULE-14).
 */

const restockPhoneSchema = z
  .string()
  .transform((rawPhone) => rawPhone.replaceAll("-", ""))
  .pipe(
    z.string().regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 올바르지 않습니다."),
  );

export const wishlistRouter = router({
  /** 하트 토글 — 응답 wished로 aria-pressed와 해제 실행취소 토스트 상태를 맞춘다 */
  toggle: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      toggleWishlist(ctx.db, { customerId: ctx.customerId, ...input }),
    ),

  /** 찜 목록 화면 — 최근 찜한 순 상품 카드 */
  getCards: protectedProcedure.query(({ ctx }) =>
    getWishlistCards(ctx.db, ctx.customerId),
  ),

  /** 상품 상세 진입 시 하트 초기 상태 */
  isWished: protectedProcedure
    .input(z.object({ productId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      isProductWished(ctx.db, { customerId: ctx.customerId, ...input }),
    ),

  /** 찜 목록 선택 삭제 */
  removeMany: protectedProcedure
    .input(
      z.object({ productIds: z.array(z.number().int().positive()).min(1).max(100) }),
    )
    .mutation(({ ctx, input }) =>
      removeWishlistMany(ctx.db, { customerId: ctx.customerId, ...input }),
    ),

  /** 재입고 알림 신청 — 회원은 세션 귀속, 비회원은 휴대폰 번호로 신청 */
  requestRestock: publicProcedure
    .input(
      z.object({
        variantId: z.number().int().positive(),
        // 비회원 전용 — "비회원이면 필수"는 세션(ctx)을 아는 뮤테이션 본문에서 판정한다
        phone: restockPhoneSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (ctx.customerId !== null) {
        // 회원 신청 — 클라이언트가 보낸 phone은 신뢰하지 않고 버린다
        return requestRestockNotification(ctx.db, {
          variantId: input.variantId,
          customerId: ctx.customerId,
        });
      }
      if (!input.phone) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "비회원 재입고 알림은 휴대폰 번호를 입력해 주세요.",
        });
      }
      return requestRestockNotification(ctx.db, {
        variantId: input.variantId,
        phone: input.phone,
      });
    }),
});
