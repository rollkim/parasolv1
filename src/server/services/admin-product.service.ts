import "server-only";

import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";

import {
  category,
  inventoryLog,
  maker,
  product,
  productAddon,
  productCategory,
  productImage,
  productOption,
  productOptionValue,
  productVariant,
  variantOptionValue,
} from "@/db/schema";

import type { DatabaseClient, TransactionClient } from "./db-client";
import { sanitizeRichText } from "./html-sanitize.service";
import { serializeActor, type TransitionActor } from "./order-status.service";
import { claimFiles, releaseOwnerFiles } from "./uploaded-file.service";

/**
 * 관리자 상품 관리 — 목록·조회·저장.
 *
 * 이 모듈의 어려운 부분은 **variant 재조정**이다. 옵션 구성을 바꾸면 판매 단위 조합이
 * 통째로 달라지는데, 기존 variant를 지우면 이미 팔린 주문의 통계 참조(order_item.variant_id)와
 * 재고 원장이 끊긴다. 그래서 조합 라벨로 매칭해 살리고, 사라진 조합만 내린다.
 *
 * 재고를 여기서 직접 고칠 수 있다 — 실사 조정이다. 조건부 차감(RULE-11)은 판매 흐름의
 * 규칙이고, 관리자 조정은 절대값 설정이 맞다. 대신 **원장 없이 조용히 바뀌지 않게** 한다.
 */

/** 상태 탭. 품절은 상태가 아니라 재고 0에서 파생된다(스토어프론트와 같은 규칙) */
export type AdminProductTab = "all" | "active" | "soldout" | "hidden" | "draft";
export type AdminProductSort = "recent" | "sales" | "lowstock" | "priceHigh";

export type AdminProductCard = {
  productId: number;
  name: string;
  slug: string;
  makerName: string | null;
  productStatus: "draft" | "active" | "hidden";
  productStatusLabel: string;
  minPrice: number;
  totalStock: number;
  isSoldOut: boolean;
  variantCount: number;
  salesCount: number;
  thumbnailPath: string | null;
};

export type AdminProductListResult = {
  cards: AdminProductCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  tabCounts: Record<AdminProductTab, number>;
};

const ADMIN_PRODUCT_PAGE_SIZE = 20;

const PRODUCT_STATUS_LABELS: Record<"draft" | "active" | "hidden", string> = {
  draft: "작성중",
  active: "판매중",
  hidden: "숨김",
};

export function productStatusLabel(status: "draft" | "active" | "hidden"): string {
  return PRODUCT_STATUS_LABELS[status];
}

/**
 * 상품 목록. 품절 탭이 있어 재고 집계가 필요하므로 variant를 한 번 훑어 합산한다
 * (product.minPrice 같은 재고 캐시 컬럼은 없다 — 있으면 차감마다 갱신해야 해서 더 위험하다).
 */
