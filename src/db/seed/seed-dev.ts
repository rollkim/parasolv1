/**
 * 개발용 샘플 상품 시드 — `npm run db:seed:dev`
 *
 * 기본 시드(npm run db:seed)로 카테고리·진열섹션이 준비된 뒤 실행한다.
 * 빈 상품 테이블 전용 — 상품이 하나라도 있으면 통째로 건너뛴다(부분 중복 방지).
 * 실사진이 없어 product_image는 넣지 않는다 — 화면이 플레이스홀더를 렌더한다.
 */

import "dotenv/config";

import { asc, count, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  category,
  displaySection,
  displaySectionProduct,
  maker,
  product,
  productAddon,
  productCategory,
  productOption,
  productOptionValue,
  productVariant,
  variantOptionValue,
} from "@/db/schema";

/** 시드가 만든 행의 감사 컬럼 주체 — "admin:{id}"/"customer:{id}"와 구분되는 규약값 */
const SEED_ACTOR = "system";

// =============================================================
// 생산 공방 — 파라솔 자사 상품은 maker에 두지 않는다(makerId null)
// =============================================================

const MAKERS = [
  { name: "볕든 공방", slug: "byeotdeun" },
  { name: "온기제작소", slug: "ongi" },
  { name: "솔키친", slug: "solkitchen" },
  { name: "느린손 공방", slug: "neurinson" },
  { name: "모아 베이커리", slug: "moa" },
  { name: "한아름 베이커리", slug: "hanareum" },
];

// =============================================================
// 샘플 상품 30종 — 배열 순서 = 등록순
// 이 순서대로 insert해야 id 오름차순 = 등록순이 되어 '신상품' 정렬이 목업과 일치한다
// =============================================================

type DevVariantSeed = {
  price: number;
  compareAtPrice?: number;
  stock: number;
  /** 옵션 상품만 — 옵션 값 라벨 조합. 값 라벨은 상품 안에서 유일해야 한다 */
  optionValues?: string[];
};

type DevProductSeed = {
  name: string;
  slug: string;
  /** 복수 매핑 가능 (예: 선물세트 + 대추칩·곶감) */
  categorySlugs: string[];
  /** null = 파라솔 자사 상품 */
  makerSlug: string | null;
  summary?: string;
  badgeLabel?: string;
  salesCount: number;
  options?: { name: string; values: string[] }[];
  variants: DevVariantSeed[];
  addons?: { name: string; price: number; stock: number }[];
};

