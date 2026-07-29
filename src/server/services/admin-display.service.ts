import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { banner, displaySection, displaySectionProduct, product } from "@/db/schema";

import type { DatabaseClient, TransactionClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";
import { claimFiles, releaseOwnerFiles } from "./uploaded-file.service";

/**
 * 관리자 배너·진열 관리.
 *
 * 두 슬롯의 성격이 다르다:
 *   hero  = 이미지 배너(대체텍스트 필수 — DB CHECK가 강제한다)
 *   strip = 이미지 없이 문구 + **톤 코드**. 색상값이 아니라 토큰명을 저장한다 —
 *           색을 직접 넣으면 리스킨 때 따라오지 않는다(RULE-11).
 *
 * 진열 섹션은 유형이 셋이다: manual(직접 고름) / new(등록일 자동) / best(판매량 자동).
 * 자동 유형에 상품을 붙여 두면 "왜 내가 고른 게 안 나오지"가 되므로 manual만 상품을 가진다.
 */

export type BannerSlot = "hero" | "strip";
export type DisplaySectionKind = "manual" | "new" | "best";

/** 띠배너 톤 — 테마 토큰명. 색상값을 저장하지 않는다 */
export const STRIP_TONE_CODES = ["primary", "accent", "foreground"] as const;
export type StripToneCode = (typeof STRIP_TONE_CODES)[number];

export type AdminBannerCard = {
  bannerId: number;
  slot: BannerSlot;
  title: string | null;
  kicker: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imagePath: string | null;
  alt: string | null;
  toneCode: string | null;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  /** 지금 실제로 스토어에 보이는가 — 활성 + 기간 안 */
  isLiveNow: boolean;
};

export class AdminBannerNotFoundError extends Error {
  constructor(readonly bannerId: number) {
    super(`배너를 찾을 수 없습니다: id=${bannerId}`);
    this.name = "AdminBannerNotFoundError";
  }
}

export class BannerAltRequiredError extends Error {
  constructor() {
    super("이미지를 올렸으면 대체 텍스트를 입력해야 합니다.");
    this.name = "BannerAltRequiredError";
  }
}

export class BannerPeriodInvalidError extends Error {
  constructor() {
    super("노출 종료일이 시작일보다 빠릅니다. 기간을 다시 확인해 주세요.");
    this.name = "BannerPeriodInvalidError";
  }
}

/** 활성이면서 기간 안이면 지금 보인다. 기간이 비어 있으면 무제한 */
function isBannerLiveNow(row: {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}): boolean {
  if (!row.isActive) return false;
  const now = Date.now();
  if (row.startsAt && row.startsAt.getTime() > now) return false;
  if (row.endsAt && row.endsAt.getTime() < now) return false;
  return true;
}

export async function listAdminBanners(
  database: DatabaseClient,
): Promise<Record<BannerSlot, AdminBannerCard[]>> {
  const rows = await database
    .select()
    .from(banner)
    .orderBy(asc(banner.slot), asc(banner.sortOrder), asc(banner.id));

  const toCard = (row: (typeof rows)[number]): AdminBannerCard => ({
    bannerId: row.id,
    slot: row.slot as BannerSlot,
    title: row.title,
    kicker: row.kicker,
    subtitle: row.subtitle,
    ctaLabel: row.ctaLabel,
    imagePath: row.imagePath,
    alt: row.alt,
    toneCode: row.toneCode,
    linkUrl: row.linkUrl,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isLiveNow: isBannerLiveNow(row),
  });

  return {
    hero: rows.filter((row) => row.slot === "hero").map(toCard),
    strip: rows.filter((row) => row.slot === "strip").map(toCard),
  };
}

export type SaveAdminBannerInput = {
  bannerId: number | null;
  slot: BannerSlot;
  title: string | null;
  kicker: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imagePath: string | null;
  alt: string | null;
  toneCode: string | null;
  linkUrl: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  actor: TransitionActor;
};

export async function saveAdminBanner(
  database: DatabaseClient,
  input: SaveAdminBannerInput,
): Promise<{ bannerId: number }> {
  // DB CHECK가 막기 전에 읽을 수 있는 문구로 거른다 — 제약 위반 메시지는 화면에 못 쓴다
  if (input.imagePath && !input.alt?.trim()) throw new BannerAltRequiredError();
  if (input.startsAt && input.endsAt && input.endsAt.getTime() < input.startsAt.getTime()) {
    throw new BannerPeriodInvalidError();
  }

  const actorText = serializeActor(input.actor);
  const values = {
    slot: input.slot,
    title: input.title,
    kicker: input.kicker,
    subtitle: input.subtitle,
    ctaLabel: input.ctaLabel,
    imagePath: input.imagePath,
    alt: input.alt?.trim() ? input.alt.trim() : null,
    toneCode: input.toneCode,
    linkUrl: input.linkUrl,
    isActive: input.isActive,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  };

  // 이미지 소유를 배너 저장과 한 트랜잭션에 묶는다 — 저장이 실패하면 소유도 되돌아가야
  // "배너엔 안 붙었는데 파일은 주인이 있다"가 안 생긴다
  return database.transaction(async (tx) => {
    const keepPaths = input.imagePath ? [input.imagePath] : [];

    if (input.bannerId === null) {
      // 같은 슬롯 맨 뒤에 붙인다 — 중간에 끼면 어디 생겼는지 못 찾는다
      const [lastRow] = await tx
        .select({ maxSortOrder: sql<number>`coalesce(max(${banner.sortOrder}), -1)::int` })
        .from(banner)
        .where(eq(banner.slot, input.slot));

      const [inserted] = await tx
        .insert(banner)
        .values({ ...values, sortOrder: (lastRow?.maxSortOrder ?? -1) + 1, createdBy: actorText })
        .returning({ id: banner.id });
      await claimFiles(tx, { ownerType: "banner", ownerId: inserted.id, keepPaths });
      return { bannerId: inserted.id };
    }

    const updated = await tx
      .update(banner)
      .set({ ...values, updatedBy: actorText })
      .where(eq(banner.id, input.bannerId))
      .returning({ id: banner.id });
    if (updated.length === 0) throw new AdminBannerNotFoundError(input.bannerId);
    // 이미지를 바꾸면 이전 파일이 여기서 삭제 예약된다
    await claimFiles(tx, { ownerType: "banner", ownerId: updated[0].id, keepPaths });
    return { bannerId: updated[0].id };
  });
}

/**
 * 같은 슬롯 안에서 한 칸 이동. 교환 전에 형제를 0..n-1로 다시 매긴다 —
 * sortOrder가 전부 같으면 교환해도 아무 일도 일어나지 않는다(카테고리와 같은 이유).
 */
export async function moveAdminBannerOrder(
  database: DatabaseClient,
  input: { bannerId: number; direction: "up" | "down" },
): Promise<{ moved: boolean }> {
  return database.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: banner.id, slot: banner.slot })
      .from(banner)
      .where(eq(banner.id, input.bannerId))
      .limit(1);
    if (!target) throw new AdminBannerNotFoundError(input.bannerId);

    const siblings = await tx
      .select({ id: banner.id })
      .from(banner)
      .where(eq(banner.slot, target.slot))
      .orderBy(asc(banner.sortOrder), asc(banner.id));

    const currentIndex = siblings.findIndex((row) => row.id === input.bannerId);
    const swapIndex = input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= siblings.length) return { moved: false };

    const reordered = [...siblings];
    [reordered[currentIndex], reordered[swapIndex]] = [
      reordered[swapIndex],
      reordered[currentIndex],
    ];
    for (const [index, sibling] of reordered.entries()) {
      await tx.update(banner).set({ sortOrder: index }).where(eq(banner.id, sibling.id));
    }
    return { moved: true };
  });
}