export async function listAdminProducts(
  database: DatabaseClient,
  input: {
    tab?: AdminProductTab;
    categoryId?: number;
    keyword?: string;
    sort?: AdminProductSort;
    page?: number;
  } = {},
): Promise<AdminProductListResult> {
  const tab = input.tab ?? "all";
  const sort = input.sort ?? "recent";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  // 재고 합계는 서브쿼리로 — 목록 조인에 붙여 품절 판정과 정렬에 함께 쓴다
  const stockSubquery = database
    .select({
      productId: productVariant.productId,
      totalStock: sql<number>`coalesce(sum(${productVariant.stock}), 0)::int`.as("total_stock"),
      variantCount: sql<number>`count(*)::int`.as("variant_count"),
    })
    .from(productVariant)
    .where(isNull(productVariant.deletedAt))
    .groupBy(productVariant.productId)
    .as("variant_stock");

  const totalStockExpression = sql<number>`coalesce(${stockSubquery.totalStock}, 0)`;

  const tabFilter =
    tab === "all"
      ? undefined
      : tab === "draft"
        ? eq(product.status, "draft")
        : tab === "hidden"
          ? eq(product.status, "hidden")
          : tab === "soldout"
            ? and(eq(product.status, "active"), sql`${totalStockExpression} = 0`)
            : and(eq(product.status, "active"), sql`${totalStockExpression} > 0`);

  const keywordFilter = keyword
    ? or(ilike(product.name, `%${keyword}%`), ilike(product.slug, `%${keyword}%`))
    : undefined;

  const categoryFilter = input.categoryId
    ? sql`exists (select 1 from ${productCategory} pc where pc.product_id = ${product.id} and pc.category_id = ${input.categoryId})`
    : undefined;

  // 삭제된 상품은 목록에 없다 — soft delete는 주문·리뷰 이력 보존용이지 진열용이 아니다
  const listFilter = and(isNull(product.deletedAt), tabFilter, keywordFilter, categoryFilter);

  const orderByClause =
    sort === "sales"
      ? desc(product.salesCount)
      : sort === "priceHigh"
        ? desc(product.minPrice)
        : sort === "lowstock"
          ? asc(totalStockExpression)
          : desc(product.id);

  const [totalRow] = await database
    .select({ total: count() })
    .from(product)
    .leftJoin(stockSubquery, eq(stockSubquery.productId, product.id))
    .where(listFilter);
  const totalCount = totalRow?.total ?? 0;

  const productRows = await database
    .select({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      productStatus: product.status,
      minPrice: product.minPrice,
      salesCount: product.salesCount,
      makerName: maker.name,
      totalStock: totalStockExpression,
      variantCount: sql<number>`coalesce(${stockSubquery.variantCount}, 0)`,
    })
    .from(product)
    .leftJoin(maker, eq(product.makerId, maker.id))
    .leftJoin(stockSubquery, eq(stockSubquery.productId, product.id))
    .where(listFilter)
    .orderBy(orderByClause)
    .limit(ADMIN_PRODUCT_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PRODUCT_PAGE_SIZE);

  const productIds = productRows.map((row) => row.productId);
  const thumbnailRows =
    productIds.length === 0
      ? []
      : await database
          .select({ productId: productImage.productId, path: productImage.path })
          .from(productImage)
          .where(
            and(
              inArray(productImage.productId, productIds),
              eq(productImage.kind, "thumbnail"),
              eq(productImage.isPrimary, true),
            ),
          );

  // 탭 뱃지 — 상태별 + 품절을 한 번의 집계로
  const [tabCountRow] = await database
    .select({
      all: count(),
      draft: sql<number>`count(*) filter (where ${product.status} = 'draft')::int`,
      hidden: sql<number>`count(*) filter (where ${product.status} = 'hidden')::int`,
      active: sql<number>`count(*) filter (where ${product.status} = 'active' and ${totalStockExpression} > 0)::int`,
      soldout: sql<number>`count(*) filter (where ${product.status} = 'active' and ${totalStockExpression} = 0)::int`,
    })
    .from(product)
    .leftJoin(stockSubquery, eq(stockSubquery.productId, product.id))
    .where(isNull(product.deletedAt));

  return {
    cards: productRows.map((row) => ({
      productId: row.productId,
      name: row.name,
      slug: row.slug,
      makerName: row.makerName,
      productStatus: row.productStatus,
      productStatusLabel: productStatusLabel(row.productStatus),
      minPrice: row.minPrice,
      totalStock: Number(row.totalStock),
      // 품절은 색이 아니라 이 값으로 전달된다(KWCAG — 색만으로 상태 전달 금지)
      isSoldOut: row.productStatus === "active" && Number(row.totalStock) === 0,
      variantCount: Number(row.variantCount),
      salesCount: row.salesCount,
      thumbnailPath: thumbnailRows.find((image) => image.productId === row.productId)?.path ?? null,
    })),
    totalCount,
    page,
    pageSize: ADMIN_PRODUCT_PAGE_SIZE,
    tabCounts: {
      all: tabCountRow?.all ?? 0,
      active: Number(tabCountRow?.active ?? 0),
      soldout: Number(tabCountRow?.soldout ?? 0),
      hidden: Number(tabCountRow?.hidden ?? 0),
      draft: Number(tabCountRow?.draft ?? 0),
    },
  };
}

