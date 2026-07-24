import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import type { db as Database } from "@/db";
import { category } from "@/db/schema";

/**
 * 카테고리 도메인 모듈.
 * 스토어 헤더 내비·상품 목록 필터·관리자 카테고리 화면이 공유한다.
 */

export type StoreNavCategory = {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
};

/**
 * 스토어 헤더 내비용 2단 카테고리(루트 + 1depth 자식).
 * 노출 순서는 sortOrder → name. 비활성(is_active=false)은 제외한다.
 */
export async function getStoreNavCategories(
  database: typeof Database,
): Promise<StoreNavCategory[]> {
  const rows = await database
    .select({
      id: category.id,
      parentId: category.parentId,
      slug: category.slug,
      name: category.name,
    })
    .from(category)
    .where(eq(category.isActive, true))
    .orderBy(asc(category.sortOrder), asc(category.name));

  const roots = rows.filter((row) => row.parentId === null);

  return roots.map((root) => ({
    slug: root.slug,
    name: root.name,
    children: rows
      .filter((row) => row.parentId === root.id)
      .map((child) => ({ slug: child.slug, name: child.name })),
  }));
}

/** 루트 카테고리만 필요할 때 (관리자 필터 등) */
export async function getRootCategories(database: typeof Database) {
  return database
    .select({ slug: category.slug, name: category.name })
    .from(category)
    .where(and(eq(category.isActive, true), isNull(category.parentId)))
    .orderBy(asc(category.sortOrder), asc(category.name));
}
