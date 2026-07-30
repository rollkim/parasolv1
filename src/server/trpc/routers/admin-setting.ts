import { z } from "zod";

import {
  getAdminSettings,
  saveAdminAnalytics,
  saveAdminBusinessInfo,
  saveAdminPolicyText,
  saveAdminShippingPolicy,
  saveAdminPointPolicy,
  saveAdminTheme,
} from "@/server/services/admin-setting.service";
import { THEME_PRESETS } from "@/server/services/theme.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 설정 라우터 — 전부 adminProcedure.
 * 저장 키는 서비스가 고정한다. 화면이 키를 정하게 두면 오타 하나로
 * "저장은 됐는데 아무 데도 안 읽히는 값"이 생긴다.
 */

const text = (max: number) => z.string().trim().max(max);
const wonSchema = z.number().int().min(0).max(10_000_000);

export const adminSettingRouter = router({
  get: adminProcedure.query(({ ctx }) => getAdminSettings(ctx.db)),

  saveBusinessInfo: adminProcedure
    .input(
      z.object({
        brandName: text(50).min(1, "브랜드명을 입력해 주세요."),
        companyName: text(100).min(1, "상호를 입력해 주세요."),
        ceoName: text(50),
        businessNo: text(30),
        mailOrderNo: text(50),
        address: text(200),
        privacyOfficer: text(50),
        hostingProvider: text(100),
        csPhone: text(30),
        csHours: z.array(text(100)).max(5),
        csEmail: text(100).optional(),
        brandTagline: text(200),
        copyrightNotice: text(200),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminBusinessInfo(ctx.db, {
          businessInfo: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  /** 주문 금액·클레임 배송비가 이 값에서 나온다 — 검증은 서비스가 한다 */
  saveShippingPolicy: adminProcedure
    .input(
      z.object({
        baseFee: wonSchema,
        freeThreshold: wonSchema,
        remoteSurcharge: wonSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminShippingPolicy(ctx.db, {
          shippingPolicy: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  savePolicyText: adminProcedure
    .input(
      z.object({
        shippingNotice: text(2000),
        returnNotice: text(2000),
        exchangeNotice: text(2000),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminPolicyText(ctx.db, {
          policyText: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  saveAnalytics: adminProcedure
    .input(
      z.object({
        // 형식을 고정해 오타를 거른다 — 잘못된 ID는 "측정이 안 되는데 이유를 모르는" 상태를 만든다
        ga4MeasurementId: z
          .string()
          .trim()
          .max(30)
          .refine((value) => value === "" || /^G-[A-Z0-9]+$/.test(value), "GA4 ID는 G-로 시작합니다."),
        naverWcsId: text(30),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminAnalytics(ctx.db, {
          analytics: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  /**
   * 적립금 정책 — **돈이 걸린 값**이라 서비스가 상한·정합성을 다시 본다.
   * 적립률은 0.1% 단위 정수(10 = 1%)다.
   */
  savePointPolicy: adminProcedure
    .input(
      z.object({
        earnRatePerMille: z.number().int().min(0).max(1000),
        expiryDays: z.number().int().min(1).max(3650),
        useUnitPoint: z.number().int().min(1).max(10_000),
        minUsePoint: z.number().int().min(0).max(1_000_000),
        signupBonusPoint: z.number().int().min(0).max(1_000_000),
        reviewBonusPoint: z.number().int().min(0).max(1_000_000),
        photoReviewBonusPoint: z.number().int().min(0).max(1_000_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminPointPolicy(ctx.db, {
          pointPolicy: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  /** 색 프리셋 — globals.css가 정의한 이름만 받는다(색상값은 저장하지 않는다) */
  saveTheme: adminProcedure
    .input(
      z.object({
        storefront: z.enum(THEME_PRESETS),
        admin: z.enum(THEME_PRESETS),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminTheme(ctx.db, {
          theme: input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),
});
