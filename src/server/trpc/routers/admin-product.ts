import { z } from "zod";

import {
  changeAdminProductStatus,
  deleteAdminProducts,
  getAdminProductForm,
  getNewProductForm,
  listAdminProducts,
  saveAdminProduct,
} from "@/server/services/admin-product.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 상품 라우터 — 전부 adminProcedure다.
 *
 * 이미지 업로드만 여기 없다 — multipart라 tRPC(JSON 전제)로는 실을 수 없어
 * /api/admin/product-images 라우트가 맡는다. 그 라우트도 같은 관리자 세션을 검증한다.
 */

/** 스토어 URL이 되는 값이라 규약(DB CHECK)과 같은 형식을 화면에서도 막는다 */
const productSlugSchema = z
  .string()
  .trim()
  .min(2, "URL 주소는 2자 이상 입력해 주세요.")
  .max(80)
  .regex(/^[a-z0-9-]+$/, "URL 주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다.");

const productStatusSchema = z.enum(["draft", "active", "hidden"]);

/** 금액은 전부 원 단위 정수(RULE-11) — 소수·문자열 금액이 들어올 여지를 없앤다 */
const wonSchema = z.number().int().min(0).max(100_000_000);

const productFormSchema = z.object({
  productId: z.number().int().positive().nullable(),
  name: z.string().trim().min(1, "상품명을 입력해 주세요.").max(200),
  slug: productSlugSchema,
  summary: z.string().trim().max(300).nullable(),
  description: z.string().max(50_000).nullable(),
  productStatus: productStatusSchema,
  badgeLabel: z.string().trim().max(20).nullable(),
  makerId: z.number().int().positive().nullable(),
  categoryIds: z.array(z.number().int().positive()).max(20),
  // 대표가 categoryIds에 없으면 서비스가 첫 번째로 되돌린다 — 여기서는 형태만 본다
  primaryCategoryId: z.number().int().positive().optional(),
  options: z
    .array(
      z.object({
        name: z.string().trim().min(1, "옵션명을 입력해 주세요.").max(50),
        values: z.array(z.string().trim().min(1).max(50)).min(1).max(50),
      }),
    )
    .max(3), // 조합 폭발 방지 — 목업도 3개까지만 허용한다
  variants: z
    .array(
      z.object({
        optionLabels: z.array(z.string().trim().min(1).max(50)).max(3),
        price: wonSchema,
        compareAtPrice: wonSchema.nullable(),
        stock: z.number().int().min(0).max(1_000_000),
        sku: z.string().trim().max(50).nullable(),
        isActive: z.boolean(),
      }),
    )
    .min(1, "판매 단위가 최소 하나 있어야 합니다.")
    .max(300),
  addons: z
    .array(
      z.object({
        addonId: z.number().int().positive().nullable(),
        name: z.string().trim().min(1).max(100),
        price: wonSchema,
        isActive: z.boolean(),
      }),
    )
    .max(20),
  images: z
    .array(
      z.object({
        imageKind: z.enum(["thumbnail", "detail"]),
        // 업로드 라우트가 돌려준 상대경로만 받는다 — 임의 경로가 DB에 들어오지 않게 형식을 고정
        path: z
          .string()
          .trim()
          .regex(/^products\/\d{6}\/[a-f0-9]+\.(jpg|png|webp|avif)$/, "이미지 경로가 올바르지 않습니다."),
        // 대체 텍스트는 접근성 필수(RULE-11) — 빈 값을 서버가 거절한다
        alt: z.string().trim().min(1, "이미지 대체 텍스트를 입력해 주세요.").max(200),
      }),
    )
    .max(30),
});

export const adminProductRouter = router({
  list: adminProcedure
    .input(
      z.object({
        tab: z.enum(["all", "active", "soldout", "hidden", "draft"]).optional(),
        categoryId: z.number().int().positive().optional(),
        keyword: z.string().trim().max(100).optional(),
        sort: z.enum(["recent", "sales", "lowstock", "priceHigh"]).optional(),
        page: z.number().int().min(1).optional(),
        // 날짜 입력(YYYY-MM-DD)을 그대로 받는다 — Date로 받으면 브라우저 시간대에 따라
        // 하루가 밀린다. 서버에서 그날의 처음·끝으로 넓혀 붙인다
        registeredFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        registeredTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listAdminProducts(ctx.db, {
        ...input,
        registeredFrom: input.registeredFrom
          ? new Date(`${input.registeredFrom}T00:00:00`)
          : undefined,
        // 끝날은 그날 23:59:59까지 — 날짜만 비교하면 그날 등록분이 통째로 빠진다
        registeredTo: input.registeredTo
          ? new Date(`${input.registeredTo}T23:59:59.999`)
          : undefined,
      }),
    ),

  /** 등록·수정 공용 폼 — productId가 없으면 빈 양식 */
  form: adminProcedure
    .input(z.object({ productId: z.number().int().positive().nullable() }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        input.productId === null
          ? getNewProductForm(ctx.db)
          : getAdminProductForm(ctx.db, input.productId),
      ),
    ),

  save: adminProcedure
    .input(productFormSchema)
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        saveAdminProduct(ctx.db, { ...input, actor: { role: "admin", id: ctx.adminUserId } }),
      ),
    ),

  changeStatus: adminProcedure
    .input(
      z.object({
        productIds: z.array(z.number().int().positive()).min(1).max(100),
        productStatus: productStatusSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        changeAdminProductStatus(ctx.db, {
          productIds: input.productIds,
          productStatus: input.productStatus,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),

  /** 삭제는 soft delete — 주문·리뷰가 참조하므로 행을 지우지 않는다 */
  remove: adminProcedure
    .input(z.object({ productIds: z.array(z.number().int().positive()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        deleteAdminProducts(ctx.db, {
          productIds: input.productIds,
          actor: { role: "admin", id: ctx.adminUserId },
        }),
      ),
    ),
});
