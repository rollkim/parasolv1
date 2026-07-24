import "server-only";

import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";

import type { db as Database } from "@/db";
import {
  category,
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
import { ratingAverage } from "@/domain/product";

/**
 * 상품 조회 도메인 모듈 — 목록 카드·상세를 공급한다.
 * 스토어프론트 페이지(서버 컴포넌트)와 tRPC 라우터가 공유한다.
 */

// =============================================================
// 목록 카드
// =============================================================

export type ProductCard = {
  productId: number;
  slug: string;
  name: string;
  makerName: string | null;
  badgeLabel: string | null;
  sellingPrice: number;
  compareAtPrice: number | null;
  /** 품절 = 활성 variant 재고 합이 0 — 상태가 아니라 파생값(정합성 검토 B-2) */
  soldOut: boolean;
  thumbnailPath: string | null;
  thumbnailAlt: string | null;
  reviewCount: number;
  ratingAverage: number | null;
};

export type ProductSort = "latest" | "price_low" | "price_high" | "popular";

export type ProductListPage = {
  cards: ProductCard[];
  totalCount: number;
  page: number;
  pageSize: number;
};

const PRODUCT_LIST_DEFAULT_PAGE_SIZE = 12;

/** 노출 가능한 상품 공통 조건 — active + 미삭제 */
const visibleProduct = and(
  eq(product.status, "active"),
  isNull(product.deletedAt),
);

function sortClause(sort: ProductSort) {
  switch (sort) {
    case "price_low":
      return [asc(product.minPrice), desc(product.id)];
    case "price_high":
      return [desc(product.minPrice), desc(product.id)];
    case "popular":
      return [desc(product.salesCount), desc(product.id)];
    case "latest":
      return [desc(product.id)];
  }
}

/** 카테고리 slug(대분류면 하위 포함)에 속한 category id 목록 */
async function resolveCategoryIds(
  database: typeof Database,
  categorySlug: string,
): Promise<number[]> {
  const matched = await database
    .select({ id: category.id })
    .from(category)
    .where(eq(category.slug, categorySlug))
    .limit(1);
  if (matched.length === 0) return [];

  const children = await database
    .select({ id: category.id })
    .from(category)
    .where(eq(category.parentId, matched[0].id));

  return [matched[0].id, ...children.map((row) => row.id)];
}

/**
 * 카드 부속(대표 이미지·최저가 variant·재고 합)을 상품 id 묶음으로 일괄 로드한다.
 * 상품당 쿼리를 날리면 목록 한 페이지에 수십 회가 되므로 배치가 기본.
 */
async function loadCardParts(database: typeof Database, productIds: number[]) {
  if (productIds.length === 0) {
    return { variantByProduct: new Map(), thumbnailByProduct: new Map() };
  }

  const variantRows = await database
    .select({
      productId: productVariant.productId,
      price: productVariant.price,
      compareAtPrice: productVariant.compareAtPrice,
      stock: productVariant.stock,
    })
    .from(productVariant)
    .where(
      and(
        inArray(productVariant.productId, productIds),
        eq(productVariant.isActive, true),
        isNull(productVariant.deletedAt),
      ),
    );

  const variantByProduct = new Map<
    number,
    { minPrice: number; compareAtPrice: number | null; totalStock: number }
  >();
  for (const row of variantRows) {
    const acc = variantByProduct.get(row.productId);
    if (!acc) {
      variantByProduct.set(row.productId, {
        minPrice: row.price,
        compareAtPrice: row.compareAtPrice,
        totalStock: row.stock,
      });
    } else {
      acc.totalStock += row.stock;
      if (row.price < acc.minPrice) {
        acc.minPrice = row.price;
        acc.compareAtPrice = row.compareAtPrice;
      }
    }
  }

  const thumbnailRows = await database
    .select({
      productId: productImage.productId,
      path: productImage.path,
      alt: productImage.alt,
      isPrimary: productImage.isPrimary,
      position: productImage.position,
    })
    .from(productImage)
    .where(
      and(
        inArray(productImage.productId, productIds),
        eq(productImage.kind, "thumbnail"),
      ),
    )
    .orderBy(desc(productImage.isPrimary), asc(productImage.position));

  const thumbnailByProduct = new Map<number, { path: string; alt: string }>();
  for (const row of thumbnailRows) {
    if (!thumbnailByProduct.has(row.productId)) {
      thumbnailByProduct.set(row.productId, { path: row.path, alt: row.alt });
    }
  }

  return { variantByProduct, thumbnailByProduct };
}

type ProductRowForCard = {
  productId: number;
  slug: string;
  name: string;
  badgeLabel: string | null;
  minPrice: number;
  reviewCount: number;
  ratingSum: number;
  makerName: string | null;
};

async function toCards(
  database: typeof Database,
  rows: ProductRowForCard[],
): Promise<ProductCard[]> {
  const { variantByProduct, thumbnailByProduct } = await loadCardParts(
    database,
    rows.map((row) => row.productId),
  );

  return rows.map((row) => {
    const variantAgg = variantByProduct.get(row.productId);
    const thumbnail = thumbnailByProduct.get(row.productId);

    return {
      productId: row.productId,
      slug: row.slug,
      name: row.name,
      makerName: row.makerName,
      badgeLabel: row.badgeLabel,
      sellingPrice: variantAgg?.minPrice ?? row.minPrice,
      compareAtPrice: variantAgg?.compareAtPrice ?? null,
      soldOut: (variantAgg?.totalStock ?? 0) <= 0,
      thumbnailPath: thumbnail?.path ?? null,
      thumbnailAlt: thumbnail?.alt ?? null,
      reviewCount: row.reviewCount,
      ratingAverage: ratingAverage(row.ratingSum, row.reviewCount),
    };
  });
}

const productCardSelection = {
  productId: product.id,
  slug: product.slug,
  name: product.name,
  badgeLabel: product.badgeLabel,
  minPrice: product.minPrice,
  reviewCount: product.reviewCount,
  ratingSum: product.ratingSum,
  makerName: maker.name,
};

export async function getProductListPage(
  database: typeof Database,
  options: {
    categorySlug?: string;
    sort?: ProductSort;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ProductListPage> {
  const sort = options.sort ?? "latest";
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? PRODUCT_LIST_DEFAULT_PAGE_SIZE;

  let categoryFilter = undefined;
  if (options.categorySlug) {
    const categoryIds = await resolveCategoryIds(database, options.categorySlug);
    if (categoryIds.length === 0) {
      return { cards: [], totalCount: 0, page, pageSize };
    }
    categoryFilter = inArray(productCategory.categoryId, categoryIds);
  }

  const baseFrom = (selection: Parameters<typeof database.selectDistinct>[0]) =>
    categoryFilter
      ? database
          .selectDistinct(selection as typeof productCardSelection)
          .from(product)
          .leftJoin(maker, eq(product.makerId, maker.id))
          .innerJoin(productCategory, eq(productCategory.productId, product.id))
          .where(and(visibleProduct, categoryFilter))
      : database
          .select(selection as typeof productCardSelection)
          .from(product)
          .leftJoin(maker, eq(product.makerId, maker.id))
          .where(visibleProduct);

  const [countRow] = categoryFilter
    ? await database
        .select({ totalCount: count() })
        .from(product)
        .innerJoin(productCategory, eq(productCategory.productId, product.id))
        .where(and(visibleProduct, categoryFilter))
    : await database.select({ totalCount: count() }).from(product).where(visibleProduct);

  const rows = await baseFrom(productCardSelection)
    .orderBy(...sortClause(sort))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    cards: await toCards(database, rows),
    totalCount: countRow.totalCount,
    page,
    pageSize,
  };
}

/** 진열 섹션(수동 큐레이션)용 — id 묶음을 카드로. 진열 순서를 유지한다 */
export async function getProductCardsByIds(
  database: typeof Database,
  productIds: number[],
): Promise<ProductCard[]> {
  if (productIds.length === 0) return [];

  const rows = await database
    .select(productCardSelection)
    .from(product)
    .leftJoin(maker, eq(product.makerId, maker.id))
    .where(and(visibleProduct, inArray(product.id, productIds)));

  const cards = await toCards(database, rows);
  const orderIndex = new Map(productIds.map((id, index) => [id, index]));
  return cards.sort(
    (a, b) => (orderIndex.get(a.productId) ?? 0) - (orderIndex.get(b.productId) ?? 0),
  );
}

/** 자동 진열(신상품/베스트)용 상위 N개 카드 */
export async function getAutoSectionCards(
  database: typeof Database,
  sectionKind: "new" | "best",
  limitCount: number,
): Promise<ProductCard[]> {
  const rows = await database
    .select(productCardSelection)
    .from(product)
    .leftJoin(maker, eq(product.makerId, maker.id))
    .where(visibleProduct)
    .orderBy(...(sectionKind === "new" ? [desc(product.id)] : [desc(product.salesCount), desc(product.id)]))
    .limit(limitCount);

  return toCards(database, rows);
}

// =============================================================
// 상세
// =============================================================

export type ProductDetail = {
  productId: number;
  slug: string;
  name: string;
  summary: string | null;
  descriptionHtml: string | null;
  badgeLabel: string | null;
  makerName: string | null;
  makerSlug: string | null;
  reviewCount: number;
  ratingAverage: number | null;
  thumbnails: { path: string; alt: string }[];
  detailImages: { path: string; alt: string }[];
  options: {
    optionId: number;
    optionName: string;
    values: { optionValueId: number; valueLabel: string }[];
  }[];
  variants: {
    variantId: number;
    price: number;
    compareAtPrice: number | null;
    stock: number;
    optionValueIds: number[];
  }[];
  addons: { addonId: number; addonName: string; price: number; stock: number }[];
};

export async function getProductDetail(
  database: typeof Database,
  productSlug: string,
): Promise<ProductDetail | null> {
  const [productRow] = await database
    .select({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      summary: product.summary,
      descriptionHtml: product.description,
      badgeLabel: product.badgeLabel,
      reviewCount: product.reviewCount,
      ratingSum: product.ratingSum,
      makerName: maker.name,
      makerSlug: maker.slug,
    })
    .from(product)
    .leftJoin(maker, eq(product.makerId, maker.id))
    .where(and(visibleProduct, eq(product.slug, productSlug)))
    .limit(1);

  if (!productRow) return null;

  const [imageRows, optionRows, valueRows, variantRows, linkRows, addonRows] =
    await Promise.all([
      database
        .select({
          kind: productImage.kind,
          path: productImage.path,
          alt: productImage.alt,
        })
        .from(productImage)
        .where(eq(productImage.productId, productRow.productId))
        .orderBy(desc(productImage.isPrimary), asc(productImage.position)),
      database
        .select({
          optionId: productOption.id,
          optionName: productOption.name,
        })
        .from(productOption)
        .where(eq(productOption.productId, productRow.productId))
        .orderBy(asc(productOption.position)),
      database
        .select({
          optionValueId: productOptionValue.id,
          optionId: productOptionValue.optionId,
          valueLabel: productOptionValue.value,
        })
        .from(productOptionValue)
        .innerJoin(productOption, eq(productOptionValue.optionId, productOption.id))
        .where(eq(productOption.productId, productRow.productId))
        .orderBy(asc(productOptionValue.position)),
      database
        .select({
          variantId: productVariant.id,
          price: productVariant.price,
          compareAtPrice: productVariant.compareAtPrice,
          stock: productVariant.stock,
        })
        .from(productVariant)
        .where(
          and(
            eq(productVariant.productId, productRow.productId),
            eq(productVariant.isActive, true),
            isNull(productVariant.deletedAt),
          ),
        )
        .orderBy(asc(productVariant.position)),
      database
        .select({
          variantId: variantOptionValue.variantId,
          optionValueId: variantOptionValue.optionValueId,
        })
        .from(variantOptionValue)
        .innerJoin(
          productVariant,
          eq(variantOptionValue.variantId, productVariant.id),
        )
        .where(eq(productVariant.productId, productRow.productId)),
      database
        .select({
          addonId: productAddon.id,
          addonName: productAddon.name,
          price: productAddon.price,
          stock: productAddon.stock,
        })
        .from(productAddon)
        .where(
          and(
            eq(productAddon.productId, productRow.productId),
            eq(productAddon.isActive, true),
          ),
        )
        .orderBy(asc(productAddon.position)),
    ]);

  const valueIdsByVariant = new Map<number, number[]>();
  for (const link of linkRows) {
    const list = valueIdsByVariant.get(link.variantId) ?? [];
    list.push(link.optionValueId);
    valueIdsByVariant.set(link.variantId, list);
  }

  return {
    productId: productRow.productId,
    slug: productRow.slug,
    name: productRow.name,
    summary: productRow.summary,
    descriptionHtml: productRow.descriptionHtml,
    badgeLabel: productRow.badgeLabel,
    makerName: productRow.makerName,
    makerSlug: productRow.makerSlug,
    reviewCount: productRow.reviewCount,
    ratingAverage: ratingAverage(productRow.ratingSum, productRow.reviewCount),
    thumbnails: imageRows
      .filter((row) => row.kind === "thumbnail")
      .map((row) => ({ path: row.path, alt: row.alt })),
    detailImages: imageRows
      .filter((row) => row.kind === "detail")
      .map((row) => ({ path: row.path, alt: row.alt })),
    options: optionRows.map((optionRow) => ({
      optionId: optionRow.optionId,
      optionName: optionRow.optionName,
      values: valueRows
        .filter((valueRow) => valueRow.optionId === optionRow.optionId)
        .map((valueRow) => ({
          optionValueId: valueRow.optionValueId,
          valueLabel: valueRow.valueLabel,
        })),
    })),
    variants: variantRows.map((variantRow) => ({
      ...variantRow,
      optionValueIds: valueIdsByVariant.get(variantRow.variantId) ?? [],
    })),
    addons: addonRows,
  };
}