export class AdminProductNotFoundError extends Error {
  constructor(readonly productId: number) {
    super(`상품을 찾을 수 없습니다: id=${productId}`);
    this.name = "AdminProductNotFoundError";
  }
}

export class DuplicateProductSlugError extends Error {
  constructor(readonly slug: string) {
    super("이미 사용 중인 URL 주소입니다. 다른 주소를 입력해 주세요.");
    this.name = "DuplicateProductSlugError";
  }
}

export class DuplicateVariantSkuError extends Error {
  constructor(readonly sku: string) {
    super("이미 사용 중인 SKU가 있습니다. 판매 단위의 SKU를 확인해 주세요.");
    this.name = "DuplicateVariantSkuError";
  }
}

export class ProductVariantRequiredError extends Error {
  constructor() {
    super("판매 단위가 최소 하나 있어야 합니다. 옵션 값을 추가하거나 옵션 사용을 꺼 주세요.");
    this.name = "ProductVariantRequiredError";
  }
}

/**
 * 옵션 라벨 묶음 → 조합 키. 옵션 없는 상품은 빈 문자열 하나가 키가 된다.
 * 구분자는 입력할 수 없는 제어문자(U+001F)다 — 빈 문자열로 이으면
 * ["AB","C"]와 ["A","BC"]가 같은 키가 되어 엉뚱한 판매 단위끼리 매칭된다.
 */
const OPTION_LABEL_SEPARATOR = "";

function toVariantKey(optionLabels: readonly string[]): string {
  return optionLabels.join(OPTION_LABEL_SEPARATOR);
}

export type AdminProductFormOption = { name: string; values: string[] };

export type AdminProductFormVariant = {
  /** 옵션 그룹 순서와 같은 길이. 옵션 미사용이면 빈 배열 */
  optionLabels: string[];
  price: number;
  compareAtPrice: number | null;
  stock: number;
  sku: string | null;
  isActive: boolean;
};

export type AdminProductFormAddon = {
  addonId: number | null;
  name: string;
  price: number;
  isActive: boolean;
};

export type AdminProductFormImage = {
  imageKind: "thumbnail" | "detail";
  path: string;
  alt: string;
};

export type AdminProductFormData = {
  productId: number | null;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  productStatus: "draft" | "active" | "hidden";
  badgeLabel: string | null;
  makerId: number | null;
  categoryIds: number[];
  /**
   * 대표 카테고리 — 브레드크럼·SEO 정규 URL이 이 값을 따른다.
   * 생략하거나 categoryIds에 없는 값이면 첫 번째를 대표로 삼는다(대표 없는 상품을 만들지 않는다).
   */
  primaryCategoryId?: number;
  options: AdminProductFormOption[];
  variants: AdminProductFormVariant[];
  addons: AdminProductFormAddon[];
  images: AdminProductFormImage[];
};

/** 등록·수정 폼 진입 데이터 — 선택지(카테고리·공급처)까지 함께 준다 */
export type AdminProductFormView = {
  form: AdminProductFormData;
  makerOptions: { makerId: number; name: string }[];
  categoryOptions: { categoryId: number; name: string; parentId: number | null }[];
};

async function loadFormChoices(database: DatabaseClient) {
  const makerRows = await database
    .select({ makerId: maker.id, name: maker.name })
    .from(maker)
    .where(eq(maker.isActive, true))
    .orderBy(asc(maker.sortOrder), asc(maker.id));

  const categoryRows = await database
    .select({ categoryId: category.id, name: category.name, parentId: category.parentId })
    .from(category)
    .where(eq(category.isActive, true))
    .orderBy(asc(category.sortOrder), asc(category.id));

  // 평면 순서 그대로 내보내면 화면의 '└' 들여쓰기가 엉뚱한 상위에 붙어 보인다 —
  // 운영자가 '핸드드립 원두'를 쿠키 하위로 오해하고 체크한다. 상위 → 그 자식 순으로 세운다.
  const topLevels = categoryRows.filter((row) => row.parentId === null);
  const categoryOptions = topLevels.flatMap((parentRow) => [
    parentRow,
    ...categoryRows.filter((row) => row.parentId === parentRow.categoryId),
  ]);
  // 상위가 비활성이라 뜨지 못한 자식은 뒤에 붙인다 — 목록에서 통째로 사라지면 선택할 수 없다
  const orphans = categoryRows.filter(
    (row) => row.parentId !== null && !topLevels.some((parent) => parent.categoryId === row.parentId),
  );

  return { makerOptions: makerRows, categoryOptions: [...categoryOptions, ...orphans] };
}

