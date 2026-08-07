import "server-only";

import { and, asc, count, desc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";

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
  /**
   * 옵션이 하나뿐이라 **카드에서 바로 담을 수 있는** variant. 여러 개면 null이다.
   * null이면 카드의 담기 버튼이 상세로 보낸다 — 옵션을 고르지 않고 담으면
   * 고객이 원하지 않은 옵션이 장바구니에 들어간다.
   */
  singleVariantId: number | null;
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
      variantId: productVariant.id,
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
    {
      minPrice: number;
      compareAtPrice: number | null;
      totalStock: number;
      /** 첫 variant. variantCount가 1일 때만 카드가 쓴다 */
      firstVariantId: number;
      variantCount: number;
    }
  >();
  for (const row of variantRows) {
    const acc = variantByProduct.get(row.productId);
    if (!acc) {
      variantByProduct.set(row.productId, {
        minPrice: row.price,
        compareAtPrice: row.compareAtPrice,
        totalStock: row.stock,
        firstVariantId: row.variantId,
        variantCount: 1,
      });
    } else {
      acc.totalStock += row.stock;
      acc.variantCount += 1;
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
      // 옵션이 여러 개면 카드에서 담지 않는다 — 고르지 않은 옵션이 담기면 되돌리는 건 고객 몫이 된다
      singleVariantId:
        variantAgg && variantAgg.variantCount === 1 ? variantAgg.firstVariantId : null,
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
    /** 검색어 — 상품명·요약 부분일치. 통합검색(/search)이 넘긴다 */
    keyword?: string;
    sort?: ProductSort;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<ProductListPage> {
  const sort = options.sort ?? "latest";
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize ?? PRODUCT_LIST_DEFAULT_PAGE_SIZE;

  /* 검색어는 상품명과 요약만 본다. 상세 설명(HTML)은 제외한다 —
     태그 문자열까지 걸려 "div" 한 단어로 전 상품이 나오는 일이 생긴다 */
  const keyword = options.keyword?.trim() ?? "";
  const keywordFilter =
    keyword.length > 0
      ? or(ilike(product.name, "%" + keyword + "%"), ilike(product.summary, "%" + keyword + "%"))
      : undefined;
  /** 목록 조건 = 노출 조건 + 검색어. 목록과 개수 쿼리가 같은 조건을 봐야 페이지 수가 맞는다 */
  const listedProduct = keywordFilter ? and(visibleProduct, keywordFilter) : visibleProduct;

  let categoryFilter = undefined;
  if (options.categorySlug) {
    const categoryIds = await resolveCategoryIds(database, options.categorySlug);
    if (categoryIds.length === 0) {
      return { cards: [], totalCount: 0, page, pageSize };
    }
    // 조인이 아니라 EXISTS로 거른다. 상품은 대분류·중분류 양쪽에 매핑될 수 있어
    // product_category를 조인하면 같은 상품이 여러 행으로 늘어나는데,
    // 그걸 selectDistinct로 덮으면 두 가지가 깨진다:
    //  ① 개수 쿼리에는 DISTINCT가 없어 총 개수가 부풀고,
    //  ② SELECT DISTINCT는 ORDER BY 식이 select 목록에 있어야 해서
    //     카드에 싣지 않는 sales_count로 정렬하는 인기순이 SQL 오류가 된다.
    // EXISTS는 행을 늘리지 않으므로 목록·개수가 같은 조건 하나를 그대로 쓴다.
    categoryFilter = exists(
      database
        .select({ matched: sql`1` })
        .from(productCategory)
        .where(
          and(
            eq(productCategory.productId, product.id),
            inArray(productCategory.categoryId, categoryIds),
          ),
        ),
    );
  }

  /** 목록·개수가 반드시 같은 조건을 봐야 페이지 수가 맞는다 */
  const listFilter = categoryFilter
    ? and(listedProduct, categoryFilter)
    : listedProduct;

  const [countRow] = await database
    .select({ totalCount: count() })
    .from(product)
    .where(listFilter);

  const rows = await database
    .select(productCardSelection)
    .from(product)
    .leftJoin(maker, eq(product.makerId, maker.id))
    .where(listFilter)
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
  /**
   * 브레드크럼용 카테고리 경로 — 대분류 → 중분류 순. 카테고리가 없으면 빈 배열.
   * 상품이 여러 카테고리에 속할 수 있어(product_category는 다대다) 대표 하나를 골라 그 조상을 편다.
   */
  categoryPath: { slug: string; name: string }[];
  summary: string | null;
  descriptionText: string | null;
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

/**
 * 브레드크럼에 쓸 카테고리 경로 — 대분류 → 중분류.
 *
 * product_category는 다대다라 상품 하나가 여러 카테고리에 걸릴 수 있다. 어느 것을 보여줄지는
 * **운영자가 정한 대표(is_primary)**를 따른다 — 선물세트에도 대추칩에도 걸린 상품의 소속은
 * 규칙으로 유추할 문제가 아니다.
 *
 * 대표가 지정되지 않은 옛 데이터를 위한 차선: 가장 깊은 카테고리 → sortOrder → id.
 * 매 요청 같은 답이 나오도록 정렬을 못 박는다(새로고침마다 브레드크럼이 바뀌면 안 된다).
 */
async function loadCategoryPath(
  database: typeof Database,
  productId: number,
): Promise<{ slug: string; name: string }[]> {
  const linked = await database
    .select({
      categoryId: category.id,
      slug: category.slug,
      name: category.name,
      parentId: category.parentId,
      isPrimary: productCategory.isPrimary,
    })
    .from(productCategory)
    .innerJoin(category, eq(productCategory.categoryId, category.id))
    .where(and(eq(productCategory.productId, productId), eq(category.isActive, true)))
    .orderBy(asc(category.sortOrder), asc(category.id));

  if (linked.length === 0) return [];

  // 운영자 지정이 최우선, 없으면 하위(parentId 있음), 그것도 없으면 최상위
  const chosen =
    linked.find((row) => row.isPrimary) ??
    linked.find((row) => row.parentId !== null) ??
    linked[0];
  if (chosen.parentId === null) return [{ slug: chosen.slug, name: chosen.name }];

  const [parentRow] = await database
    .select({ slug: category.slug, name: category.name })
    .from(category)
    .where(and(eq(category.id, chosen.parentId), eq(category.isActive, true)))
    .limit(1);

  // 부모가 비활성이면 자식만 — 비활성 카테고리로 가는 링크를 만들지 않는다
  return parentRow
    ? [parentRow, { slug: chosen.slug, name: chosen.name }]
    : [{ slug: chosen.slug, name: chosen.name }];
}

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
      descriptionText: product.description,
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

  const categoryPath = await loadCategoryPath(database, productRow.productId);

  return {
    productId: productRow.productId,
    slug: productRow.slug,
    name: productRow.name,
    categoryPath,
    summary: productRow.summary,
    descriptionText: productRow.descriptionText,
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
