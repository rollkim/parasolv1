import { z } from "zod";

import { listAuditLogs } from "@/server/services/admin-audit.service";

import { adminProcedure, router } from "../init";

/** 운영 기록 라우터 — 네 원장(주문·클레임·재고·환불)의 읽기 전용 창 */
export const adminAuditRouter = router({
  list: adminProcedure
    .input(
      z.object({
        kind: z.enum(["order", "claim", "stock", "refund"]),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAuditLogs(ctx.db, input)),
});
