import { z } from "zod";

import { CLAIM_STATUSES, CLAIM_TYPES } from "@/domain/claim";
import { getPaymentGateway } from "@/server/payments";
import {
  getAdminClaimDetail,
  listAdminClaims,
  resolveClaimIdByNo,
  saveAdminClaimMemo,
  type AdminClaimStatusFilter,
  type AdminClaimTypeFilter,
} from "@/server/services/admin-claim.service";
import {
  approveClaim,
  completeExchange,
  markCollected,
  rejectClaim,
  settleClaimFee,
} from "@/server/services/claim-process.service";
import { refundClaim } from "@/server/services/claim-refund.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 클레임 라우터 — 전부 adminProcedure다.
 *
 * **처리 로직은 하나도 여기 없다.** 승인·반려·회수·환불·교환발송은 C3·C4 서비스가 맡고,
 * 이 라우터는 화면 식별자(claimNo)를 서비스 식별자(claimId)로 바꿔 넘기는 일만 한다.
 * 재고 복원 시점·환불 채널·전이 규칙이 관리자 경로에서 갈라지면 안 되기 때문이다(RULE-14).
 */

/** 접수번호 형식 — "{CN|EX|RT}-YYYYMMDD-####" */
const claimNoSchema = z
  .string()
  .trim()
  .regex(/^(CN|EX|RT)-\d{8}-\d{4,}$/, "접수번호 형식이 올바르지 않습니다.");

// 도메인 목록에서 만든다 — 상태·유형이 늘면 여기도 자동으로 따라온다
const claimStatusFilterSchema = z.enum(
  ["all", ...CLAIM_STATUSES] as unknown as [AdminClaimStatusFilter, ...AdminClaimStatusFilter[]],
);
const claimTypeFilterSchema = z.enum(
  ["all", ...CLAIM_TYPES] as unknown as [AdminClaimTypeFilter, ...AdminClaimTypeFilter[]],
);

/** 되돌릴 수 없는 처리에는 근거를 남긴다 — 나중에 "왜 이렇게 처리했나"에 답할 수 있어야 한다 */
const memoSchema = z.string().trim().max(500).optional();

export const adminClaimRouter = router({
  list: adminProcedure
    .input(
      z.object({
        claimStatus: claimStatusFilterSchema.optional(),
        claimTypeFilter: claimTypeFilterSchema.optional(),
        keyword: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminClaims(ctx.db, input)),

  detail: adminProcedure
    .input(z.object({ claimNo: claimNoSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() => getAdminClaimDetail(ctx.db, input.claimNo)),
    ),

  /** 승인(반품·교환) — 회수를 요청하는 단계라 돈·재고는 움직이지 않는다 */
  approve: adminProcedure
    .input(z.object({ claimNo: claimNoSchema, memo: memoSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(async () =>
        approveClaim(ctx.db, {
          claimId: await resolveClaimIdByNo(ctx.db, input.claimNo),
          actor: { role: "admin", id: ctx.adminUserId },
          memo: input.memo ?? null,
        }),
      ),
    ),

  /** 반려 — 사유가 고객에게 그대로 안내되므로 필수다(도메인이 강제) */
  reject: adminProcedure
    .input(z.object({ claimNo: claimNoSchema, memo: z.string().trim().min(1, "반려 사유를 입력해 주세요.").max(500) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(async () =>
        rejectClaim(ctx.db, {
          claimId: await resolveClaimIdByNo(ctx.db, input.claimNo),
          actor: { role: "admin", id: ctx.adminUserId },
          memo: input.memo,
        }),
      ),
    ),

  /** 회수 완료 — 입고 확인일 뿐 검수 전이라 재고를 올리지 않는다 */
  markCollected: adminProcedure
    .input(z.object({ claimNo: claimNoSchema, memo: memoSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(async () =>
        markCollected(ctx.db, {
          claimId: await resolveClaimIdByNo(ctx.db, input.claimNo),
          actor: { role: "admin", id: ctx.adminUserId },
          memo: input.memo ?? null,
        }),
      ),
    ),

  /** 배송비 입금 확인 — 상태가 아니라 fee_settled_at 축을 채운다 */
  settleFee: adminProcedure
    .input(z.object({ claimNo: claimNoSchema, memo: memoSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(async () =>
        settleClaimFee(ctx.db, {
          claimId: await resolveClaimIdByNo(ctx.db, input.claimNo),
          actor: { role: "admin", id: ctx.adminUserId },
          memo: input.memo ?? null,
        }),
      ),
    ),

  /**
   * 검수 완료 · 교환품 발송. restockable은 관리자 판단이다 —
   * 오배송(멀쩡한 상품)은 재입고, 파손·불량은 폐기다. 귀책으로 유추할 수 없다.
   */
  completeExchange: adminProcedure
    .input(z.object({ claimNo: claimNoSchema, restockable: z.boolean(), memo: memoSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(async () =>
        completeExchange(ctx.db, {
          claimId: await resolveClaimIdByNo(ctx.db, input.claimNo),
          actor: { role: "admin", id: ctx.adminUserId },
          restockable: input.restockable,
          memo: input.memo ?? null,
        }),
      ),
    ),

  /**
   * 환불 실행 — 채널 3종. pg_api만 게이트웨이를 부르고, 수동 채널(pg_console·bank_transfer)은
   * 관리자가 밖에서 이미 끝낸 것을 기록만 한다. 수동 채널은 참조가 필수다(도메인이 강제).
   */
  refund: adminProcedure
    .input(
      z.object({
        claimNo: claimNoSchema,
        refundChannel: z.enum(["pg_api", "pg_console", "bank_transfer"]).optional(),
        refundReference: z.string().trim().max(200).optional(),
        restockable: z.boolean().optional(),
        memo: memoSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(async () =>
        refundClaim(ctx.db, getPaymentGateway(), {
          claimId: await resolveClaimIdByNo(ctx.db, input.claimNo),
          actor: { role: "admin", id: ctx.adminUserId },
          refundChannel: input.refundChannel,
          refundReference: input.refundReference ?? null,
          restockable: input.restockable,
          memo: input.memo ?? null,
        }),
      ),
    ),

  saveMemo: adminProcedure
    .input(z.object({ claimNo: claimNoSchema, memo: z.string().trim().max(2000) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminClaimMemo(ctx.db, { claimNo: input.claimNo, memo: input.memo }),
      ),
    ),
});
