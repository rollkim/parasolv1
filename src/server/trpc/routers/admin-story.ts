import { z } from "zod";

import {
  deleteAdminStory,
  getAdminStoryForm,
  listAdminStories,
  saveAdminStory,
} from "@/server/services/admin-story.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 이야기 라우터 — 전부 adminProcedure.
 * 살균·대표 단일 보장·슬러그 중복 판정은 서비스가 한다(RULE-14).
 */
const articleIdSchema = z.number().int().positive();

export const adminStoryRouter = router({
  list: adminProcedure
    .input(
      z.object({
        tab: z.enum(["all", "published", "draft", "scheduled"]).optional(),
        keyword: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminStories(ctx.db, input)),

  form: adminProcedure
    .input(z.object({ articleId: articleIdSchema.nullable() }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() => getAdminStoryForm(ctx.db, input.articleId)),
    ),

  save: adminProcedure
    .input(
      z.object({
        articleId: articleIdSchema.nullable(),
        // 스토어 주소(/story/{slug})가 된다 — 영문 소문자·숫자·하이픈만(RULE-11)
        slug: z
          .string()
          .trim()
          .min(1, "URL 주소를 입력해 주세요.")
          .max(100)
          .regex(/^[a-z0-9-]+$/, "URL 주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다."),
        title: z.string().trim().min(1, "제목을 입력해 주세요.").max(200),
        summary: z.string().trim().max(300).optional(),
        content: z.string().max(200_000),
        categoryCode: z
          .string()
          .trim()
          .regex(/^[a-z0-9_]+$/)
          .optional(),
        productId: articleIdSchema.optional(),
        authorName: z.string().trim().max(50).optional(),
        coverImagePath: z.string().trim().max(200).optional(),
        isFeatured: z.boolean(),
        // 비우면 작성 중, 미래 시각이면 예약 발행 — 상태 컬럼 없이 시각 하나로 판정한다
        publishedAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .optional()
          .or(z.literal("")),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminStory(ctx.db, {
          articleId: input.articleId,
          slug: input.slug,
          title: input.title,
          summary: input.summary || null,
          content: input.content,
          categoryCode: input.categoryCode || null,
          productId: input.productId ?? null,
          authorName: input.authorName || null,
          coverImagePath: input.coverImagePath || null,
          isFeatured: input.isFeatured,
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  remove: adminProcedure
    .input(z.object({ articleId: articleIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => deleteAdminStory(ctx.db, input)),
    ),
});
