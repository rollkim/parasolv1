/**
 * 기획전 스토어 조회 검증 (E1).
 * 실행: npm run check:promotion   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **기간·활성 판정이 목록과 상세에서 정확히 갈린다.**
 * 종료된 기획전이 목록에 남으면 "끝난 걸 파는 몰"이 되고, 상세가 404면 공유 링크가 죽는다.
 *
 * 시나리오: [0]★coupon_id 컬럼 [1]목록 필터(진행·예정만) [2]종료 임박순 [3]상세 상품 순서·쿠폰 스트립
 *           [4]종료 상세는 열리고 중지 상세는 닫힌다 [5]중지된 쿠폰은 스트립에서 빠진다
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { coupon, product, promotion, promotionProduct } from "@/db/schema";

import {
  getStorePromotionDetail,
  listStorePromotions,
} from "../promotion.service";

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
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  console.log("PaRaSOL 기획전 스토어 검증 (임시 데이터는 종료 시 삭제)");

  const productRows = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.status, "active"))
    .orderBy(product.id)
    .limit(2);
  if (productRows.length < 2) throw new Error("활성 상품 2개 필요 — npm run db:seed:dev 먼저 실행");

  const promotionIds: number[] = [];
  const couponIds: number[] = [];

  async function makePromotion(values: {
    slug: string;
    title: string;
    startsAt?: Date | null;
    endsAt?: Date | null;
    isActive?: boolean;
    couponId?: number | null;
    productIds?: number[];
  }) {
    const [created] = await db
      .insert(promotion)
      .values({
        slug: values.slug,
        title: values.title,
        startsAt: values.startsAt ?? null,
        endsAt: values.endsAt ?? null,
        couponId: values.couponId ?? null,
        isActive: values.isActive ?? true,
      })
      .returning({ id: promotion.id });
    promotionIds.push(created.id);
    const composition = values.productIds ?? [];
    if (composition.length > 0) {
      await db.insert(promotionProduct).values(
        composition.map((productId, index) => ({
          promotionId: created.id,
          productId,
          sortOrder: index,
        })),
      );
    }
    return created.id;
  }

  try {
    console.log("\n[0] ★coupon_id 컬럼이 실제로 있는가 (SQL 적용 확인)");
    await db.select({ probe: promotion.couponId }).from(promotion).limit(1);
    check(true, "promotion.coupon_id 조회 가능");

    console.log("\n[1] 목록 — 진행·예정만 나온다");
    const liveSlug = `ev-live-${SUFFIX}`;
    await makePromotion({
      slug: liveSlug,
      title: `진행중${SUFFIX}`,
      endsAt: new Date(Date.now() + 3 * DAY_MS),
      productIds: [productRows[0].id],
    });
    const upcomingSlug = `ev-soon-${SUFFIX}`;
    await makePromotion({
      slug: upcomingSlug,
      title: `예정${SUFFIX}`,
      startsAt: new Date(Date.now() + 5 * DAY_MS),
      endsAt: new Date(Date.now() + 10 * DAY_MS),
    });
    const endedSlug = `ev-ended-${SUFFIX}`;
    await makePromotion({
      slug: endedSlug,
      title: `종료${SUFFIX}`,
      endsAt: new Date(Date.now() - DAY_MS),
      productIds: [productRows[0].id],
    });
    const stoppedSlug = `ev-stop-${SUFFIX}`;
    await makePromotion({ slug: stoppedSlug, title: `중지${SUFFIX}`, isActive: false });

    const listed = await listStorePromotions(db);
    const listedSlugs = new Set(listed.map((card) => card.slug));
    check(listedSlugs.has(liveSlug), "진행 중은 목록에 있다");
    check(
      listedSlugs.has(upcomingSlug) &&
        listed.find((card) => card.slug === upcomingSlug)?.phase === "upcoming",
      "예정도 목록에 있다(phase=upcoming) — 숨기면 기대감을 만들 수 없다",
    );
    check(!listedSlugs.has(endedSlug), "종료는 목록에서 빠진다");
    check(!listedSlugs.has(stoppedSlug), "중지도 목록에서 빠진다");

    console.log("\n[2] 정렬 — 끝이 가까운 것부터");
    const liveIndex = listed.findIndex((card) => card.slug === liveSlug);
    const upcomingIndex = listed.findIndex((card) => card.slug === upcomingSlug);
    check(
      liveIndex !== -1 && upcomingIndex !== -1 && liveIndex < upcomingIndex,
      "종료가 이른 진행 중이 예정보다 앞",
      { liveIndex, upcomingIndex },
    );

    console.log("\n[3] 상세 — 상품 순서·쿠폰 스트립");
    const [stripCoupon] = await db
      .insert(coupon)
      .values({
        name: `기획전쿠폰${SUFFIX}`,
        type: "fixed",
        value: 3000,
        minOrderAmount: 30000,
        scope: "all",
        issueMethod: "download",
        perCustomerLimit: 1,
        isActive: true,
      })
      .returning({ id: coupon.id });
    couponIds.push(stripCoupon.id);

    const richSlug = `ev-rich-${SUFFIX}`;
    // 상품을 역순으로 담는다 — 순서가 id순이 아니라 담은 순서인지 확인
    await makePromotion({
      slug: richSlug,
      title: `구성${SUFFIX}`,
      endsAt: new Date(Date.now() + DAY_MS),
      couponId: stripCoupon.id,
      productIds: [productRows[1].id, productRows[0].id],
    });
    const richDetail = await getStorePromotionDetail(db, richSlug);
    check(richDetail !== null, "상세가 열린다");
    check(
      richDetail?.products.map((card) => card.productId).join(",") ===
        `${productRows[1].id},${productRows[0].id}`,
      "상품이 담은 순서 그대로 — 큐레이션이 곧 기획이다",
      richDetail?.products.map((card) => card.productId),
    );
    check(
      richDetail?.couponStrip?.couponId === stripCoupon.id &&
        richDetail.couponStrip.minOrderAmount === 30000,
      "쿠폰 스트립 재료가 내려온다",
      richDetail?.couponStrip,
    );

    console.log("\n[4] 종료 상세는 열리고, 중지 상세는 닫힌다");
    const endedDetail = await getStorePromotionDetail(db, endedSlug);
    check(
      endedDetail !== null && endedDetail.phase === "ended",
      "종료된 기획전도 상세는 열린다(phase=ended) — 공유 링크가 404가 되면 안 된다",
    );
    check(
      (await getStorePromotionDetail(db, stoppedSlug)) === null,
      "중지된 기획전 상세는 null — 운영자가 내린 것은 보이지 않는다",
    );

    console.log("\n[5] 중지된 쿠폰은 스트립에서 빠진다");
    await db.update(coupon).set({ isActive: false }).where(eq(coupon.id, stripCoupon.id));
    const afterStop = await getStorePromotionDetail(db, richSlug);
    check(
      afterStop?.couponStrip === null,
      "쿠폰을 중지하면 스트립만 사라진다 — 기획전은 그대로 열린다",
    );
  } finally {
    if (promotionIds.length > 0) {
      await db.delete(promotion).where(inArray(promotion.id, promotionIds));
    }
    if (couponIds.length > 0) {
      await db.delete(coupon).where(inArray(coupon.id, couponIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