export async function deleteAdminBanner(
  database: DatabaseClient,
  input: { bannerId: number },
): Promise<{ bannerId: number }> {
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(banner)
      .where(eq(banner.id, input.bannerId))
      .returning({ id: banner.id });
    if (deleted.length === 0) throw new AdminBannerNotFoundError(input.bannerId);
    // 배너는 진짜 삭제라 이미지도 쓸 곳이 없어진다 — 유예 뒤 배치가 지운다
    await releaseOwnerFiles(tx, { ownerType: "banner", ownerId: deleted[0].id });
    return { bannerId: deleted[0].id };
  });
}

// =============================================================
// 진열 섹션
// =============================================================

export type AdminDisplaySectionCard = {
  sectionId: number;
  kicker: string | null;
  title: string;
  kind: DisplaySectionKind;
  kindLabel: string;
  sortOrder: number;
  isActive: boolean;
  /** manual 유형만 직접 고른 상품을 가진다 */
  products: { productId: number; name: string; sortOrder: number }[];
};

const SECTION_KIND_LABELS: Record<DisplaySectionKind, string> = {
  manual: "수동 큐레이션",
  new: "신상품(자동)",
  best: "베스트(자동)",
};

export function displaySectionKindLabel(kind: DisplaySectionKind): string {
  return SECTION_KIND_LABELS[kind];
}

export class AdminDisplaySectionNotFoundError extends Error {
  constructor(readonly sectionId: number) {
    super(`진열 섹션을 찾을 수 없습니다: id=${sectionId}`);
    this.name = "AdminDisplaySectionNotFoundError";
  }
}

export async function listAdminDisplaySections(
  database: DatabaseClient,
): Promise<AdminDisplaySectionCard[]> {
  const sections = await database
    .select()
    .from(displaySection)
    .orderBy(asc(displaySection.sortOrder), asc(displaySection.id));

  const sectionIds = sections.map((row) => row.id);
  const productRows =
    sectionIds.length === 0
      ? []
      : await database
          .select({
            sectionId: displaySectionProduct.sectionId,
            productId: displaySectionProduct.productId,
            name: product.name,
            sortOrder: displaySectionProduct.sortOrder,
          })
          .from(displaySectionProduct)
          .innerJoin(product, eq(displaySectionProduct.productId, product.id))
          .where(
            and(inArray(displaySectionProduct.sectionId, sectionIds), isNull(product.deletedAt)),
          )
          .orderBy(asc(displaySectionProduct.sortOrder));

  return sections.map((row) => ({
    sectionId: row.id,
    kicker: row.kicker,
    title: row.title,
    kind: row.kind as DisplaySectionKind,
    kindLabel: displaySectionKindLabel(row.kind as DisplaySectionKind),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    products: productRows
      .filter((productRow) => productRow.sectionId === row.id)
      .map(({ productId, name, sortOrder }) => ({ productId, name, sortOrder })),
  }));
}

