/**
 * 이야기(브랜드 스토리) 검증 — 목록·상세·공개 기준을 실제 DB에서 확인한다.
 * 실행: npm run check:story   (SSH 터널 켠 상태 · 스키마 보강 SQL 적용 후)
 *
 * 핵심 검증: **미공개 글이 어느 경로로도 새지 않는다.** 목록·상세·다른 이야기 세 곳 모두.
 *
 * 시나리오: [1]목록 기본 [2]카테고리 필터 [3]상세 블록·읽는시간 [4]관련 제품
 *           [5]미공개·예약 글 차단 [6]없는 slug
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { article, product } from "@/db/schema";

import { getStoryDetail, getStoryListPage } from "../article.service";

let passCount = 0;
let failCount = 0;

function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passCount += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failCount += 1;
    console.log(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const SUFFIX = randomUUID().slice(0, 8);

async function main() {
  console.log("PaRaSOL 이야기 검증 (임시 글은 종료 시 삭제)");

  const [sellingProduct] = await db
    .select({ id: product.id, slug: product.slug, name: product.name })
    .from(product)
    .where(eq(product.status, "active"))
    .orderBy(product.id)
    .limit(1);
  if (!sellingProduct) throw new Error("판매중 상품 없음 — npm run db:seed:dev 먼저 실행");

  const temporarySlugs: string[] = [];

  try {
    const publishedSlug = `check-published-${SUFFIX}`;
    const draftSlug = `check-draft-${SUFFIX}`;
    const scheduledSlug = `check-scheduled-${SUFFIX}`;
    temporarySlugs.push(publishedSlug, draftSlug, scheduledSlug);

    const bodyContent = [
      "첫 문단입니다. " + "가".repeat(400),
      "> 인용문입니다.",
      "## 소제목입니다",
      "![캡션입니다](/uploads/article/check.jpg)",
      "마지막 문단입니다.",
    ].join("\n\n");

    await db.insert(article).values([
      {
        slug: publishedSlug,
        title: `검증 공개글 ${SUFFIX}`,
        summary: "요약입니다.",
        content: bodyContent,
        categoryCode: "workshop",
        productId: sellingProduct.id,
        authorName: "검증 에디터",
        isFeatured: false,
        publishedAt: new Date("2020-01-01T00:00:00Z"),
      },
      {
        slug: draftSlug,
        title: `검증 미공개글 ${SUFFIX}`,
        content: "아직 발행하지 않은 글입니다.",
        categoryCode: "people",
        publishedAt: null,
      },
      {
        slug: scheduledSlug,
        title: `검증 예약글 ${SUFFIX}`,
        content: "미래에 공개될 글입니다.",
        categoryCode: "recipe",
        // 예약 발행 — 상태 컬럼 없이 시각만으로 감춰져야 한다
        publishedAt: new Date(Date.parse("2099-01-01T00:00:00Z")),
      },
    ]);

    console.log("\n[1] 목록 — 공개글만 최신순 기대");
    const listPage = await getStoryListPage(db);
    const allSlugs = [
      ...(listPage.featured ? [listPage.featured.slug] : []),
      ...listPage.cards.map((card) => card.slug),
    ];
    check(allSlugs.includes(publishedSlug), "공개글이 목록에 나온다");
    check(!allSlugs.includes(draftSlug), "미공개글은 목록에 없다");
    check(!allSlugs.includes(scheduledSlug), "예약글은 목록에 없다 — 시각만으로 감춰진다");

    const publishedDates = listPage.cards.map((card) => card.publishedAt.getTime());
    check(
      publishedDates.every((time, index) => index === 0 || publishedDates[index - 1] >= time),
      "목록은 최신순",
      publishedDates,
    );
    check(
      listPage.featured === null || !listPage.cards.some((c) => c.slug === listPage.featured?.slug),
      "대표 이야기는 아래 그리드에 중복되지 않는다",
    );

    console.log("\n[2] 카테고리 필터");
    check(
      listPage.categoryChips.every((chip) =>
        allSlugs.length === 0 ? true : chip.categoryName.length > 0,
      ),
      "칩은 한글 표시명을 갖는다(common_code 조인)",
      listPage.categoryChips,
    );
    const workshopPage = await getStoryListPage(db, { categoryCode: "workshop" });
    const workshopSlugs = [
      ...(workshopPage.featured ? [workshopPage.featured.slug] : []),
      ...workshopPage.cards.map((card) => card.slug),
    ];
    check(workshopSlugs.includes(publishedSlug), "작업장 필터에 해당 글이 나온다");
    check(workshopPage.activeCategoryCode === "workshop", "선택한 분류가 유지된다");

    const unknownPage = await getStoryListPage(db, { categoryCode: "no_such_category" });
    check(
      unknownPage.activeCategoryCode === null && unknownPage.cards.length === listPage.cards.length,
      "없는 분류를 넣으면 필터를 무시하고 전체를 보여준다 — 빈 화면보다 낫다",
    );

    console.log("\n[3] 상세 — 블록 분해·읽는 시간");
    const detail = await getStoryDetail(db, publishedSlug);
    check(detail !== null, "공개글 상세 조회");
    if (detail) {
      const kinds = detail.blocks.map((block) => block.blockKind);
      check(
        kinds.includes("paragraph") &&
          kinds.includes("quote") &&
          kinds.includes("subheading") &&
          kinds.includes("image"),
        "본문 4종 블록이 모두 분해된다",
        kinds,
      );
      const imageBlock = detail.blocks.find((block) => block.blockKind === "image");
      check(
        imageBlock?.blockKind === "image" && imageBlock.caption === "캡션입니다",
        "이미지 캡션이 대체텍스트로 쓰인다",
      );
      check(detail.readMinutes >= 1, `읽는 시간이 계산된다 (${detail.readMinutes}분)`);
      check(detail.categoryName === "작업장", "분류 코드가 한글명으로 바뀐다", detail.categoryName);
      check(detail.authorName === "검증 에디터", "저자 표기");
      check(
        !detail.otherStories.some(
          (other) => other.slug === draftSlug || other.slug === scheduledSlug,
        ),
        "'다른 이야기'에도 미공개·예약 글이 새지 않는다",
      );

      console.log("\n[4] 관련 제품");
      check(
        detail.relatedProduct?.slug === sellingProduct.slug,
        "판매중 상품이 연결된다",
        detail.relatedProduct,
      );
    }

    console.log("\n[5] 미공개·예약 글 상세 차단");
    check((await getStoryDetail(db, draftSlug)) === null, "미공개글 상세는 null");
    check((await getStoryDetail(db, scheduledSlug)) === null, "예약글 상세는 null");

    console.log("\n[6] 없는 slug");
    check((await getStoryDetail(db, `no-such-story-${SUFFIX}`)) === null, "없는 글은 null");
  } finally {
    if (temporarySlugs.length > 0) {
      await db.delete(article).where(inArray(article.slug, temporarySlugs));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
