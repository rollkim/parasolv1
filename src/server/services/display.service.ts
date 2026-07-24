import "server-only";

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import type { db as Database } from "@/db";
import { banner, displaySection, displaySectionProduct } from "@/db/schema";

import {
  getAutoSectionCards,
  getProductCardsByIds,
  type ProductCard,
} from "./product.service";

/**
 * 메인 진열 도메인 모듈 — 배너·진열 섹션을 공급한다.
 * 관리자가 코드 수정 없이 메인을 구성하는 구조(스펙서 §7)의 조회 절반.
 */

export type HomeBanner = {
  bannerId: number;
  title: string | null;
  kicker: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imagePath: string | null;
  mobileImagePath: string | null;
  imageAlt: string | null;
  toneCode: string | null;
  linkUrl: string | null;
};

export type HomeSection = {
  sectionId: number;
  kicker: string | null;
  title: string;
  sectionKind: string;
  cards: ProductCard[];
};

const AUTO_SECTION_CARD_LIMIT = 4;

/** 슬롯별 활성 배너 — 노출 기간(시작·종료 없으면 상시) 안에 있는 것만, 정렬 순서대로 */
async function getActiveBanners(
  database: typeof Database,
  slotCode: "hero" | "strip",
): Promise<HomeBanner[]> {
  const now = sql`now()`;

  return database
    .select({
      bannerId: banner.id,
      title: banner.title,
      kicker: banner.kicker,
      subtitle: banner.subtitle,
      ctaLabel: banner.ctaLabel,
      imagePath: banner.imagePath,
      mobileImagePath: banner.mobileImagePath,
      imageAlt: banner.alt,
      toneCode: banner.toneCode,
      linkUrl: banner.linkUrl,
    })
    .from(banner)
    .where(
      and(
        eq(banner.slot, slotCode),
        eq(banner.isActive, true),
        or(isNull(banner.startsAt), lte(banner.startsAt, now)),
        or(isNull(banner.endsAt), sql`${banner.endsAt} >= now()`),
      ),
    )
    .orderBy(asc(banner.sortOrder), asc(banner.id));
}

/** 활성 진열 섹션 + 종류별 상품 카드(manual=큐레이션 순서 / new·best=자동 상위 N) */
async function getHomeSections(database: typeof Database): Promise<HomeSection[]> {
  const sectionRows = await database
    .select({
      sectionId: displaySection.id,
      kicker: displaySection.kicker,
      title: displaySection.title,
      sectionKind: displaySection.kind,
    })
    .from(displaySection)
    .where(eq(displaySection.isActive, true))
    .orderBy(asc(displaySection.sortOrder), asc(displaySection.id));

  return Promise.all(
    sectionRows.map(async (sectionRow) => {
      let cards: ProductCard[];

      if (sectionRow.sectionKind === "new" || sectionRow.sectionKind === "best") {
        cards = await getAutoSectionCards(
          database,
          sectionRow.sectionKind,
          AUTO_SECTION_CARD_LIMIT,
        );
      } else {
        const mappingRows = await database
          .select({ productId: displaySectionProduct.productId })
          .from(displaySectionProduct)
          .where(eq(displaySectionProduct.sectionId, sectionRow.sectionId))
          .orderBy(asc(displaySectionProduct.sortOrder));
        cards = await getProductCardsByIds(
          database,
          mappingRows.map((row) => row.productId),
        );
      }

      return { ...sectionRow, cards };
    }),
  );
}

export type HomeDisplay = {
  heroBanners: HomeBanner[];
  stripBanners: HomeBanner[];
  sections: HomeSection[];
};

/** 메인 화면이 한 번에 받아 가는 진열 데이터 전체 */
export async function getHomeDisplay(database: typeof Database): Promise<HomeDisplay> {
  const [heroBanners, stripBanners, sections] = await Promise.all([
    getActiveBanners(database, "hero"),
    getActiveBanners(database, "strip"),
    getHomeSections(database),
  ]);

  return { heroBanners, stripBanners, sections };
}