/** manual이 아닌 섹션의 상품 연결을 지운다 — 자동 유형에 남아 있으면 아무 데도 안 쓰이는 유령이 된다 */
async function clearProductsIfAutomatic(
  tx: TransactionClient,
  sectionId: number,
  kind: DisplaySectionKind,
): Promise<void> {
  if (kind === "manual") return;
  await tx.delete(displaySectionProduct).where(eq(displaySectionProduct.sectionId, sectionId));
}

export async function saveAdminDisplaySection(
  database: DatabaseClient,
  input: {
    sectionId: number | null;
    kicker: string | null;
    title: string;
    kind: DisplaySectionKind;
    isActive: boolean;
    /** manual일 때만 의미가 있다. 순서는 배열 순서 */
    productIds: number[];
    actor: TransitionActor;
  },
): Promise<{ sectionId: number }> {
  const actorText = serializeActor(input.actor);

  return database.transaction(async (tx) => {
    let sectionId: number;
    if (input.sectionId === null) {
      const [lastRow] = await tx
        .select({ maxSortOrder: sql<number>`coalesce(max(${displaySection.sortOrder}), -1)::int` })
        .from(displaySection);
      const [inserted] = await tx
        .insert(displaySection)
        .values({
          kicker: input.kicker,
          title: input.title,
          kind: input.kind,
          isActive: input.isActive,
          sortOrder: (lastRow?.maxSortOrder ?? -1) + 1,
          createdBy: actorText,
        })
        .returning({ id: displaySection.id });
      sectionId = inserted.id;
    } else {
      sectionId = input.sectionId;
      const updated = await tx
        .update(displaySection)
        .set({
          kicker: input.kicker,
          title: input.title,
          kind: input.kind,
          isActive: input.isActive,
          updatedBy: actorText,
        })
        .where(eq(displaySection.id, sectionId))
        .returning({ id: displaySection.id });
      if (updated.length === 0) throw new AdminDisplaySectionNotFoundError(sectionId);
    }

    await tx.delete(displaySectionProduct).where(eq(displaySectionProduct.sectionId, sectionId));
    if (input.kind === "manual" && input.productIds.length > 0) {
      await tx.insert(displaySectionProduct).values(
        input.productIds.map((productId, index) => ({
          sectionId,
          productId,
          sortOrder: index,
        })),
      );
    }
    await clearProductsIfAutomatic(tx, sectionId, input.kind);

    return { sectionId };
  });
}

export async function moveAdminDisplaySectionOrder(
  database: DatabaseClient,
  input: { sectionId: number; direction: "up" | "down" },
): Promise<{ moved: boolean }> {
  return database.transaction(async (tx) => {
    const siblings = await tx
      .select({ id: displaySection.id })
      .from(displaySection)
      .orderBy(asc(displaySection.sortOrder), asc(displaySection.id));

    const currentIndex = siblings.findIndex((row) => row.id === input.sectionId);
    if (currentIndex === -1) throw new AdminDisplaySectionNotFoundError(input.sectionId);

    const swapIndex = input.direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= siblings.length) return { moved: false };

    const reordered = [...siblings];
    [reordered[currentIndex], reordered[swapIndex]] = [
      reordered[swapIndex],
      reordered[currentIndex],
    ];
    for (const [index, sibling] of reordered.entries()) {
      await tx
        .update(displaySection)
        .set({ sortOrder: index })
        .where(eq(displaySection.id, sibling.id));
    }
    return { moved: true };
  });
}

export async function deleteAdminDisplaySection(
  database: DatabaseClient,
  input: { sectionId: number },
): Promise<{ sectionId: number }> {
  const deleted = await database
    .delete(displaySection)
    .where(eq(displaySection.id, input.sectionId))
    .returning({ id: displaySection.id });
  if (deleted.length === 0) throw new AdminDisplaySectionNotFoundError(input.sectionId);
  return { sectionId: deleted[0].id };
}

/** 수동 큐레이션에서 상품을 고를 때 쓰는 후보 목록 */
export async function searchProductsForDisplay(
  database: DatabaseClient,
  input: { keyword?: string } = {},
): Promise<{ productId: number; name: string; slug: string }[]> {
  const keyword = input.keyword?.trim();
  return database
    .select({ productId: product.id, name: product.name, slug: product.slug })
    .from(product)
    .where(
      and(
        isNull(product.deletedAt),
        eq(product.status, "active"),
        keyword ? sql`${product.name} ilike ${`%${keyword}%`}` : undefined,
      ),
    )
    .orderBy(asc(product.name))
    .limit(30);
}
