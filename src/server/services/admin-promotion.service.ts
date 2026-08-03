import "server-only";

import { and, asc, count, desc, eq, ilike, ne, sql } from "drizzle-orm";

import { coupon, product, promotion, promotionProduct } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 관리자 기획전 관리 (E2) — 목록·등록/수정·상품 구성·중지.
 *
 * 상품 구성은 **전체 교체**다(지우고 다시 넣기). 부분 추가/삭제 API를 나누면
 * 화면 상태와 서버 상태가 어긋났을 때 어느 쪽이 진실인지 알 수 없다 —
 * 화면이 보낸 전체 목록이 진실이다(관리자 설정 upsert와 같은 원칙).
 */

export const ADMIN_PROMOTION_PAGE_SIZE = 15;

export class AdminPromotionNotFoundError extends Error {
  constructor(readonly promotionId: number) {
    super(`기획전을 찾을 수 없습니다: id=${promotionId}`);
    this.name = "AdminPromotionNotFoundError";
  }
}

export class AdminPromotionInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminPromotionInvalidError";
  }
}

export type AdminPromotionRow = {
  promotionId: number;
  slug: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  couponId: number | null;
  couponName: string | null;
  productCount: number;
};

export type AdminPromotionListPage = {
  rows: AdminPromotionRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export async function listAdminPromotions(
  database: DatabaseClient,
  input: { keyword?: string; page?: number } = {},
): Promise<AdminPromotionListPage> {
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim() ?? "";
  const keywordFilter =
    keyword.length > 0
      ? ilike(promotion.title, "%" + keyword + "%")
      : undefined;

  const [totalRow] = await database
    .select({ total: count() })
    .from(promotion)
    .where(keywordFilter);

  const rows = await database
    .select({
      promotionId: promotion.id,
      slug: promotion.slug,
      title: promotion.title,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      isActive: promotion.isActive,
      couponId: promotion.couponId,
      couponName: coupon.name,
      productCount: sql<number>`(
        select count(*) from ${promotionProduct}
        where ${promotionProduct.promotionId} = ${promotion.id}
      )::int`,
    })
    .from(promotion)
    .leftJoin(coupon, eq(promotion.couponId, coupon.id))
    .where(keywordFilter)
    .orderBy(desc(promotion.id))
    .limit(ADMIN_PROMOTION_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PROMOTION_PAGE_SIZE);

  return {
    rows: rows.map((row) => ({ ...row, productCount: Number(row.productCount) })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_PROMOTION_PAGE_SIZE,
  };
}

export type AdminPromotionDetail = {
  promotionId: number;
  slug: string;
  title: string;
  description: string | null;
  heroImagePath: string | null;
  heroMobileImagePath: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  couponId: number | null;
  /** 구성 상품 — 저장된 순서 그대로. 화면 편집 목록의 초기값 */
  products: { productId: number; productName: string }[];
};

export async function getAdminPromotion(
  database: DatabaseClient,
  promotionId: number,
): Promise<AdminPromotionDetail> {
  const [row] = await database
    .select()
    .from(promotion)
    .where(eq(promotion.id, promotionId))
    .limit(1);
  if (!row) throw new AdminPromotionNotFoundError(promotionId);

  const productRows = await database
    .select({ productId: promotionProduct.productId, productName: product.name })
    .from(promotionProduct)
    .innerJoin(product, eq(promotionProduct.productId, product.id))
    .where(eq(promotionProduct.promotionId, promotionId))
    .orderBy(asc(promotionProduct.sortOrder), asc(promotionProduct.productId));

  return {
    promotionId: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    heroImagePath: row.heroImagePath,
    heroMobileImagePath: row.heroMobileImagePath,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    couponId: row.couponId,
    products: productRows,
  };
}

export type AdminPromotionInput = {
  slug: string;
  title: string;
  description: string | null;
  heroImagePath: string | null;
  heroMobileImagePath: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  couponId: number | null;
  isActive: boolean;
  /** 구성 상품 id — 배열 순서가 곧 진열 순서다 */
  productIds: number[];
};

/** 저장 전 검증 — 화면만 막으면 API 직접 호출로 뚫린다 */
function assertPromotionInput(input: AdminPromotionInput): void {
  if (!input.title.trim()) {
    throw new AdminPromotionInvalidError("기획전 제목을 입력해 주세요.");
  }
  if (!/^[a-z0-9-]+$/.test(input.slug)) {
    // 한글 slug는 URL이 %EC%... 로 깨진다 — DB CHECK와 같은 규약(RULE-11)
    throw new AdminPromotionInvalidError(
      "URL 주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다. 예: chuseok-2026",
    );
  }
  if (input.startsAt !== null && input.endsAt !== null && input.startsAt > input.endsAt) {
    throw new AdminPromotionInvalidError("종료일이 시작일보다 빠릅니다.");
  }
  if (input.productIds.length === 0) {
    // 빈 기획전이 스토어에 열리면 "준비 중" 같은 백지 화면이 된다
    throw new AdminPromotionInvalidError("구성 상품을 1개 이상 담아 주세요.");
  }
  const uniqueCount = new Set(input.productIds).size;
  if (uniqueCount !== input.productIds.length) {
    throw new AdminPromotionInvalidError("같은 상품이 두 번 들어 있습니다.");
  }
}

async function assertSlugAvailable(
  database: DatabaseClient,
  slug: string,
  excludePromotionId: number | null,
): Promise<void> {
  const [duplicate] = await database
    .select({ id: promotion.id })
    .from(promotion)
    .where(
      excludePromotionId === null
        ? eq(promotion.slug, slug)
        : and(eq(promotion.slug, slug), ne(promotion.id, excludePromotionId)),
    )
    .limit(1);
  if (duplicate) {
    throw new AdminPromotionInvalidError(
      "이미 쓰이고 있는 URL 주소입니다. 다른 주소를 입력해 주세요.",
    );
  }
}

/** 구성 상품 전체 교체 — 배열 순서를 sort_order로 저장한다 */
async function replacePromotionProducts(
  database: DatabaseClient,
  promotionId: number,
  productIds: number[],
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.delete(promotionProduct).where(eq(promotionProduct.promotionId, promotionId));
    await tx.insert(promotionProduct).values(
      productIds.map((productId, index) => ({
        promotionId,
        productId,
        sortOrder: index,
      })),
    );
  });
}