const EMPTY_PRODUCT_FORM: AdminProductFormData = {
  productId: null,
  name: "",
  slug: "",
  summary: null,
  description: null,
  productStatus: "draft",
  badgeLabel: null,
  makerId: null,
  categoryIds: [],
  options: [],
  // 옵션 없는 상품도 판매 단위 1개를 강제한다(RULE-11 — variant만이 판매 단위)
  variants: [{ optionLabels: [], price: 0, compareAtPrice: null, stock: 0, sku: null, isActive: true }],
  addons: [],
  images: [],
};

/** 신규 등록 폼 — 선택지만 채운 빈 양식 */
export async function getNewProductForm(
  database: DatabaseClient,
): Promise<AdminProductFormView> {
  return { form: EMPTY_PRODUCT_FORM, ...(await loadFormChoices(database)) };
}

/** 각 variant가 어떤 옵션 라벨 묶음인지 — 재조정과 폼 조립이 같은 함수를 쓴다 */
async function readVariantLabelMap(
  client: TransactionClient | DatabaseClient,
  productId: number,
): Promise<Map<number, string[]>> {
  const rows = await client
    .select({
      variantId: productVariant.id,
      optionName: productOption.name,
      optionPosition: productOption.position,
      valueLabel: productOptionValue.value,
    })
    .from(productVariant)
    .innerJoin(variantOptionValue, eq(variantOptionValue.variantId, productVariant.id))
    .innerJoin(productOptionValue, eq(variantOptionValue.optionValueId, productOptionValue.id))
    .innerJoin(productOption, eq(productOptionValue.optionId, productOption.id))
    .where(eq(productVariant.productId, productId))
    .orderBy(asc(productVariant.id), asc(productOption.position), asc(productOption.id));

  const labelsByVariant = new Map<number, string[]>();
  for (const row of rows) {
    const existing = labelsByVariant.get(row.variantId) ?? [];
    existing.push(row.valueLabel);
    labelsByVariant.set(row.variantId, existing);
  }
  return labelsByVariant;
}

