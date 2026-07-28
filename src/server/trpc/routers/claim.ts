import { z } from "zod";

import { getClaimRequestView } from "@/server/services/claim-view.service";
import { requestClaim } from "@/server/services/claim.service";

import { publicProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 클레임 라우터 — 고객 신청 표면(관리자 처리는 5·6주차 관리자 라우터가 맡는다).
 *
 * 비회원도 주문할 수 있으므로 publicProcedure이고, 소유 증명은 세션(customerId) 또는
 * 주문 생성 때 발급한 게스트 쿠키가 한다 — 서비스가 판정한다(RULE-14).
 */

const claimTypeSchema = z.enum(["cancel", "exchange", "return"]);

/** 주문번호 형식 — "YYYYMMDD-####" */
const orderNoSchema = z
  .string()
  .trim()
  .regex(/^\d{8}-\d{4,}$/, "주문번호 형식이 올바르지 않습니다.");

export const claimRouter = router({
  /** 신청 화면 진입 데이터 — 대상 품목(잔여 수량)·사유 목록·배송비 기준 */
  getRequestView: publicProcedure
    .input(z.object({ orderNo: orderNoSchema, claimType: claimTypeSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        getClaimRequestView(ctx.db, {
          orderNo: input.orderNo,
          claimType: input.claimType,
          customerId: ctx.customerId,
          guestToken: ctx.guestOrderToken,
        }),
      ),
    ),

  /**
   * 클레임 접수. 이 시점에는 돈도 재고도 움직이지 않는다 —
   * 환불·복원은 관리자 처리에서 일어난다.
   */
  request: publicProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        claimType: claimTypeSchema,
        reasonCode: z.string().trim().min(1).max(50),
        detail: z.string().trim().max(1000).optional(),
        /** 취소는 전체 주문 단위라 생략한다 */
        targets: z
          .array(
            z.object({
              orderItemId: z.number().int().positive(),
              quantity: z.number().int().min(1).max(999),
            }),
          )
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        requestClaim(ctx.db, {
          orderNo: input.orderNo,
          claimType: input.claimType,
          reasonCode: input.reasonCode,
          detail: input.detail ?? null,
          targets: input.targets,
          customerId: ctx.customerId,
          guestToken: ctx.guestOrderToken,
        }),
      ),
    ),
});