export async function createAdminPromotion(
  database: DatabaseClient,
  input: { promotion: AdminPromotionInput; actor: TransitionActor },
): Promise<{ promotionId: number }> {
  assertPromotionInput(input.promotion);
  await assertSlugAvailable(database, input.promotion.slug, null);

  const actorText = serializeActor(input.actor);
  const [created] = await database
    .insert(promotion)
    .values({
      slug: input.promotion.slug,
      title: input.promotion.title.trim(),
      description: input.promotion.description,
      heroImagePath: input.promotion.heroImagePath,
      heroMobileImagePath: input.promotion.heroMobileImagePath,
      startsAt: input.promotion.startsAt,
      endsAt: input.promotion.endsAt,
      couponId: input.promotion.couponId,
      isActive: input.promotion.isActive,
      createdBy: actorText,
      updatedBy: actorText,
    })
    .returning({ id: promotion.id });

  await replacePromotionProducts(database, created.id, input.promotion.productIds);
  return { promotionId: created.id };
}

export async function updateAdminPromotion(
  database: DatabaseClient,
  input: { promotionId: number; promotion: AdminPromotionInput; actor: TransitionActor },
): Promise<{ updated: true }> {
  assertPromotionInput(input.promotion);
  await assertSlugAvailable(database, input.promotion.slug, input.promotionId);

  const updated = await database
    .update(promotion)
    .set({
      slug: input.promotion.slug,
      title: input.promotion.title.trim(),
      description: input.promotion.description,
      heroImagePath: input.promotion.heroImagePath,
      heroMobileImagePath: input.promotion.heroMobileImagePath,
      startsAt: input.promotion.startsAt,
      endsAt: input.promotion.endsAt,
      couponId: input.promotion.couponId,
      isActive: input.promotion.isActive,
      updatedBy: serializeActor(input.actor),
      updatedAt: sql`now()`,
    })
    .where(eq(promotion.id, input.promotionId))
    .returning({ id: promotion.id });
  if (updated.length === 0) throw new AdminPromotionNotFoundError(input.promotionId);

  await replacePromotionProducts(database, input.promotionId, input.promotion.productIds);
  return { updated: true };
}

/**
 * 중지 — 삭제하지 않는다. 스토어 목록·상세에서 사라지지만 기록은 남는다.
 * 지우면 "지난 기획전에 뭘 팔았는지"를 답할 수 없다.
 */
export async function deactivateAdminPromotion(
  database: DatabaseClient,
  input: { promotionId: number; actor: TransitionActor },
): Promise<{ deactivated: true }> {
  const updated = await database
    .update(promotion)
    .set({
      isActive: false,
      updatedBy: serializeActor(input.actor),
      updatedAt: sql`now()`,
    })
    .where(eq(promotion.id, input.promotionId))
    .returning({ id: promotion.id });
  if (updated.length === 0) throw new AdminPromotionNotFoundError(input.promotionId);
  return { deactivated: true };
}

/** 쿠폰 연결 선택지 — 활성 쿠폰만. 중지된 쿠폰을 이으면 스트립이 어차피 안 그려진다 */
export async function listCouponChoices(
  database: DatabaseClient,
): Promise<{ couponId: number; couponName: string }[]> {
  const rows = await database
    .select({ couponId: coupon.id, couponName: coupon.name })
    .from(coupon)
    .where(eq(coupon.isActive, true))
    .orderBy(desc(coupon.id))
    .limit(50);
  return rows;
}
