import { z } from "zod";

import { ORDER_STATUSES } from "@/domain/order";
import {
  changeAdminOrderStatus,
  getAdminOrderDetail,
  listAdminOrders,
  registerShipmentInvoice,
  updateShipmentInvoice,
} from "@/server/services/admin-order.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 주문 라우터 — 전부 adminProcedure다.
 * 상태 변경·송장 등록은 고객 경로와 같은 초크포인트를 지나므로 여기서는 zod 검증만 한다(RULE-14).
 */

const orderNoSchema = z
  .string()
  .trim()
  .regex(/^\d{8}-\d{4,}$/, "주문번호 형식이 올바르지 않습니다.");

const adminOrderTabSchema = z.enum([
  "all",
  "paid",
  "preparing",
  "shipping",
  "delivered",
  "cancelled",
]);

/** 택배사 코드 — common_code(carrier) 규약(영문 소문자) */
const carrierCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z_]+$/, "택배사 코드가 올바르지 않습니다.");

export const adminOrderRouter = router({
  list: adminProcedure
    .input(
      z.object({
        tab: adminOrderTabSchema.optional(),
        keyword: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminOrders(ctx.db, input)),

  detail: adminProcedure
    .input(z.object({ orderNo: orderNoSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() => getAdminOrderDetail(ctx.db, input.orderNo)),
    ),

  /** 송장 등록 — 등록과 배송중 전이가 한 트랜잭션이다 */
  registerInvoice: adminProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        carrierCode: carrierCodeSchema,
        trackingNo: z
          .string()
          .trim()
          .min(4, "송장번호를 입력해 주세요.")
          .max(50)
          .regex(/^[0-9-]+$/, "송장번호는 숫자와 하이픈만 입력할 수 있습니다."),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        registerShipmentInvoice(ctx.db, {
          orderNo: input.orderNo,
          carrierCode: input.carrierCode,
          trackingNo: input.trackingNo,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  /** 송장 수정 — 상태 전이 없이 택배사·번호만 바로잡는다(배송중·배송완료에서만) */
  updateInvoice: adminProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        carrierCode: carrierCodeSchema,
        trackingNo: z
          .string()
          .trim()
          .min(4, "송장번호를 입력해 주세요.")
          .max(50)
          .regex(/^[0-9-]+$/, "송장번호는 숫자와 하이픈만 입력할 수 있습니다."),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        updateShipmentInvoice(ctx.db, {
          orderNo: input.orderNo,
          carrierCode: input.carrierCode,
          trackingNo: input.trackingNo,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  changeStatus: adminProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        toStatus: z.enum(ORDER_STATUSES as unknown as [string, ...string[]]),
        memo: z.string().trim().max(300).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        changeAdminOrderStatus(ctx.db, {
          orderNo: input.orderNo,
          toStatus: input.toStatus as (typeof ORDER_STATUSES)[number],
          actor: { role: "admin", id: ctx.adminUserId },
          memo: input.memo ?? null,
        }),
      ),
    ),
});