/** 수정 폼 — 저장했던 그대로 되돌려준다 */
export async function getAdminProductForm(
  database: DatabaseClient,
  productId: number,
): Promise<AdminProductFormView> {
  const [productRow] = await database
    .select()
    .from(product)
    .where(and(eq(product.id, productId), isNull(product.deletedAt)))
    .limit(1);
  if (!productRow) throw new AdminProductNotFoundError(productId);

  const categoryRows = await database
    .select({
      categoryId: productCategory.categoryId,
      isPrimary: productCategory.isPrimary,
    })
    .from(productCategory)
    .where(eq(productCategory.productId, productId));

  const optionRows = await database
    .select({
      optionId: productOption.id,
      name: productOption.name,
      valueLabel: productOptionValue.value,
      valuePosition: productOptionValue.position,
      optionPosition: productOption.position,
    })
    .from(productOption)
    .leftJoin(productOptionValue, eq(productOptionValue.optionId, productOption.id))
    .where(eq(productOption.productId, productId))
    .orderBy(asc(productOption.position), asc(productOption.id), asc(productOptionValue.position));

  const options: AdminProductFormOption[] = [];
  for (const row of optionRows) {
    let optionEntry = options.find((entry) => entry.name === row.name);
    if (!optionEntry) {
      optionEntry = { name: row.name, values: [] };
      options.push(optionEntry);
    }
    if (row.valueLabel) optionEntry.values.push(row.valueLabel);
  }

  const variantRows = await database
    .select({
      variantId: productVariant.id,
      price: productVariant.price,
      compareAtPrice: productVariant.compareAtPrice,
      stock: productVariant.stock,
      sku: productVariant.sku,
      isActive: productVariant.isActive,
    })
    .from(productVariant)
    .where(and(eq(productVariant.productId, productId), isNull(productVariant.deletedAt)))
    .orderBy(asc(productVariant.position), asc(productVariant.id));

  const labelsByVariant = await readVariantLabelMap(database, productId);

  const addonRows = await database
    .select({
      addonId: productAddon.id,
      name: productAddon.name,
      price: productAddon.price,
      isActive: productAddon.isActive,
    })
    .from(productAddon)
    .where(eq(productAddon.productId, productId))
    .orderBy(asc(productAddon.position), asc(productAddon.id));

  const imageRows = await database
    .select({
      imageKind: productImage.kind,
      path: productImage.path,
      alt: productImage.alt,
    })
    .from(productImage)
    .where(eq(productImage.productId, productId))
    .orderBy(asc(productImage.kind), asc(productImage.position), asc(productImage.id));

  return {
    form: {
      productId: productRow.id,
      name: productRow.name,
      slug: productRow.slug,
      summary: productRow.summary,
      description: productRow.description,
      productStatus: productRow.status,
      badgeLabel: productRow.badgeLabel,
      makerId: productRow.makerId,
      categoryIds: categoryRows.map((row) => row.categoryId),
      primaryCategoryId: categoryRows.find((row) => row.isPrimary)?.categoryId,
      options,
      variants: variantRows.map((row) => ({
        optionLabels: labelsByVariant.get(row.variantId) ?? [],
        price: row.price,
        compareAtPrice: row.compareAtPrice,
        stock: row.stock,
        sku: row.sku,
        isActive: row.isActive,
      })),
      addons: addonRows,
      images: imageRows,
    },
    ...(await loadFormChoices(database)),
  };
}

/** 저장 입력 — productId가 없으면 신규 등록 */
export type SaveAdminProductInput = AdminProductFormData & { actor: TransitionActor };

export type SaveAdminProductResult = {
  productId: number;
  slug: string;
  /** 실사 조정으로 재고가 바뀐 판매 단위 수 — 화면이 "N건 재고 조정" 안내에 쓴다 */
  stockAdjustedCount: number;
};

/** 사라진 조합을 내린다 — 하드 삭제하면 이미 팔린 주문의 통계 참조가 끊긴다 */
async function retireVariants(tx: TransactionClient, variantIds: number[]): Promise<void> {
  if (variantIds.length === 0) return;
  await tx
    .update(productVariant)
    .set({ deletedAt: sql`now()`, isActive: false })
    .where(inArray(productVariant.id, variantIds));
}

/** 옵션·값을 통째로 다시 만든다. variant는 라벨로 다시 이어붙이므로 id 안정성이 필요 없다 */
async function rebuildOptions(
  tx: TransactionClient,
  productId: number,
  options: AdminProductFormOption[],
): Promise<Map<string, number>> {
  await tx.delete(productOption).where(eq(productOption.productId, productId));

  // 라벨 → optionValue.id. variant 연결에 쓴다
  const valueIdByLabel = new Map<string, number>();
  for (const [optionIndex, optionEntry] of options.entries()) {
    const [optionRow] = await tx
      .insert(productOption)
      .values({ productId, name: optionEntry.name, position: optionIndex })
      .returning({ id: productOption.id });

    for (const [valueIndex, valueLabel] of optionEntry.values.entries()) {
      const [valueRow] = await tx
        .insert(productOptionValue)
        .values({ optionId: optionRow.id, value: valueLabel, position: valueIndex })
        .returning({ id: productOptionValue.id });
      // 같은 라벨이 다른 그룹에도 있을 수 있어 그룹 index를 키에 넣는다
      valueIdByLabel.set(`${optionIndex}${OPTION_LABEL_SEPARATOR}${valueLabel}`, valueRow.id);
    }
  }
  return valueIdByLabel;
}

/**
 * 상품 저장(등록·수정) — 한 트랜잭션.
 *
 * 순서가 의미를 갖는다: ①상품 → ②카테고리 → ③옵션 재생성 → ④variant 재조정 →
 * ⑤추가상품 → ⑥이미지 → ⑦minPrice 갱신. ④가 ③의 결과(새 optionValue id)를 쓰므로
 * 앞뒤를 바꿀 수 없다.
 */
