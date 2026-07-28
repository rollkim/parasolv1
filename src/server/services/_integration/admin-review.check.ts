/**
 * 관리자 리뷰 관리 검증 — 목록·답글·숨김·신고 처리를 실제 DB에서 확인한다.
 * 실행: npm run check:admin-review   (SSH 터널 켠 상태)
 *
 * 핵심 검증은 **별점 캐시 정합**이다. 숨긴 리뷰가 계속 평균에 들어가면
 * "1점짜리 스팸을 숨겼는데 평점이 그대로"가 되고, 운영자는 숨김이 안 먹혔다고 생각한다.
 *
 * 시나리오: [1]목록·탭·별점 필터 [2]답글(등록·삭제) [3]숨김이 별점 캐시에 반영
 *           [4]다시 노출하면 복원 [5]신고 반려 [6]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adminUser, product, review, reviewReport } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

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

async function adminCaller(adminUserId: number) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(adminUserId))
    .setAudience("admin")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const headers = new Headers({ cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}` });
  return createCaller(await createTRPCContext({ headers }));
}

const SUFFIX = randomUUID().slice(0, 8);

/** 상품의 별점 캐시를 직접 읽는다 — 서비스가 맞췄는지 대조할 기준 */
async function readRatingCache(productId: number) {
  const [row] = await db
    .select({ reviewCount: product.reviewCount, ratingSum: product.ratingSum })
    .from(product)
    .where(eq(product.id, productId));
  return row;
}

