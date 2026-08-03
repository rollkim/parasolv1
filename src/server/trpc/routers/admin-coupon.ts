import { z } from "zod";

import {
  createAdminCoupon,
  deactivateAdminCoupon,
  getAdminCoupon,
  listAdminCoupons,
  updateAdminCoupon,
} from "@/server/services/admin-coupon.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 쿠폰 라우터 — 전부 adminProcedure.
 * zod는 형태만 본다. **할인 조건의 정합성(정액에 상한 금지, 범위 쿠폰의 대상 필수 등)은
 * 서비스가 판정한다** — 화면·API 두 곳에 규칙을 두면 갈린다(RULE-14).
 */

/** 원 단위 정수. 상한을 두는 이유는 오타(0 하나 더)를 이 자리에서 막기 위해서다 */
const wonSchema = z.number().int().min(0).max(10_000_000);
const nullableWon = wonSchema.nullable();

const couponInputSchema = z.object({
  name: z.string().trim().min(1, "쿠폰 이름을 입력해 주세요.").max(80),
  discountKind: z.enum(["fixed", "percent"]),
  /** 정액은 원, 정률은 0.1% 단위 정수(100 = 10%) */
  discountValue: z.number().int().min(1).max(10_000_000),
  maxDiscountAmount: nullableWon,
  minOrderAmount: wonSchema,
  scopeKind: z.enum(["all", "category", "product"]),
  scopeRefId: z.number().int().positive().nullable(),
  issueMethod: z.enum(["download", "code", "auto"]),
  code: z.string().trim().max(40).nullable(),
  totalQuantity: z.number().int().min(1).max(1_000_000).nullable(),
  perCustomerLimit: z.number().int().min(1).max(100),
  validDays: z.number().int().min(1).max(3650).nullable(),
  // 화면은 날짜 문자열을 보낸다 — 서비스는 Date로 다룬다
  startsAt: z.coerce.date().nullable(),
  endsAt: z.coerce.date().nullable(),
  isActive: z.boolean(),
});

export const adminCouponRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          tab: z.enum(["all", "active", "ended"]).optional(),
          keyword: z.string().trim().max(80).optional(),
          page: z.number().int().min(1).optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) => listAdminCoupons(ctx.db, input ?? {})),

  get: adminProcedure
    .input(z.object({ couponId: z.number().int().positive() }))
    .query(({ ctx, input }) => getAdminCoupon(ctx.db, input.couponId)),

  create: adminProcedure
    .input(couponInputSchema)
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        createAdminCoupon(ctx.db, {
          coupon: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  update: adminProcedure
    .input(couponInputSchema.extend({ couponId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const { couponId, ...couponInput } = input;
      return withOrderErrorMapping(() =>
        updateAdminCoupon(ctx.db, {
          couponId,
          coupon: couponInput,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      );
    }),

  /** 사용 중지 — 삭제가 아니다. 발급된 쿠폰이 주문에 붙어 있어 지우면 이력이 끊긴다 */
  deactivate: adminProcedure
    .input(z.object({ couponId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        deactivateAdminCoupon(ctx.db, {
          couponId: input.couponId,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),
});