const PRODUCTS: DevProductSeed[] = [
  { name: "볶은 옥수수차 30T", slug: "roasted-corn-tea", categorySlugs: ["coffee"], makerSlug: "neurinson", salesCount: 60, variants: [{ price: 7500, stock: 30 }] },
  { name: "디카페인 원두 200g", slug: "decaf-beans", categorySlugs: ["coffee-bean"], makerSlug: "ongi", salesCount: 70, variants: [{ price: 15000, stock: 30 }] },
  { name: "오트밀 그래놀라 400g", slug: "oatmeal-granola", categorySlugs: ["granola"], makerSlug: "solkitchen", salesCount: 90, variants: [{ price: 11000, stock: 30 }] },
  { name: "사과 시나몬잼 250g", slug: "apple-cinnamon-jam", categorySlugs: ["jam"], makerSlug: "byeotdeun", salesCount: 80, variants: [{ price: 8500, stock: 30 }] },
  { name: "블루베리잼 250g", slug: "blueberry-jam", categorySlugs: ["jam"], makerSlug: "neurinson", salesCount: 110, variants: [{ price: 9500, stock: 30 }] },
  { name: "레몬 글레이즈 쿠키", slug: "lemon-glaze-cookie", categorySlugs: ["bakery"], makerSlug: "solkitchen", salesCount: 90, variants: [{ price: 9800, stock: 30 }] },
  { name: "수제 카스텔라", slug: "handmade-castella", categorySlugs: ["madeleine"], makerSlug: "ongi", salesCount: 200, variants: [{ price: 9900, compareAtPrice: 11000, stock: 30 }] },
  { name: "다크초코칩 쿠키 (10개입)", slug: "dark-chocochip-cookie", categorySlugs: ["choco-cookie"], makerSlug: "moa", salesCount: 260, variants: [{ price: 10900, compareAtPrice: 12900, stock: 30 }] },
  // 품절 상태 검증용 — 재고 0으로 노출한다(색이 아닌 텍스트로 품절 표시)
  { name: "얼그레이 파운드케이크", slug: "earlgrey-poundcake", categorySlugs: ["madeleine"], makerSlug: "moa", salesCount: 120, variants: [{ price: 13500, stock: 0 }] },
  { name: "소금 카라멜 쿠키", slug: "salted-caramel-cookie", categorySlugs: ["choco-cookie"], makerSlug: "neurinson", salesCount: 130, variants: [{ price: 11500, stock: 30 }] },
  { name: "헤이즐넛 피낭시에 (8개입)", slug: "hazelnut-financier", categorySlugs: ["madeleine"], makerSlug: "byeotdeun", salesCount: 150, variants: [{ price: 12800, stock: 30 }] },
  {
    // 유일한 옵션 상품 — 옵션 선택·조합 품절·추가상품 UI 검증용
    name: "통밀 오트 쿠키 세트",
    slug: "oat-cookie-set",
    categorySlugs: ["oat-cookie"],
    makerSlug: "byeotdeun",
    summary: "국내산 통밀과 압착 귀리를 그대로 반죽해 낮은 온도에서 오래 구운 쿠키",
    salesCount: 320,
    options: [
      { name: "구성", values: ["12개입", "24개입", "36개입"] },
      { name: "포장", values: ["기본 포장", "선물 포장"] },
    ],
    variants: [
      { price: 11700, compareAtPrice: 13800, stock: 20, optionValues: ["12개입", "기본 포장"] },
      { price: 13700, compareAtPrice: 15800, stock: 8, optionValues: ["12개입", "선물 포장"] },
      { price: 20700, compareAtPrice: 22800, stock: 2, optionValues: ["24개입", "기본 포장"] },
      { price: 22700, compareAtPrice: 24800, stock: 6, optionValues: ["24개입", "선물 포장"] },
      { price: 28700, compareAtPrice: 30800, stock: 5, optionValues: ["36개입", "기본 포장"] },
      // 조합 단위 품절 검증용
      { price: 30700, compareAtPrice: 32800, stock: 0, optionValues: ["36개입", "선물 포장"] },
    ],
    addons: [
      { name: "보냉 보틀백", price: 3000, stock: 50 },
      { name: "손글씨 메시지 카드", price: 1000, stock: 50 },
      { name: "리본 포장 업그레이드", price: 2000, stock: 50 },
    ],
  },
  { name: "크랜베리 그래놀라 400g", slug: "cranberry-granola", categorySlugs: ["granola"], makerSlug: "solkitchen", salesCount: 240, variants: [{ price: 12000, stock: 30 }] },
  { name: "견과 허니스프레드 200g", slug: "nut-honey-spread", categorySlugs: ["jam"], makerSlug: "solkitchen", salesCount: 100, variants: [{ price: 12000, stock: 30 }] },
  { name: "핸드드립 블렌드 원두 200g", slug: "handdrip-blend-beans", categorySlugs: ["coffee-bean"], makerSlug: "ongi", salesCount: 300, variants: [{ price: 14500, stock: 30 }] },
  { name: "드립백 커피 10개입", slug: "dripbag-coffee", categorySlugs: ["coffee"], makerSlug: "ongi", salesCount: 210, variants: [{ price: 13000, compareAtPrice: 15000, stock: 30 }] },
  { name: "흑임자 약과", slug: "black-sesame-yakgwa", categorySlugs: ["hangwa"], makerSlug: "ongi", salesCount: 190, variants: [{ price: 10500, stock: 30 }] },
  { name: "유기농 현미 뻥튀기", slug: "organic-brownrice-ppeong", categorySlugs: ["traditional"], makerSlug: "solkitchen", salesCount: 100, variants: [{ price: 6500, stock: 30 }] },
  { name: "오미자 다식 세트", slug: "omija-dasik-set", categorySlugs: ["hangwa"], makerSlug: "byeotdeun", salesCount: 80, variants: [{ price: 13800, stock: 0 }] },
  // 카테고리 복수 매핑 검증용 — 선물세트와 대추칩·곶감 양쪽에 노출
  { name: "대추칩 & 곶감 세트", slug: "date-chip-dried-persimmon-set", categorySlugs: ["gift", "dried-fruit"], makerSlug: "neurinson", salesCount: 170, variants: [{ price: 16800, compareAtPrice: 19800, stock: 30 }] },
  { name: "차·과자 선물세트", slug: "tea-snack-giftset", categorySlugs: ["holiday-set"], makerSlug: "ongi", salesCount: 110, variants: [{ price: 28000, stock: 30 }] },
  { name: "곡물 쌀강정 3종", slug: "grain-ricecake-gangjeong", categorySlugs: ["hangwa"], makerSlug: "moa", badgeLabel: "NEW", salesCount: 150, variants: [{ price: 9900, stock: 30 }] },
  { name: "통곡물 넛 그래놀라 500g", slug: "wholegrain-nut-granola", categorySlugs: ["granola"], makerSlug: "byeotdeun", badgeLabel: "NEW", salesCount: 130, variants: [{ price: 14000, stock: 30 }] },
  { name: "통밀 스콘 4종", slug: "wholewheat-scone-set", categorySlugs: ["bakery"], makerSlug: "solkitchen", badgeLabel: "NEW", salesCount: 95, variants: [{ price: 12500, stock: 30 }] },
  { name: "흑임자 쿠키 (10개입)", slug: "black-sesame-cookie", categorySlugs: ["oat-cookie"], makerSlug: "ongi", badgeLabel: "NEW", salesCount: 110, variants: [{ price: 10200, stock: 30 }] },
  { name: "수제 딸기잼 250g", slug: "strawberry-jam", categorySlugs: ["jam"], makerSlug: "neurinson", badgeLabel: "NEW", salesCount: 160, variants: [{ price: 8900, stock: 30 }] },
  { name: "브라운버터 쇼트브레드", slug: "brownbutter-shortbread", categorySlugs: ["choco-cookie"], makerSlug: "hanareum", badgeLabel: "NEW", salesCount: 140, variants: [{ price: 9500, stock: 30 }] },
  { name: "레몬 마들렌 (8개입)", slug: "lemon-madeleine", categorySlugs: ["madeleine"], makerSlug: "hanareum", badgeLabel: "NEW", salesCount: 180, variants: [{ price: 11200, stock: 30 }] },
  // 자사 상품 — makerId null 케이스 검증용
  { name: "파라솔 베스트 선물세트", slug: "parasol-best-giftset", categorySlugs: ["holiday-set"], makerSlug: null, badgeLabel: "NEW", salesCount: 140, variants: [{ price: 32000, stock: 30 }] },
  { name: "견과 정과 선물세트", slug: "nut-jeonggwa-giftset", categorySlugs: ["gift"], makerSlug: "byeotdeun", salesCount: 220, variants: [{ price: 24000, stock: 0 }] },
];

