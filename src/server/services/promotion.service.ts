import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { coupon, promotion, promotionProduct } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { getProductCardsByIds, type ProductCard } from "./product.service";

/**
 * 기획전 스토어 조회 (E1) — 목록·상세.
 *
 * 기획전이 파는 것은 가격 엔진이 아니라 **긴급감(카운트다운) + 모음 + 전용 쿠폰**이다.
 * 할인 자체는 기존 가격 체계(variant.price / compareAtPrice)가 담당한다 —
 * promotion_product.special_price는 판매 단위(variant)와 어긋나 결제 경로에 잇지 않는다
 * (설계 결정 ① — 진짜 타임특가가 필요해지면 variant 단위로 재설계).
 */

export type PromotionPhase = "upcoming" | "live" | "ended";

/** 기간·활성으로 단계를 정한다 — 화면 문구("오픈 예정"/"종료")가 이 값 하나를 본다 */
function resolvePhase(row: {
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
}): PromotionPhase {
  const now = new Date();
  if (!row.isActive) return "ended";
  if (row.startsAt !== null && now < row.startsAt) return "upcoming";
  if (row.endsAt !== null && now > row.endsAt) return "ended";
  return "live";
}

export type PromotionCard = {
  promotionId: number;
  slug: string;
  title: string;
  description: string | null;
  heroImagePath: string | null;
  heroMobileImagePath: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  phase: PromotionPhase;
  productCount: number;
};

/**
 * 진행 중 기획전 목록 — 종료 임박순.
 *
 * 예정(upcoming)도 함께 내려 "곧 열려요"로 보여준다 — 숨기면 기대감을 만들 수 없다.
 * 종료된 것만 목록에서 뺀다(상세는 공유 링크를 위해 계속 열린다).
 */
export async function listStorePromotions(
  database: DatabaseClient,
): Promise<PromotionCard[]> {
  const rows = await database
    .select({
      promotionId: promotion.id,
      slug: promotion.slug,
      title: promotion.title,
      description: promotion.description,
      heroImagePath: promotion.heroImagePath,
      heroMobileImagePath: promotion.heroMobileImagePath,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      isActive: promotion.isActive,
      productCount: sql<number>`(
        select count(*) from ${promotionProduct}
        where ${promotionProduct.promotionId} = ${promotion.id}
      )::int`,
    })
    .from(promotion)
    .where(
      and(
        eq(promotion.isActive, true),
        sql`(${promotion.endsAt} is null or ${promotion.endsAt} >= now())`,
      ),
    )
    // 끝이 가까운 것부터 — 기한 없는 상설전은 뒤로
    .orderBy(sql`${promotion.endsAt} asc nulls last`, desc(promotion.id));

  return rows.map((row) => ({
    promotionId: row.promotionId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    heroImagePath: row.heroImagePath,
    heroMobileImagePath: row.heroMobileImagePath,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    phase: resolvePhase(row),
    productCount: Number(row.productCount),
  }));
}

/** 쿠폰 스트립 — 혜택 문구를 화면이 조립할 재료. 발급 판정은 쿠폰 도메인이 한다 */
export type PromotionCouponStrip = {
  couponId: number;
  couponName: string;
  discountKind: "fixed" | "percent";
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
};

export type PromotionDetail = {
  promotionId: number;
  slug: string;
  title: string;
  description: string | null;
  heroImagePath: string | null;
  heroMobileImagePath: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  phase: PromotionPhase;
  products: ProductCard[];
  /** 연결 쿠폰이 없거나 중지됐으면 null — 스트립이 그려지지 않는다 */
  couponStrip: PromotionCouponStrip | null;
};

/**
 * 기획전 상세.
 *
 * **종료돼도 null을 주지 않는다** — 카톡으로 공유된 링크가 404가 되면 안 된다.
 * 화면이 phase="ended"를 보고 "종료된 기획전"으로 그린다. 비활성(중지)만 숨긴다.
 */
export async function getStorePromotionDetail(
  database: DatabaseClient,
  slug: string,
): Promise<PromotionDetail | null> {
  const [row] = await database
    .select({
      promotionId: promotion.id,
      slug: promotion.slug,
      title: promotion.title,
      description: promotion.description,
      heroImagePath: promotion.heroImagePath,
      heroMobileImagePath: promotion.heroMobileImagePath,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      isActive: promotion.isActive,
      couponId: coupon.id,
      couponName: coupon.name,
      couponKind: coupon.type,
      couponValue: coupon.value,
      couponMaxDiscount: coupon.maxDiscount,
      couponMinOrder: coupon.minOrderAmount,
      couponActive: coupon.isActive,
    })
    .from(promotion)
    .leftJoin(coupon, eq(promotion.couponId, coupon.id))
    .where(eq(promotion.slug, slug))
    .limit(1);

  if (!row || !row.isActive) return null;

  // 상품은 관리자가 정한 순서 그대로 — 큐레이션이 곧 기획이다
  const mappingRows = await database
    .select({ productId: promotionProduct.productId })
    .from(promotionProduct)
    .where(eq(promotionProduct.promotionId, row.promotionId))
    .orderBy(asc(promotionProduct.sortOrder), asc(promotionProduct.productId));

  const products = await getProductCardsByIds(
    database,
    mappingRows.map((mapping) => mapping.productId),
  );

  return {
    promotionId: row.promotionId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    heroImagePath: row.heroImagePath,
    heroMobileImagePath: row.heroMobileImagePath,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    phase: resolvePhase(row),
    products,
    couponStrip:
      row.couponId !== null && row.couponActive
        ? {
            couponId: row.couponId,
            couponName: row.couponName ?? "",
            discountKind: row.couponKind ?? "fixed",
            discountValue: row.couponValue ?? 0,
            maxDiscountAmount: row.couponMaxDiscount,
            minOrderAmount: row.couponMinOrder ?? 0,
          }
        : null,
  };
}
