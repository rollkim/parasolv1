import { z } from "zod";

import {
  changeAdminCustomerActive,
  getAdminCustomerDetail,
  listAdminCustomers,
  saveAdminCustomerMemo,
  withdrawAdminCustomer,
} from "@/server/services/admin-customer.service";

import {
  listAdminGrades,
  updateAdminGrade,
} from "@/server/services/admin-grade.service";
import { issueTempPassword } from "@/server/services/admin-customer.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 회원 라우터 — 전부 adminProcedure.
 * 적립금 지급·등급 변경은 없다(2차 기능) — 원장 없이 잔액만 늘리는 버튼을 만들지 않는다.
 */

const customerIdSchema = z.number().int().positive();

export const adminCustomerRouter = router({
  /** 등급 기준 목록 — 회원 수 포함(기준 변경의 영향 범위가 보이게) */
  listGrades: adminProcedure.query(({ ctx }) => listAdminGrades(ctx.db)),

  /** 등급 기준 저장 — 적립률이 걸린 값이라 서비스가 상한을 다시 본다 */
  updateGrade: adminProcedure
    .input(
      z.object({
        gradeId: z.number().int().positive(),
        gradeName: z.string().trim().min(1).max(40),
        bonusRatePerMille: z.number().int().min(0).max(1000),
        minRecentSpend: z.number().int().min(0).max(100_000_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        updateAdminGrade(ctx.db, {
          ...input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

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

  /** 임시 비밀번호 발급 — 평문은 응답으로 한 번만 나간다(저장은 해시뿐) */
  issueTempPassword: adminProcedure
    .input(z.object({ customerId: customerIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        issueTempPassword(ctx.db, {
          customerId: input.customerId,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
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
