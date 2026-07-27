import { z } from "zod";

import {
  getSiteSetting,
  PUBLIC_SITE_SETTING_KEYS,
} from "@/server/services/site-setting.service";

import { publicProcedure, router } from "../init";

/**
 * 사이트 설정 라우터 — 얇게 유지한다.
 * 입력 검증(zod)과 권한(publicProcedure)만 여기서 처리하고,
 * 실제 조회는 도메인 서비스에 위임한다(RULE-14 레이어 경계).
 *
 * key는 공개 화이트리스트로 제한한다 — 임의 키를 받으면 익명이 내부 정책값
 * (point_policy·claim_policy 등)까지 덤프할 수 있다(보안 감사 HIGH). 목록 밖 키는
 * zod enum이 입력 단계에서 거부해 DB에 닿지 않는다.
 */
export const siteSettingRouter = router({
  get: publicProcedure
    .input(z.object({ key: z.enum(PUBLIC_SITE_SETTING_KEYS) }))
    .query(({ ctx, input }) => getSiteSetting(ctx.db, input.key)),
});
