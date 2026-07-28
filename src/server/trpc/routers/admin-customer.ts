import { z } from "zod";

import {
  changeAdminCustomerActive,
  getAdminCustomerDetail,
  listAdminCustomers,
  saveAdminCustomerMemo,
  withdrawAdminCustomer,
} from "@/server/services/admin-customer.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 회원 라우터 — 전부 adminProcedure.
 * 적립금 지급·등급 변경은 없다(2차 기능) — 원장 없이 잔액만 늘리는 버튼을 만들지 않는다.
 */

const customerIdSchema = z.number().int().positive();

export const adminCustomerRouter = router({
  list: adminProcedure
    .input(
      z.object({
        tab: z.enum(["all", "active", "suspended", "withdrawn"]).optional(),
        keyword: z.string().trim().max(100).optional(),
        sort: z.enum(["recent", "spending", "orderCount"]).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminCustomers(ctx.db, input)),

  detail: adminProcedure
    .input(z.object({ customerId: customerIdSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() => getAdminCustomerDetail(ctx.db, input.customerId)),
    ),

  saveMemo: adminProcedure
    .input(z.object({ customerId: customerIdSchema, memo: z.string().trim().max(2000) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => saveAdminCustomerMemo(ctx.db, input)),
    ),

  /** 정지·해제 — 되돌릴 수 있는 조치 */
  changeActive: adminProcedure
    .input(z.object({ customerId: customerIdSchema, isActive: z.boolean() }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => changeAdminCustomerActive(ctx.db, input)),
    ),

  /** 강제 탈퇴 — 개인정보를 지운다. 되돌릴 수 없다 */
  withdraw: adminProcedure
    .input(z.object({ customerId: customerIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        withdrawAdminCustomer(ctx.db, {
          customerId: input.customerId,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),
});
