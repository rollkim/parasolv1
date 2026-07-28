import { z } from "zod";

import {
  createAdminCategory,
  deleteAdminCategory,
  getAdminCategoryDeletePreview,
  listAdminCategoryTree,
  moveAdminCategoryOrder,
  updateAdminCategory,
} from "@/server/services/admin-category.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/** 관리자 카테고리 라우터 — 전부 adminProcedure. 깊이 규칙은 서비스가 지킨다(RULE-14) */

/** 스토어 URL이 되는 값이라 DB CHECK와 같은 형식을 화면에서도 막는다 */
const categorySlugSchema = z
  .string()
  .trim()
  .min(2, "URL 주소는 2자 이상 입력해 주세요.")
  .max(50)
  .regex(/^[a-z0-9-]+$/, "URL 주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다.");

const categoryNameSchema = z.string().trim().min(1, "카테고리 이름을 입력해 주세요.").max(50);

export const adminCategoryRouter = router({
  tree: adminProcedure.query(({ ctx }) => listAdminCategoryTree(ctx.db)),

  create: adminProcedure
    .input(
      z.object({
        parentId: z.number().int().positive().nullable(),
        name: categoryNameSchema,
        slug: categorySlugSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        createAdminCategory(ctx.db, { ...input, actor: { role: "admin", id: ctx.adminUserId } }),
      ),
    ),

  update: adminProcedure
    .input(
      z.object({
        categoryId: z.number().int().positive(),
        name: categoryNameSchema,
        slug: categorySlugSchema,
        isActive: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        updateAdminCategory(ctx.db, { ...input, actor: { role: "admin", id: ctx.adminUserId } }),
      ),
    ),

  /** 형제 안에서 한 칸 이동 — 드래그 대신 버튼(키보드로도 조작 가능해야 한다) */
  move: adminProcedure
    .input(
      z.object({
        categoryId: z.number().int().positive(),
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        moveAdminCategoryOrder(ctx.db, { ...input, actor: { role: "admin", id: ctx.adminUserId } }),
      ),
    ),

  /** 삭제 전 영향 범위 — "상품 N개가 미분류로 갑니다"를 미리 보여준다 */
  deletePreview: adminProcedure
    .input(z.object({ categoryId: z.number().int().positive() }))
    .query(({ ctx, input }) => getAdminCategoryDeletePreview(ctx.db, input.categoryId)),

  remove: adminProcedure
    .input(z.object({ categoryId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => deleteAdminCategory(ctx.db, { categoryId: input.categoryId })),
    ),
});
