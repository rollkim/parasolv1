/**
 * 스토어 리뷰·상품문의 검증 — 실제 DB에서 확인한다.
 * 실행: npm run check:review-qna   (SSH 터널 켠 상태)
 *
 * 핵심 검증 둘:
 *   ① **산 사람만 쓴다** — 미구매·미배송·중복을 각각 막는지. 열려 있으면 광고가 들어온다.
 *   ② **비밀글은 본문을 내려보내지 않는다** — 화면에서 가리는 방식은 응답을 열어보면 그대로 보인다.
 *
 * 시나리오: [1]구매 검증 3종 [2]작성 → 별점 캐시 반영 [3]목록·마스킹
 *           [4]비밀글 노출 차단 [5]관리자 숨김이 스토어에 반영 [6]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  adminUser,
  cart,
  cartItem,
  customer,
  customerAuth,
  inventoryLog,
  orderItem,
  orders,
  post,
  product,
  productVariant,
  review,
} from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

import { createStubPaymentGateway } from "../../payments/stub-payment-gateway";
import { createPendingOrder } from "../order.service";
import { applyOrderTransition } from "../order-status.service";
import { confirmPayment } from "../payment.service";
import { getRequiredTermsDocumentIds } from "../terms.service";

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

async function customerCaller(customerId: number) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(customerId))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const headers = new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` });
  return createCaller(await createTRPCContext({ headers }));
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

type Leftovers = { orderIds: number[]; cartIds: number[]; customerIds: number[]; refIds: string[] };

async function main() {
  console.log("PaRaSOL 리뷰·상품문의 검증 (임시 데이터는 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const [variant] = await db
    .select({ id: productVariant.id, productId: productVariant.productId, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const [originalRating] = await db
    .select({ reviewCount: product.reviewCount, ratingSum: product.ratingSum })
    .from(product)
    .where(eq(product.id, variant.productId));

  const leftovers: Leftovers = { orderIds: [], cartIds: [], customerIds: [], refIds: [] };

  try {
    // 리뷰어(구매자)와 제3자 두 명을 만든다 — 남의 주문에 리뷰를 못 다는지 봐야 한다
    const [buyer] = await db
      .insert(customer)
      .values({ name: `구매자${SUFFIX}`, email: `buyer-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    const [stranger] = await db
      .insert(customer)
      .values({ name: `제3자${SUFFIX}`, email: `other-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    leftovers.customerIds.push(buyer.id, stranger.id);
    await db.insert(customerAuth).values([
      { customerId: buyer.id, provider: "local", providerUid: `buyer-${SUFFIX}@example.com`, passwordHash: "x" },
      { customerId: stranger.id, provider: "local", providerUid: `other-${SUFFIX}@example.com`, passwordHash: "x" },
    ]);

    // 구매자의 결제 완료 주문
    const cartToken = `REVIEW-${randomUUID()}`;
    const [cartRow] = await db
      .insert(cart)
      .values({ sessionToken: cartToken, customerId: buyer.id })
      .returning({ id: cart.id });
    leftovers.cartIds.push(cartRow.id);
    await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: 1 });

    const created = await createPendingOrder(db, {
      cartToken,
      customerId: buyer.id,
      orderer: { name: `구매자${SUFFIX}`, phone: "010-3434-5656", email: `buyer-${SUFFIX}@example.com` },
      shippingAddress: {
        recipient: `구매자${SUFFIX}`,
        phone: "010-3434-5656",
        zipcode: "04168",
        addr1: "서울특별시 마포구 만리재로 00",
      },
      agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
      agreementIp: "127.0.0.1",
    });
    leftovers.orderIds.push(created.orderId);
    leftovers.refIds.push(created.orderNo);

    const { gateway } = createStubPaymentGateway();
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: `STUB-${randomUUID()}`,
      amount: created.grandTotal,
      cartToken,
    });

    const [purchasedItem] = await db
      .select({ id: orderItem.id })
      .from(orderItem)
      .where(eq(orderItem.orderId, created.orderId));

    const buyerCaller = await customerCaller(buyer.id);
    const strangerCaller = await customerCaller(stranger.id);

    console.log("\n[1] 구매 검증 — 미배송·타인·중복 차단 기대");
    let notDelivered = false;
    try {
      await buyerCaller.review.create({
        orderItemId: purchasedItem.id,
        rating: 5,
        content: "아직 안 왔는데 씁니다 테스트",
        tags: [],
        images: [],
      });
    } catch (error) {
      notDelivered = error instanceof Error && /받으신 뒤에/.test(error.message);
    }
    check(notDelivered, "배송 전에는 쓸 수 없다");

    for (const status of ["preparing", "shipping", "delivered"] as const) {
      await db.transaction((tx) =>
        applyOrderTransition(tx, {
          orderId: created.orderId,
          toStatus: status,
          actor: { role: "admin", id: admin.id },
          memo: "리뷰 검증",
        }),
      );
    }

    let strangerBlocked = false;
    try {
      await strangerCaller.review.create({
        orderItemId: purchasedItem.id,
        rating: 5,
        content: "남의 주문에 리뷰를 답니다 테스트",
        tags: [],
        images: [],
      });
    } catch (error) {
      strangerBlocked = error instanceof Error && /구매하신 상품에만/.test(error.message);
    }
    check(
      strangerBlocked,
      "남의 주문 항목에는 쓸 수 없다 — 존재 여부도 알려주지 않고 '미구매'로 끝난다",
    );

    console.log("\n[2] 작성 — 별점 캐시가 함께 맞춰진다 기대");
    const beforeRating = (
      await db
        .select({ reviewCount: product.reviewCount, ratingSum: product.ratingSum })
        .from(product)
        .where(eq(product.id, variant.productId))
    )[0];

    const createdReview = await buyerCaller.review.create({
      orderItemId: purchasedItem.id,
      rating: 4,
      content: `포장이 꼼꼼하고 맛도 좋았습니다 ${SUFFIX}`,
      tags: [],
      images: [],
    });
    check(createdReview.productId === variant.productId, "리뷰가 상품에 붙는다");

    const afterRating = (
      await db
        .select({ reviewCount: product.reviewCount, ratingSum: product.ratingSum })
        .from(product)
        .where(eq(product.id, variant.productId))
    )[0];
    check(
      afterRating.reviewCount === beforeRating.reviewCount + 1 &&
        afterRating.ratingSum === beforeRating.ratingSum + 4,
      `별점 캐시 +1건 +4점 (${beforeRating.ratingSum} → ${afterRating.ratingSum}) — 작성 즉시 카드 별점이 맞아야 한다`,
    );

    let duplicateBlocked = false;
    try {
      await buyerCaller.review.create({
        orderItemId: purchasedItem.id,
        rating: 5,
        content: "같은 주문 상품에 두 번째 리뷰 테스트",
        tags: [],
        images: [],
      });
    } catch (error) {
      duplicateBlocked = error instanceof Error && /이미 리뷰를 작성/.test(error.message);
    }
    check(duplicateBlocked, "구매 1건당 리뷰 1개");

    const reviewable = await buyerCaller.review.listReviewable();
    check(
      !reviewable.some((item) => item.orderItemId === purchasedItem.id),
      "쓴 상품은 '리뷰 쓸 상품'에서 빠진다",
    );

    console.log("\n[3] 목록 — 마스킹 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    const reviewList = await anonymous.review.listByProduct({ productId: variant.productId });
    const listedReview = reviewList.cards.find((card) => card.content.includes(SUFFIX));
    check(listedReview !== undefined, "비로그인도 리뷰를 볼 수 있다");
    check(
      listedReview?.authorName.includes("**") === true &&
        !listedReview.authorName.includes(SUFFIX),
      "작성자 이름은 마스킹된다",
      listedReview?.authorName,
    );
    check(listedReview?.rating === 4, "별점 표시", listedReview?.rating);

    console.log("\n[4] 상품 문의 — 비밀글 본문이 새지 않는다 기대");
    const secretQna = await buyerCaller.support.productQna.create({
      productId: variant.productId,
      categoryCode: "product",
      title: `비밀 문의 ${SUFFIX}`,
      content: `이건 비밀입니다 ${SUFFIX}`,
      isSecret: true,
    });

    const anonymousQnas = await anonymous.support.productQna.list({
      productId: variant.productId,
    });
    const anonymousView = anonymousQnas.cards.find(
      (card) => card.qnaPostId === secretQna.qnaPostId,
    );
    check(
      anonymousView?.content === null && anonymousView.title === "비밀글입니다",
      "제3자에게는 제목·본문이 아예 내려가지 않는다 — 가리기만 하면 응답을 열어보면 보인다",
      { title: anonymousView?.title, content: anonymousView?.content },
    );

    const ownerQnas = await buyerCaller.support.productQna.list({
      productId: variant.productId,
    });
    const ownerView = ownerQnas.cards.find((card) => card.qnaPostId === secretQna.qnaPostId);
    check(
      ownerView?.content?.includes(SUFFIX) === true,
      "작성자 본인에게는 내용이 보인다",
      ownerView?.content,
    );

    const publicQna = await anonymous.support.productQna.create({
      productId: variant.productId,
      categoryCode: "product",
      title: `공개 문의 ${SUFFIX}`,
      content: `배송 얼마나 걸리나요 ${SUFFIX}`,
      isSecret: false,
      guestName: "비회원검증",
      guestPhone: "010-1212-3434",
      guestPassword: "abcd1234",
    });
    const afterPublic = await anonymous.support.productQna.list({
      productId: variant.productId,
    });
    check(
      afterPublic.cards.some((card) => card.qnaPostId === publicQna.qnaPostId),
      "비회원도 상품 문의를 남길 수 있다",
    );
    const publicCard = afterPublic.cards.find((card) => card.qnaPostId === publicQna.qnaPostId);
    check(
      publicCard?.content?.includes(SUFFIX) === true && publicCard.isAnswered === false,
      "공개 문의는 본문이 보이고 답변 대기 상태다",
    );

    console.log("\n[5] 관리자 숨김 — 스토어에서 사라진다 기대");
    const adminApi = await adminCaller(admin.id);
    await adminApi.adminReview.setHidden({ reviewId: createdReview.reviewId, isHidden: true });

    const afterHide = await anonymous.review.listByProduct({ productId: variant.productId });
    check(
      !afterHide.cards.some((card) => card.reviewId === createdReview.reviewId),
      "숨긴 리뷰는 스토어 목록에서 빠진다",
    );
    const hiddenRating = (
      await db
        .select({ ratingSum: product.ratingSum })
        .from(product)
        .where(eq(product.id, variant.productId))
    )[0];
    check(
      hiddenRating.ratingSum === beforeRating.ratingSum,
      "별점 캐시도 원래대로 — 관리자와 스토어가 같은 계산을 쓴다",
      hiddenRating,
    );

    const stillMine = await buyerCaller.review.listMine();
    check(
      stillMine.some((row) => row.reviewId === createdReview.reviewId && row.isHidden),
      "본인에게는 '비공개 처리됨'으로 보인다 — 사라지면 왜 없는지 알 수 없다",
    );

    console.log("\n[6] 권한 — 비로그인 작성 차단 기대");
    let anonymousWriteBlocked = false;
    try {
      await anonymous.review.create({
        orderItemId: purchasedItem.id,
        rating: 5,
        content: "비로그인 작성 시도 테스트입니다",
        tags: [],
        images: [],
      });
    } catch {
      anonymousWriteBlocked = true;
    }
    check(anonymousWriteBlocked, "비로그인은 리뷰를 쓸 수 없다");
  } finally {
    await db.delete(post).where(inArray(post.productId, [variant.productId]));
    if (leftovers.refIds.length > 0) {
      await db.delete(inventoryLog).where(inArray(inventoryLog.refId, leftovers.refIds));
    }
    if (leftovers.orderIds.length > 0) {
      await db.delete(review).where(inArray(review.productId, [variant.productId]));
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    if (leftovers.customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, leftovers.customerIds));
    }
    await db
      .update(product)
      .set({ reviewCount: originalRating.reviewCount, ratingSum: originalRating.ratingSum })
      .where(eq(product.id, variant.productId));
    await db
      .update(productVariant)
      .set({ stock: variant.stock })
      .where(eq(productVariant.id, variant.id));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
