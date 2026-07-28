import { getAdminDashboard } from "@/server/services/admin-dashboard.service";

import { adminProcedure, router } from "../init";

/** 관리자 대시보드 라우터 — 한 화면이라 조회 하나다 */
export const adminDashboardRouter = router({
  summary: adminProcedure.query(({ ctx }) => getAdminDashboard(ctx.db)),
});
