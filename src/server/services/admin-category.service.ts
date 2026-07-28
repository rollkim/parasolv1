import "server-only";

import { and, asc, count, eq, isNull, sql } from "drizzle-orm";

import { category, product, productCategory } from "@/db/schema";

import type { DatabaseClient, TransactionClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 관리자 카테고리 관리 — 2단계 트리(대분류 · 중분류).
 *
 * **깊이를 2로 강제한다.** 목업이 대분류/중분류 두 단계고, 스토어프론트 필터
 * (product.service의 resolveCategoryIds)가 "자기 + 직계 자식"까지만 펼친다.
 * 3단계를 허용하면 손자 카테고리의 상품이 조부모 목록에서 통째로 사라진다 —
 * 관리자는 등록했는데 스토어에는 안 보이는, 가장 찾기 어려운 종류의 버그다.
 */

/** 트리 깊이 상한. 늘리려면 resolveCategoryIds의 재귀 전개를 먼저 고쳐야 한다 */
export const MAX_CATEGORY_DEPTH = 2;

export type AdminCategoryNode = {
  categoryId: number;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  /** 이 카테고리에 직접 연결된 상품 수(삭제된 상품 제외) */
  productCount: number;
  children: AdminCategoryNode[];
};

/** 트리 전체 — 카테고리는 많아야 수십 개라 한 번에 읽어 화면에서 접고 편다 */
export async function listAdminCategoryTree(
  database: DatabaseClient,
): Promise<AdminCategoryNode[]> {
  const categoryRows = await database
    .select({
      categoryId: category.id,
      parentId: category.parentId,
      name: category.name,
      slug: category.slug,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    })
    .from(category)
    .orderBy(asc(category.sortOrder), asc(category.id));

  // 상품 수는 한 번의 group by로 — 노드마다 세면 카테고리 수만큼 쿼리가 나간다
  const countRows = await database
    .select({ categoryId: productCategory.categoryId, total: count() })
    .from(productCategory)
    .innerJoin(product, eq(productCategory.productId, product.id))
    .where(isNull(product.deletedAt))
    .groupBy(productCategory.categoryId);
  const countByCategory = new Map(countRows.map((row) => [row.categoryId, row.total]));

  const toNode = (row: (typeof categoryRows)[number]): AdminCategoryNode => ({
    categoryId: row.categoryId,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount: countByCategory.get(row.categoryId) ?? 0,
    children: [],
  });

  return categoryRows
    .filter((row) => row.parentId === null)
    .map((parentRow) => ({
      ...toNode(parentRow),
      children: categoryRows
        .filter((row) => row.parentId === parentRow.categoryId)
        .map(toNode),
    }));
}

export class AdminCategoryNotFoundError extends Error {
  constructor(readonly categoryId: number) {
    super(`카테고리를 찾을 수 없습니다: id=${categoryId}`);
    this.name = "AdminCategoryNotFoundError";
  }
}

export class DuplicateCategorySlugError extends Error {
  constructor(readonly slug: string) {
    super("이미 사용 중인 URL 주소입니다. 다른 주소를 입력해 주세요.");
    this.name = "DuplicateCategorySlugError";
  }
}

export class CategoryDepthExceededError extends Error {
  constructor() {
    super("카테고리는 2단계(대분류 · 중분류)까지만 만들 수 있습니다.");
    this.name = "CategoryDepthExceededError";
  }
}

export class CategoryHasChildrenError extends Error {
  constructor(readonly childCount: number) {
    super("하위 카테고리가 있어 삭제할 수 없습니다. 하위를 먼저 정리해 주세요.");
    this.name = "CategoryHasChildrenError";
  }
}

/** slug 중복을 미리 걸러 안내한다 — UNIQUE 위반은 화면에 보여줄 수 없는 문구가 된다 */
async function assertSlugAvailable(
  client: TransactionClient | DatabaseClient,
  slug: string,
  exceptCategoryId: number | null,
): Promise<void> {
  const [owner] = await client
    .select({ id: category.id })
    .from(category)
    .where(eq(category.slug, slug))
    .limit(1);
  if (owner && owner.id !== exceptCategoryId) throw new DuplicateCategorySlugError(slug);
}

/**
 * 카테고리 추가. parentId가 있으면 **그 부모가 최상위여야** 한다 —
 * 중분류 밑에 또 만들면 3단계가 되어 스토어 목록에서 상품이 사라진다.
 */
export async function createAdminCategory(
  database: DatabaseClient,
  input: { parentId: number | null; name: string; slug: string; actor: TransitionActor },
): Promise<{ categoryId: number }> {
  return database.transaction(async (tx) => {
    if (input.parentId !== null) {
      const [parentRow] = await tx
        .select({ id: category.id, parentId: category.parentId })
        .from(category)
        .where(eq(category.id, input.parentId))
        .limit(1);
      if (!parentRow) throw new AdminCategoryNotFoundError(input.parentId);
      if (parentRow.parentId !== null) throw new CategoryDepthExceededError();
    }

    await assertSlugAvailable(tx, input.slug, null);

    // 형제 맨 뒤에 붙인다 — 새 항목이 목록 중간에 끼어들면 어디 생겼는지 못 찾는다
    const [lastRow] = await tx
      .select({ maxSortOrder: sql<number>`coalesce(max(${category.sortOrder}), -1)::int` })
      .from(category)
      .where(
        input.parentId === null
          ? isNull(category.parentId)
          : eq(category.parentId, input.parentId),
      );

    const [inserted] = await tx
      .insert(category)
      .values({
        parentId: input.parentId,
        name: input.name,
        slug: input.slug,
        sortOrder: (lastRow?.maxSortOrder ?? -1) + 1,
        createdBy: serializeActor(input.actor),
      })
      .returning({ id: category.id });

    return { categoryId: inserted.id };
  });
}

/** 이름·URL·노출 수정. 부모는 여기서 바꾸지 않는다(계층 이동은 별도 행위) */
export async function updateAdminCategory(
  database: DatabaseClient,
  input: {
    categoryId: number;
    name: string;
    slug: string;
    isActive: boolean;
    actor: TransitionActor;
  },
): Promise<{ categoryId: number }> {
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: category.id })
      .from(category)
      .where(eq(category.id, input.categoryId))
      .limit(1);
    if (!existing) throw new AdminCategoryNotFoundError(input.categoryId);

    await assertSlugAvailable(tx, input.slug, input.categoryId);

    await tx
      .update(category)
      .set({
        name: input.name,
        slug: input.slug,
        isActive: input.isActive,
        updatedBy: serializeActor(input.actor),
      })
      .where(eq(category.id, input.categoryId));

    return { categoryId: input.categoryId };
  });
}