export async function saveAdminProduct(
  database: DatabaseClient,
  input: SaveAdminProductInput,
): Promise<SaveAdminProductResult> {
  if (input.variants.length === 0) throw new ProductVariantRequiredError();

  const actorText = serializeActor(input.actor);

  return database.transaction(async (tx) => {
    // ── ① 상품 본체
    const productValues = {
      makerId: input.makerId,
      name: input.name,
      slug: input.slug,
      summary: input.summary,
      // 서식 본문은 **저장할 때** 씻는다 — 렌더 시점에 씻으면 새 화면을 만들 때마다 잊을 수 있고,
      // 잊은 화면 하나가 곧 저장형 XSS 구멍이다. 씻은 것만 DB에 들어가면 화면은 신경 쓸 게 없다
      description: sanitizeRichText(input.description),
      status: input.productStatus,
      badgeLabel: input.badgeLabel,
    };

    let productId: number;
    if (input.productId === null) {
      const inserted = await tx
        .insert(product)
        .values({ ...productValues, createdBy: actorText })
        .onConflictDoNothing({ target: product.slug })
        .returning({ id: product.id });
      if (inserted.length === 0) throw new DuplicateProductSlugError(input.slug);
      productId = inserted[0].id;
    } else {
      productId = input.productId;
      const [existing] = await tx
        .select({ id: product.id })
        .from(product)
        .where(and(eq(product.id, productId), isNull(product.deletedAt)))
        .for("update")
        .limit(1);
      if (!existing) throw new AdminProductNotFoundError(productId);

      // 다른 상품이 같은 slug를 쓰고 있으면 UNIQUE 위반이 되므로 먼저 걸러 안내한다
      const [slugOwner] = await tx
        .select({ id: product.id })
        .from(product)
        .where(eq(product.slug, input.slug))
        .limit(1);
      if (slugOwner && slugOwner.id !== productId) throw new DuplicateProductSlugError(input.slug);

      await tx
        .update(product)
        .set({ ...productValues, updatedBy: actorText })
        .where(eq(product.id, productId));
    }

    // ── ② 카테고리 (이력 가치가 없어 교체가 맞다)
    //    대표는 폼이 지정한 것, 없으면 첫 번째. 여러 카테고리에 걸린 상품의 브레드크럼·SEO가
    //    이 값을 따르므로 "지정 안 함"을 허용하면 화면마다 다른 분류가 나온다.
    await tx.delete(productCategory).where(eq(productCategory.productId, productId));
    if (input.categoryIds.length > 0) {
      const primaryCategoryId =
        input.primaryCategoryId !== undefined &&
        input.categoryIds.includes(input.primaryCategoryId)
          ? input.primaryCategoryId
          : input.categoryIds[0];
      await tx.insert(productCategory).values(
        input.categoryIds.map((categoryId) => ({
          productId,
          categoryId,
          isPrimary: categoryId === primaryCategoryId,
        })),
      );
    }

    // ── ③ 기존 조합을 먼저 읽는다 — 옵션을 지우면 라벨을 알 수 없게 된다
    const existingVariants = await tx
      .select({ id: productVariant.id, stock: productVariant.stock })
      .from(productVariant)
      .where(and(eq(productVariant.productId, productId), isNull(productVariant.deletedAt)));
    const existingLabels = await readVariantLabelMap(tx, productId);
    const existingByKey = new Map<string, { id: number; stock: number }>();
    for (const variantRow of existingVariants) {
      existingByKey.set(toVariantKey(existingLabels.get(variantRow.id) ?? []), variantRow);
    }

    const valueIdByLabel = await rebuildOptions(tx, productId, input.options);

    // ── ④ variant 재조정 — 매칭되면 살리고, 새 조합은 만들고, 사라진 조합은 내린다
    const survivingIds = new Set<number>();
    let stockAdjustedCount = 0;

    for (const [variantIndex, formVariant] of input.variants.entries()) {
      const variantKey = toVariantKey(formVariant.optionLabels);
      const matched = existingByKey.get(variantKey);
      const variantValues = {
        price: formVariant.price,
        compareAtPrice: formVariant.compareAtPrice,
        sku: formVariant.sku,
        isActive: formVariant.isActive,
        position: variantIndex,
      };

      let variantId: number;
      if (matched) {
        variantId = matched.id;
        survivingIds.add(variantId);
        await tx
          .update(productVariant)
          .set({ ...variantValues, updatedBy: actorText })
          .where(eq(productVariant.id, variantId));

        // 재고는 별도 축이다 — 바뀐 경우에만 손대고 반드시 원장을 남긴다
        if (matched.stock !== formVariant.stock) {
          await tx
            .update(productVariant)
            .set({ stock: formVariant.stock })
            .where(eq(productVariant.id, variantId));
          await tx.insert(inventoryLog).values({
            variantId,
            delta: formVariant.stock - matched.stock,
            stockAfter: formVariant.stock,
            reason: "manual",
            memo: "관리자 상품 수정에서 재고 조정",
            createdBy: actorText,
          });
          stockAdjustedCount += 1;
        }
      } else {
        const [insertedVariant] = await tx
          .insert(productVariant)
          .values({ ...variantValues, productId, stock: formVariant.stock, createdBy: actorText })
          .returning({ id: productVariant.id });
        variantId = insertedVariant.id;
        survivingIds.add(variantId);

        // 신규 판매 단위의 최초 재고도 원장에 남긴다 — 어디서 온 수량인지 답할 수 있어야 한다
        if (formVariant.stock !== 0) {
          await tx.insert(inventoryLog).values({
            variantId,
            delta: formVariant.stock,
            stockAfter: formVariant.stock,
            reason: "manual",
            memo: "판매 단위 신규 등록",
            createdBy: actorText,
          });
        }
      }

      // 옵션 값 연결 — 옵션을 다시 만들었으므로 살아남은 variant도 다시 이어야 한다
      await tx.delete(variantOptionValue).where(eq(variantOptionValue.variantId, variantId));
      const linkRows = formVariant.optionLabels
        .map((label, optionIndex) =>
          valueIdByLabel.get(`${optionIndex}${OPTION_LABEL_SEPARATOR}${label}`),
        )
        .filter((valueId): valueId is number => valueId !== undefined)
        .map((optionValueId) => ({ variantId, optionValueId }));
      if (linkRows.length > 0) await tx.insert(variantOptionValue).values(linkRows);
    }

    await retireVariants(
      tx,
      existingVariants.map((row) => row.id).filter((id) => !survivingIds.has(id)),
    );

    // ── ⑤ 추가상품 — 주문이 참조하므로 삭제 대신 비활성으로 내린다
    const keptAddonIds = input.addons
      .map((addon) => addon.addonId)
      .filter((addonId): addonId is number => addonId !== null);
    const retireAddonFilter =
      keptAddonIds.length > 0
        ? and(eq(productAddon.productId, productId), notInArray(productAddon.id, keptAddonIds))
        : eq(productAddon.productId, productId);
    await tx.update(productAddon).set({ isActive: false }).where(retireAddonFilter);

    for (const [addonIndex, formAddon] of input.addons.entries()) {
      if (formAddon.addonId === null) {
        await tx.insert(productAddon).values({
          productId,
          name: formAddon.name,
          price: formAddon.price,
          isActive: formAddon.isActive,
          position: addonIndex,
          createdBy: actorText,
        });
      } else {
        await tx
          .update(productAddon)
          .set({
            name: formAddon.name,
            price: formAddon.price,
            isActive: formAddon.isActive,
            position: addonIndex,
            updatedBy: actorText,
            updatedAt: sql`now()`,
          })
          .where(eq(productAddon.id, formAddon.addonId));
      }
    }

    // ── ⑥ 이미지 — 참조하는 곳이 없어 교체가 안전하다(주문은 경로를 스냅샷해 둔다)
    await tx.delete(productImage).where(eq(productImage.productId, productId));
    if (input.images.length > 0) {
      let thumbnailPosition = 0;
      let detailPosition = 0;
      await tx.insert(productImage).values(
        input.images.map((formImage) => {
          const isThumbnail = formImage.imageKind === "thumbnail";
          const position = isThumbnail ? thumbnailPosition++ : detailPosition++;
          return {
            productId,
            kind: formImage.imageKind,
            path: formImage.path,
            alt: formImage.alt,
            // 갤러리 첫 장이 대표 — 목업의 '대표' 뱃지와 같은 규칙
            isPrimary: isThumbnail && position === 0,
            position,
            createdBy: actorText,
          };
        }),
      );
    }

    // 이 상품이 쓰는 파일을 확정한다. 폼에서 뺀 이미지는 여기서 삭제 예약되고,
    // 정리 배치가 유예 기간 뒤에 실제로 지운다 — 안 하면 디스크에만 남아 고아가 된다.
    // 같은 트랜잭션이라 저장이 실패하면 소유 정보도 함께 되돌아간다
    await claimFiles(tx, {
      ownerType: "product",
      ownerId: productId,
      keepPaths: input.images.map((formImage) => formImage.path),
    });

    // ── ⑦ 표시가 캐시 — 판매 중인 판매 단위의 최저가. 목록·정렬이 이 값을 읽는다
    const [priceRow] = await tx
      .select({ minPrice: sql<number>`coalesce(min(${productVariant.price}), 0)::int` })
      .from(productVariant)
      .where(
        and(
          eq(productVariant.productId, productId),
          isNull(productVariant.deletedAt),
          eq(productVariant.isActive, true),
        ),
      );
    await tx
      .update(product)
      .set({ minPrice: priceRow?.minPrice ?? 0 })
      .where(eq(product.id, productId));

    return { productId, slug: input.slug, stockAdjustedCount };
  });
}

