import { z } from "zod";

import { STORED_IMAGE_PATH_PATTERN } from "@/server/services/image-storage.service";
import {
  deleteAdminBanner,
  deleteAdminDisplaySection,
  listAdminBanners,
  listAdminDisplaySections,
  moveAdminBannerOrder,
  moveAdminDisplaySectionOrder,
  saveAdminBanner,
  saveAdminDisplaySection,
  searchProductsForDisplay,
} from "@/server/services/admin-display.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/** 관리자 배너·진열 라우터 — 전부 adminProcedure */

const idSchema = z.number().int().positive();
const optionalText = (max: number) => z.string().trim().max(max).nullable();

/** 업로드 라우트가 돌려준 경로만 받는다 — 임의 경로가 DB에 들어가지 않게 형식을 고정 */
const storedImagePathSchema = z
  .string()
  .trim()
  .regex(STORED_IMAGE_PATH_PATTERN, "이미지 경로가 올바르지 않습니다.")
  .nullable();

/** 링크는 내부 경로 또는 http(s)만 — javascript: 스킴이 들어오면 클릭이 곧 실행이 된다 */
const linkUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//.test(value),
    "링크는 / 로 시작하는 내부 경로이거나 http(s) 주소여야 합니다.",
  )
  .nullable();

export const adminDisplayRouter = router({
  listBanners: adminProcedure.query(({ ctx }) => listAdminBanners(ctx.db)),

  saveBanner: adminProcedure
    .input(
      z.object({
        bannerId: idSchema.nullable(),
        slot: z.enum(["hero", "strip"]),
        title: optionalText(200),
        kicker: optionalText(100),
        subtitle: optionalText(300),
        ctaLabel: optionalText(50),
        imagePath: storedImagePathSchema,
        alt: optionalText(200),
        // 색상값이 아니라 토큰명 — 리스킨 때 따라오게 하려면 코드여야 한다
        toneCode: z.enum(["primary", "accent", "foreground"]).nullable(),
        linkUrl: linkUrlSchema,
        isActive: z.boolean(),
        startsAt: z.date().nullable(),
        endsAt: z.date().nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminBanner(ctx.db, { ...input, actor: { role: "admin", id: ctx.adminUserId } }),
      ),
    ),

  moveBanner: adminProcedure
    .input(z.object({ bannerId: idSchema, direction: z.enum(["up", "down"]) }))
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => moveAdminBannerOrder(ctx.db, input))),

  deleteBanner: adminProcedure
    .input(z.object({ bannerId: idSchema }))
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => deleteAdminBanner(ctx.db, input))),

  // ── 진열 섹션
  listSections: adminProcedure.query(({ ctx }) => listAdminDisplaySections(ctx.db)),

  saveSection: adminProcedure
    .input(
      z.object({
        sectionId: idSchema.nullable(),
        kicker: optionalText(100),
        title: z.string().trim().min(1, "섹션 제목을 입력해 주세요.").max(100),
        kind: z.enum(["manual", "new", "best"]),
        isActive: z.boolean(),
        productIds: z.array(idSchema).max(50),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminDisplaySection(ctx.db, {
          ...input,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  moveSection: adminProcedure
    .input(z.object({ sectionId: idSchema, direction: z.enum(["up", "down"]) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => moveAdminDisplaySectionOrder(ctx.db, input)),
    ),

  deleteSection: adminProcedure
    .input(z.object({ sectionId: idSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => deleteAdminDisplaySection(ctx.db, input)),
    ),

  searchProducts: adminProcedure
    .input(z.object({ keyword: z.string().trim().max(100).optional() }))
    .query(({ ctx, input }) => searchProductsForDisplay(ctx.db, input)),
});