/**
 * 형제 안에서 한 칸 이동.
 *
 * 드래그 대신 버튼을 쓴다 — 드래그는 키보드만으로 조작할 수 없어 KWCAG를 지킬 수 없다.
 * 시드 데이터는 sortOrder가 전부 같을 수 있으므로, 교환 전에 형제를 0..n-1로 다시 매긴다
 * (같은 값끼리 교환하면 아무 일도 일어나지 않는다).
 */
export async function moveAdminCategoryOrder(
  database: DatabaseClient,
  input: { categoryId: number; direction: "up" | "down"; actor: TransitionActor },
): Promise<{ moved: boolean }> {
  return database.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: category.id, parentId: category.parentId })
      .from(category)
      .where(eq(category.id, input.categoryId))
      .limit(1);
    if (!target) throw new AdminCategoryNotFoundError(input.categoryId);

    const siblings = await tx
      .select({ id: category.id })
      .from(category)
      .where(
        target.parentId === null
          ? isNull(category.parentId)
          : eq(category.parentId, target.parentId),
      )
      .orderBy(asc(category.sortOrder), asc(category.id));

    const currentIndex = siblings.findIndex((row) => row.id === input.categoryId);
    const swapIndex = input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= siblings.length) return { moved: false };

    const reordered = [...siblings];
    [reordered[currentIndex], reordered[swapIndex]] = [
      reordered[swapIndex],
      reordered[currentIndex],
    ];

    const actorText = serializeActor(input.actor);
    for (const [index, sibling] of reordered.entries()) {
      await tx
        .update(category)
        .set({ sortOrder: index, updatedBy: actorText })
        .where(eq(category.id, sibling.id));
    }

    return { moved: true };
  });
}

/**
 * 삭제 — 하위가 있으면 막는다. 연결된 상품은 지우지 않고 **연결만 끊는다**(미분류로).
 *
 * 카테고리 행을 지우면 product_category가 cascade로 함께 사라지므로 상품은 안전하지만,
 * 몇 개가 미분류가 되는지 화면이 미리 알려주지 못하면 되돌릴 수 없는 실수가 된다.
 */
export async function deleteAdminCategory(
  database: DatabaseClient,
  input: { categoryId: number },
): Promise<{ categoryId: number; detachedProductCount: number }> {
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: category.id })
      .from(category)
      .where(eq(category.id, input.categoryId))
      .limit(1);
    if (!existing) throw new AdminCategoryNotFoundError(input.categoryId);

    const [childRow] = await tx
      .select({ total: count() })
      .from(category)
      .where(eq(category.parentId, input.categoryId));
    if ((childRow?.total ?? 0) > 0) throw new CategoryHasChildrenError(childRow.total);

    const detached = await tx
      .delete(productCategory)
      .where(eq(productCategory.categoryId, input.categoryId))
      .returning({ productId: productCategory.productId });

    await tx.delete(category).where(eq(category.id, input.categoryId));

    return { categoryId: input.categoryId, detachedProductCount: detached.length };
  });
}

/** 삭제 확인 모달이 "상품 N개가 미분류로 갑니다"를 미리 보여주기 위한 조회 */
export async function getAdminCategoryDeletePreview(
  database: DatabaseClient,
  categoryId: number,
): Promise<{ childCount: number; productCount: number }> {
  const [childRow] = await database
    .select({ total: count() })
    .from(category)
    .where(eq(category.parentId, categoryId));

  const [productRow] = await database
    .select({ total: count() })
    .from(productCategory)
    .innerJoin(product, eq(productCategory.productId, product.id))
    .where(and(eq(productCategory.categoryId, categoryId), isNull(product.deletedAt)));

  return { childCount: childRow?.total ?? 0, productCount: productRow?.total ?? 0 };
}