/** 메인 큐레이션(manual 섹션) 진열 순서 */
const CURATION_SLUGS = [
  "oat-cookie-set",
  "date-chip-dried-persimmon-set",
  "nut-jeonggwa-giftset",
  "cranberry-granola",
];

async function runDevSeed() {
  console.log("\nPaRaSOL 개발용 샘플 상품 시드 실행\n");

  // 가드: 이 스크립트는 빈 상품 테이블 전용 — 멱등 병합이 아니라 통째로 넣거나 말거나다
  const [{ productCount }] = await db.select({ productCount: count() }).from(product);
  if (productCount > 0) {
    console.log("  이미 상품이 있습니다 — 건너뜀\n");
    return;
  }

  // 실패 시 전부 롤백 — 절반만 들어간 상태가 남으면 가드에 걸려 재실행이 막힌다
  await db.transaction(async (tx) => {
    await tx
      .insert(maker)
      .values(
        MAKERS.map((row, index) => ({
          name: row.name,
          slug: row.slug,
          sortOrder: index + 1,
          createdBy: SEED_ACTOR,
        })),
      )
      .onConflictDoNothing({ target: maker.slug });

    // 이미 있던 공방도 매핑해야 하므로 insert 결과가 아니라 전체를 다시 조회한다
    const makerRows = await tx.select({ id: maker.id, slug: maker.slug }).from(maker);
    const makerIdBySlug = new Map(makerRows.map((row) => [row.slug, row.id]));

    const neededCategorySlugs = [...new Set(PRODUCTS.flatMap((row) => row.categorySlugs))];
    const categoryRows = await tx
      .select({ id: category.id, slug: category.slug })
      .from(category)
      .where(inArray(category.slug, neededCategorySlugs));
    const categoryIdBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]));

    // insert를 시작하기 전에 전제(기본 시드 완료)를 한 번에 검증한다
    const missingCategorySlugs = neededCategorySlugs.filter((slug) => !categoryIdBySlug.has(slug));
    if (missingCategorySlugs.length > 0) {
      throw new Error(
        `카테고리가 없습니다: ${missingCategorySlugs.join(", ")} — 기본 시드(npm run db:seed)를 먼저 실행하세요`,
      );
    }

    const [manualSection] = await tx
      .select({ id: displaySection.id })
      .from(displaySection)
      .where(eq(displaySection.kind, "manual"))
      .orderBy(asc(displaySection.sortOrder))
      .limit(1);
    if (!manualSection) {
      throw new Error(
        "진열섹션(manual)이 없습니다 — 기본 시드(npm run db:seed)를 먼저 실행하세요",
      );
    }

    const productIdBySlug = new Map<string, number>();
    let variantTotal = 0;
    let addonTotal = 0;

    for (const productSeed of PRODUCTS) {
      let makerId: number | null = null;
      if (productSeed.makerSlug !== null) {
        const foundMakerId = makerIdBySlug.get(productSeed.makerSlug);
        if (foundMakerId === undefined) {
          throw new Error(`maker slug 불일치: ${productSeed.slug} → ${productSeed.makerSlug}`);
        }
        makerId = foundMakerId;
      }

      const [insertedProduct] = await tx
        .insert(product)
        .values({
          makerId,
          name: productSeed.name,
          slug: productSeed.slug,
          summary: productSeed.summary ?? null,
          status: "active", // 개발 화면에서 바로 보이게 — 품절도 노출 상태(재고 0)로 표현
          badgeLabel: productSeed.badgeLabel ?? null,
          salesCount: productSeed.salesCount,
          // 정렬 캐시 — 목록·가격 정렬이 variant를 집계하지 않도록 최저가를 채운다
          minPrice: Math.min(...productSeed.variants.map((variantSeed) => variantSeed.price)),
          createdBy: SEED_ACTOR,
        })
        .returning({ id: product.id });

      productIdBySlug.set(productSeed.slug, insertedProduct.id);

      await tx.insert(productCategory).values(
        productSeed.categorySlugs.map((categorySlug) => ({
          productId: insertedProduct.id,
          // 위에서 존재를 검증했으므로 단언해도 안전하다
          categoryId: categoryIdBySlug.get(categorySlug)!,
        })),
      );

      // 옵션 상품 — variant가 값 라벨로 조합을 참조하므로 라벨→id 맵을 먼저 만든다
      const optionValueIdByLabel = new Map<string, number>();
      for (const [optionIndex, optionSeed] of (productSeed.options ?? []).entries()) {
        const [insertedOption] = await tx
          .insert(productOption)
          .values({
            productId: insertedProduct.id,
            name: optionSeed.name,
            position: optionIndex + 1,
            createdBy: SEED_ACTOR,
          })
          .returning({ id: productOption.id });

        const insertedValues = await tx
          .insert(productOptionValue)
          .values(
            optionSeed.values.map((valueLabel, valueIndex) => ({
              optionId: insertedOption.id,
              value: valueLabel,
              position: valueIndex + 1,
              createdBy: SEED_ACTOR,
            })),
          )
          .returning({ id: productOptionValue.id, value: productOptionValue.value });

        for (const valueRow of insertedValues) {
          optionValueIdByLabel.set(valueRow.value, valueRow.id);
        }
      }

      for (const [variantIndex, variantSeed] of productSeed.variants.entries()) {
        const [insertedVariant] = await tx
          .insert(productVariant)
          .values({
            productId: insertedProduct.id,
            price: variantSeed.price,
            compareAtPrice: variantSeed.compareAtPrice ?? null,
            stock: variantSeed.stock,
            position: variantIndex + 1,
            createdBy: SEED_ACTOR,
          })
          .returning({ id: productVariant.id });
        variantTotal += 1;

        if (variantSeed.optionValues?.length) {
          await tx.insert(variantOptionValue).values(
            variantSeed.optionValues.map((valueLabel) => {
              const optionValueId = optionValueIdByLabel.get(valueLabel);
              if (optionValueId === undefined) {
                throw new Error(`옵션 값 불일치: ${productSeed.slug} → ${valueLabel}`);
              }
              return { variantId: insertedVariant.id, optionValueId };
            }),
          );
        }
      }

      if (productSeed.addons?.length) {
        await tx.insert(productAddon).values(
          productSeed.addons.map((addonSeed, addonIndex) => ({
            productId: insertedProduct.id,
            name: addonSeed.name,
            price: addonSeed.price,
            stock: addonSeed.stock,
            position: addonIndex + 1,
            createdBy: SEED_ACTOR,
          })),
        );
        addonTotal += productSeed.addons.length;
      }
    }

    await tx.insert(displaySectionProduct).values(
      CURATION_SLUGS.map((curationSlug, index) => {
        const curatedProductId = productIdBySlug.get(curationSlug);
        if (curatedProductId === undefined) {
          throw new Error(`큐레이션 slug 불일치: ${curationSlug}`);
        }
        return {
          sectionId: manualSection.id,
          productId: curatedProductId,
          sortOrder: index + 1,
        };
      }),
    );

    console.log(
      `  상품 ${PRODUCTS.length}종 · variant ${variantTotal}개 · 추가상품 ${addonTotal}개 · 큐레이션 매핑 ${CURATION_SLUGS.length}건`,
    );
  });

  console.log("\n완료.\n");
}

runDevSeed()
  .then(() => process.exit(0))
  .catch((seedError) => {
    console.error("\n개발 시드 실패:", seedError);
    process.exit(1);
  });
