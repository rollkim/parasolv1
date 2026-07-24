import { z } from "zod";

import { getSiteSetting } from "@/server/services/site-setting.service";

import { publicProcedure, router } from "../init";

/**
 * 사이트 설정 라우터 — 얇게 유지한다.
 * 입력 검증(zod)과 권한(publicProcedure)만 여기서 처리하고,
 * 실제 조회는 도메인 서비스에 위임한다(RULE-14 레이어 경계).
 */
export const siteSettingRouter = router({
  get: publicProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(({ ctx, input }) => getSiteSetting(ctx.db, input.key)),
});