/** 목록에서의 상태 일괄 변경 — 진열/숨김 전환은 상품 단위 스위치일 뿐이다 */
export async function changeAdminProductStatus(
  database: DatabaseClient,
  input: {
    productIds: number[];
    productStatus: "draft" | "active" | "hidden";
    actor: TransitionActor;
  },
): Promise<{ changedCount: number }> {
  if (input.productIds.length === 0) return { changedCount: 0 };
  const updated = await database
    .update(product)
    .set({
      status: input.productStatus,
      updatedBy: serializeActor(input.actor),
      updatedAt: sql`now()`,
    })
    .where(and(inArray(product.id, input.productIds), isNull(product.deletedAt)))
    .returning({ id: product.id });
  return { changedCount: updated.length };
}

/**
 * 상품 삭제 — soft delete. 주문·리뷰가 참조하므로 행을 지우지 않는다.
 * 판매 단위도 함께 내려 장바구니·주문 경로에서 잡히지 않게 한다.
 */
export async function deleteAdminProducts(
  database: DatabaseClient,
  input: { productIds: number[]; actor: TransitionActor },
): Promise<{ deletedCount: number }> {
  if (input.productIds.length === 0) return { deletedCount: 0 };
  return database.transaction(async (tx) => {
    const deleted = await tx
      .update(product)
      .set({
        deletedAt: sql`now()`,
        status: "hidden",
        updatedBy: serializeActor(input.actor),
        updatedAt: sql`now()`,
      })
      .where(and(inArray(product.id, input.productIds), isNull(product.deletedAt)))
      .returning({ id: product.id });

    if (deleted.length > 0) {
      await tx
        .update(productVariant)
        .set({ deletedAt: sql`now()`, isActive: false })
        .where(
          and(
            inArray(
              productVariant.productId,
              deleted.map((row) => row.id),
            ),
            isNull(productVariant.deletedAt),
          ),
        );

      // 상품이 내려가면 그 이미지도 쓸 곳이 없다 — 삭제 예약해 두면 배치가 유예 뒤 지운다.
      // 소프트 삭제라 되살릴 수 있으니 파일을 바로 지우지 않는다(유예 안에 되살리면 예약이 풀린다)
      for (const deletedProduct of deleted) {
        await releaseOwnerFiles(tx, { ownerType: "product", ownerId: deletedProduct.id });
      }
    }
    return { deletedCount: deleted.length };
  });
}
