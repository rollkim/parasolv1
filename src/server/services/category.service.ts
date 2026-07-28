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

/**
 * 현재 보고 있는 카테고리의 계층 위치 — 상품목록의 빵부스러기·칩이 함께 쓴다.
 *
 * 칩은 "현재 위치에서 한 단계 더 좁히기"가 역할이다: 대분류를 보고 있으면 그 대분류의
 * 중분류를, 중분류를 보고 있으면 형제 중분류를 보여준다. 상단 GNB가 이미 대분류를
 * 담당하므로 목록에서 대분류를 한 번 더 그리면 같은 층을 두 번 보여주는 셈이다.
 */
export type CategoryPlacement = {
  /** 대분류(루트) — 전체 보기 중이면 null */
  root: { slug: string; name: string } | null;
  /** 중분류 — 대분류를 보고 있으면 null */
  child: { slug: string; name: string } | null;
  /** 이 위치에서 보여줄 하위 칩. 대분류 선택 전이면 대분류 목록이 진입점 역할을 한다 */
  chips: { slug: string; name: string }[];
  /**
   * 칩의 '전체'가 가리킬 slug — 대분류 안에서는 '그 대분류 전체'를 뜻한다.
   * null이면 필터 없는 전체 상품.
   */
  chipsAllSlug: string | null;
  /** 알 수 없는 slug — 화면이 빈 결과의 원인을 드러낼 수 있게 한다 */
  unknown: boolean;
};

export function resolveCategoryPlacement(
  navCategories: StoreNavCategory[],
  categorySlug: string | null,
): CategoryPlacement {
  const rootChips = navCategories.map((node) => ({ slug: node.slug, name: node.name }));

  if (categorySlug === null) {
    return { root: null, child: null, chips: rootChips, chipsAllSlug: null, unknown: false };
  }

  const matchedRoot = navCategories.find((node) => node.slug === categorySlug);
  if (matchedRoot) {
    return {
      root: { slug: matchedRoot.slug, name: matchedRoot.name },
      child: null,
      // 자식이 없는 대분류는 더 좁힐 것이 없다 — 형제 대분류로 이동할 수 있게 둔다
      chips: matchedRoot.children.length > 0 ? matchedRoot.children : rootChips,
      chipsAllSlug: matchedRoot.children.length > 0 ? matchedRoot.slug : null,
      unknown: false,
    };
  }

  for (const node of navCategories) {
    const matchedChild = node.children.find((child) => child.slug === categorySlug);
    if (matchedChild) {
      return {
        root: { slug: node.slug, name: node.name },
        child: matchedChild,
        chips: node.children,
        chipsAllSlug: node.slug,
        unknown: false,
      };
    }
  }

  return { root: null, child: null, chips: rootChips, chipsAllSlug: null, unknown: true };
}

/** 루트 카테고리만 필요할 때 (관리자 필터 등) */
export async function getRootCategories(database: typeof Database) {
  return database
    .select({ slug: category.slug, name: category.name })
    .from(category)
    .where(and(eq(category.isActive, true), isNull(category.parentId)))
    .orderBy(asc(category.sortOrder), asc(category.name));
}