async function main() {
  console.log("PaRaSOL 관리자 리뷰 관리 검증 (임시 리뷰는 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const [targetProduct] = await db
    .select({ id: product.id, reviewCount: product.reviewCount, ratingSum: product.ratingSum })
    .from(product)
    .orderBy(product.id)
    .limit(1);
  if (!targetProduct) throw new Error("상품 없음 — npm run db:seed:dev 먼저 실행");

  const createdReviewIds: number[] = [];

  try {
    const caller = await adminCaller(admin.id);

    // 검증용 리뷰 3건 — 5점·5점·1점(스팸). 캐시 기준선을 여기서 만든다
    for (const [reviewIndex, rating] of [5, 5, 1].entries()) {
      const [inserted] = await db
        .insert(review)
        .values({
          productId: targetProduct.id,
          rating,
          content:
            rating === 1
              ? `광고성 도배 리뷰 ${SUFFIX} http://spam.example`
              : `맛있게 잘 먹었습니다 ${SUFFIX} #${reviewIndex}`,
          images: rating === 1 ? [] : ["products/202607/sample.jpg"],
        })
        .returning({ id: review.id });
      createdReviewIds.push(inserted.id);
    }
    const spamReviewId = createdReviewIds[2];

    // 캐시를 리뷰 상태에 맞춰 놓는다(리뷰 작성 기능이 아직 없어 시드 값이 0이다)
    await db
      .update(product)
      .set({
        reviewCount: targetProduct.reviewCount + 3,
        ratingSum: targetProduct.ratingSum + 11,
      })
      .where(eq(product.id, targetProduct.id));

    console.log("\n[1] 목록 — 탭·별점 필터 기대");
    const allList = await caller.adminReview.list({});
    check(allList.totalCount >= 3, `전체 ${allList.totalCount}건`);
    check(
      allList.tabCounts.unanswered >= 3,
      `미답변 ${allList.tabCounts.unanswered}건 — 방금 만든 3건은 답글이 없다`,
    );

    const oneStar = await caller.adminReview.list({ rating: 1 });
    check(
      oneStar.cards.every((card) => card.rating === 1),
      "별점 필터가 1점만 남긴다",
    );
    check(
      oneStar.cards.some((card) => card.reviewId === spamReviewId),
      "스팸 리뷰가 1점 필터에 잡힌다",
    );

    const searched = await caller.adminReview.list({ keyword: SUFFIX });
    check(searched.totalCount === 3, `내용 검색으로 3건 (${searched.totalCount})`);
    const photoCard = searched.cards.find((card) => card.rating === 5);
    check(photoCard?.imageCount === 1, "사진 수가 카드에 나온다", photoCard?.imageCount);

    console.log("\n[2] 답글 — 등록과 삭제 기대");
    await caller.adminReview.reply({ reviewId: createdReviewIds[0], reply: "감사합니다!" });
    const afterReply = await caller.adminReview.list({ keyword: SUFFIX });
    const repliedCard = afterReply.cards.find((card) => card.reviewId === createdReviewIds[0]);
    check(
      repliedCard?.adminReply === "감사합니다!" && repliedCard.adminReplyAt !== null,
      "답글과 답변 시각이 함께 기록된다",
      { reply: repliedCard?.adminReply, at: repliedCard?.adminReplyAt },
    );

    await caller.adminReview.reply({ reviewId: createdReviewIds[0], reply: "   " });
    const afterClear = await caller.adminReview.list({ keyword: SUFFIX });
    const clearedCard = afterClear.cards.find((card) => card.reviewId === createdReviewIds[0]);
    check(
      clearedCard?.adminReply === null && clearedCard.adminReplyAt === null,
      "답글을 지우면 시각도 지워진다 — 답글 없이 시각만 남으면 '답변함'으로 집계된다",
      { reply: clearedCard?.adminReply, at: clearedCard?.adminReplyAt },
    );

    console.log("\n[3] 숨김 — 상품 별점 캐시에 반영 기대");
    const cacheBefore = await readRatingCache(targetProduct.id);
    const hideResult = await caller.adminReview.setHidden({
      reviewId: spamReviewId,
      isHidden: true,
    });
    check(hideResult.isHidden, "숨김 반영");

    const cacheAfterHide = await readRatingCache(targetProduct.id);
    check(
      cacheAfterHide.reviewCount === cacheBefore.reviewCount - 1,
      `리뷰 수가 1 줄었다 (${cacheBefore.reviewCount} → ${cacheAfterHide.reviewCount})`,
    );
    check(
      cacheAfterHide.ratingSum === cacheBefore.ratingSum - 1,
      `별점 합에서 1점이 빠졌다 (${cacheBefore.ratingSum} → ${cacheAfterHide.ratingSum}) — 스팸을 숨겼는데 평점이 그대로면 숨김이 안 먹힌 것으로 보인다`,
    );

    const hiddenTab = await caller.adminReview.list({ tab: "hidden" });
    check(
      hiddenTab.cards.some((card) => card.reviewId === spamReviewId),
      "숨김 탭에 잡힌다",
    );

    console.log("\n[4] 다시 노출 — 캐시 복원 기대");
    await caller.adminReview.setHidden({ reviewId: spamReviewId, isHidden: false });
    const cacheAfterShow = await readRatingCache(targetProduct.id);
    check(
      cacheAfterShow.reviewCount === cacheBefore.reviewCount &&
        cacheAfterShow.ratingSum === cacheBefore.ratingSum,
      "노출로 되돌리면 캐시도 돌아온다 — 증감이 아니라 다시 세기 때문",
      cacheAfterShow,
    );

    console.log("\n[5] 신고 처리 — 반려 기대");
    await db.insert(reviewReport).values([
      { reviewId: spamReviewId, reason: "광고/스팸" },
      { reviewId: spamReviewId, reason: "욕설" },
    ]);
    await db.update(review).set({ reportCount: 2 }).where(eq(review.id, spamReviewId));

    const reportedTab = await caller.adminReview.list({ tab: "reported" });
    const reportedCard = reportedTab.cards.find((card) => card.reviewId === spamReviewId);
    check(reportedCard?.reportCount === 2, `신고 2건 표시 (${reportedCard?.reportCount})`);
    check(
      reportedCard?.pendingReportReasons.includes("광고/스팸") === true &&
        reportedCard.pendingReportReasons.includes("욕설"),
      "신고 사유가 함께 온다 — 반려할지 숨길지는 사유를 봐야 정한다",
      reportedCard?.pendingReportReasons,
    );

    const dismissed = await caller.adminReview.dismissReports({ reviewId: spamReviewId });
    check(dismissed.dismissedCount === 2, `신고 2건 반려 (${dismissed.dismissedCount})`);

    const afterDismiss = await caller.adminReview.list({ keyword: SUFFIX });
    const dismissedCard = afterDismiss.cards.find((card) => card.reviewId === spamReviewId);
    check(
      dismissedCard?.reportCount === 0 && dismissedCard.pendingReportReasons.length === 0,
      "반려 후 배지와 사유가 사라진다",
    );

    const handledReports = await db
      .select({ handledAt: reviewReport.handledAt })
      .from(reviewReport)
      .where(eq(reviewReport.reviewId, spamReviewId));
    check(
      handledReports.every((row) => row.handledAt !== null),
      "신고 원본은 남고 처리 시각이 찍힌다 — 기록을 지우지 않는다",
    );

    console.log("\n[6] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let listForbidden = false;
    let hideForbidden = false;
    try {
      await anonymous.adminReview.list({});
    } catch (error) {
      listForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminReview.setHidden({ reviewId: spamReviewId, isHidden: true });
    } catch (error) {
      hideForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(listForbidden, "관리자 세션 없이는 리뷰 목록 조회 불가");
    check(hideForbidden, "관리자 세션 없이는 리뷰 숨김 불가");
  } finally {
    if (createdReviewIds.length > 0) {
      await db.delete(review).where(inArray(review.id, createdReviewIds));
    }
    // 캐시를 원래대로 — 검증이 끝난 뒤 스토어 별점이 남아 있으면 안 된다
    await db
      .update(product)
      .set({ reviewCount: targetProduct.reviewCount, ratingSum: targetProduct.ratingSum })
      .where(eq(product.id, targetProduct.id));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
