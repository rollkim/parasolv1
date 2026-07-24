import { cookies } from "next/headers";
import { z } from "zod";

import {
  addCartItem,
  getCartItemCount,
  getCartWithItems,
  removeCartItem,
  updateCartItemQuantity,
} from "@/server/services/cart.service";

import { CART_COOKIE_NAME } from "../context";
import { publicProcedure, router } from "../init";

/**
 * 카트 라우터 — 비회원도 담을 수 있는 것이 정책(UX 규칙 4)이라 전부 publicProcedure.
 * 여기서는 zod 검증과 쿠키 발급(HTTP 관심사)만 하고, 로직은 서비스에 위임한다(RULE-14).
 */

const CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30일

/**
 * 카트 토큰 확보 — 없으면 랜덤 토큰을 만들어 httpOnly 쿠키로 발급한다.
 * cookies().set은 라우트 핸들러 컨텍스트에서만 허용되므로 뮤테이션에서만 부른다.
 */
async function ensureCartToken(currentCartToken: string | null): Promise<string> {
  if (currentCartToken) return currentCartToken;

  const issuedToken = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE_NAME, issuedToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  return issuedToken;
}

const addonSelectionSchema = z.object({
  addonId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(999),
});

export const cartRouter = router({
  /** 카트 화면 — 라인 + 서버 계산 합계. 토큰이 없으면 빈 카트를 내려준다 */
  getCart: publicProcedure.query(({ ctx }) => getCartWithItems(ctx.db, ctx.cartToken)),

  /** 헤더 뱃지용 라인 수 */
  getItemCount: publicProcedure.query(({ ctx }) => getCartItemCount(ctx.db, ctx.cartToken)),

  /** 담기 — 첫 담기라면 이 시점에 카트 토큰 쿠키를 발급한다 */
  addItem: publicProcedure
    .input(
      z.object({
        variantId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(999),
        addons: z.array(addonSelectionSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cartToken = await ensureCartToken(ctx.cartToken);
      return addCartItem(ctx.db, { cartToken, ...input });
    }),

  updateQuantity: publicProcedure
    .input(
      z.object({
        cartItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .mutation(({ ctx, input }) => {
      // 토큰이 없으면 소유한 카트도 없다 — 서비스의 소유 검증(NOT_FOUND)에 맡긴다
      return updateCartItemQuantity(ctx.db, { cartToken: ctx.cartToken ?? "", ...input });
    }),

  /** 삭제 — 실행취소 토스트가 재담기(addItem)에 쓸 스냅샷을 돌려준다 */
  removeItem: publicProcedure
    .input(z.object({ cartItemId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      return removeCartItem(ctx.db, { cartToken: ctx.cartToken ?? "", ...input });
    }),
});
