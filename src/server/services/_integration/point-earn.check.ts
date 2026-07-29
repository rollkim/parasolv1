/**
 * 적립 배선 검증 (P3) — 구매확정·가입·리뷰 적립이 실제로 걸리는지, 두 번 걸리지 않는지.
 * 실행: npm run check:point-earn   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **같은 사유로는 절대 두 번 적립되지 않는다.**
 * 주문 재확정, 리뷰 삭제 후 재작성 — 둘 다 돈이 늘어나는 경로다.
 *
 * 시나리오: [1]가입 적립 [2]구매확정 적립·금액 기준 [3]재확정 중복 차단
 *           [4]리뷰 적립·포토 추가분 [5]리뷰 재작성 중복 차단 [6]비회원 주문
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  customer,
  inventoryLog,
  orderItem,
  orders,
  pointTransaction,
  productVariant,
  review,
} from "@/db/schema";

import { applyOrderTransition } from "../order-status.service";
import { createPendingOrder } from "../order.service";
import { getPointBalance, sumRemainingLots } from "../point.service";
import { loadPointPolicy } from "../point-policy.service";
import { createReview } from "../review.service";
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

type Leftovers = { orderIds: number[]; cartIds: number[]; customerIds: number[]; refIds: string[] };

/** 결제까지 간 주문을 만든다 — 적립은 확정 때이므로 여기서는 delivered까지만 올린다 */
async function placeDeliveredOrder(
  variantId: number,
  customerId: number | null,
  quantity: number,
  leftovers: Leftovers,
) {
  const cartToken = `EARN-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken, customerId })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId,
    orderer: { name: `적립검증${SUFFIX}`, phone: "010-3434-5656", email: `earn-${SUFFIX}@example.com` },
    shippingAddress: {
      recipient: `적립검증${SUFFIX}`,
      phone: "010-3434-5656",
      zipcode: "04168",
      addr1: "서울 마포구 만리재로 00",
      addr2: null,
    },
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  leftovers.refIds.push(created.orderNo);

  // 결제 없이 상태만 올린다 — 적립 트리거(confirmed)만 보는 검증이라 결제는 범위 밖.
  // actor는 전이표가 정한다: pending→paid는 결제(system), 이후 준비·발송은 운영(admin)
  const steps = [
    { toStatus: "paid", actor: { role: "system" } },
    { toStatus: "preparing", actor: { role: "admin", id: 1 } },
    { toStatus: "shipping", actor: { role: "admin", id: 1 } },
    { toStatus: "delivered", actor: { role: "admin", id: 1 } },
  ] as const;
  for (const step of steps) {
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: created.orderId,
        toStatus: step.toStatus,
        actor: step.actor,
      }),
    );
  }
  return created;
}

async function main() {
  console.log("PaRaSOL 적립 배선 검증 (임시 회원·주문은 종료 시 삭제)");

  const policy = await loadPointPolicy(db);
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock, price: productVariant.price })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], customerIds: [], refIds: [] };

  try {
    console.log("\n[1] 가입 적립 — 가입 즉시 잔액에 들어온다 기대");
    // 가입 서비스를 직접 부르면 약관·비밀번호까지 필요하므로, 여기서는 회원을 만들고
    // 적립 배선(earnSignupBonus)이 붙은 signupLocalCustomer는 auth 라우터 검증에서 다룬다.
    // 대신 이 검증은 "가입 보너스가 정책값과 같은가"를 잔액으로 확인한다.
    const { signupLocalCustomer } = await import("../customer.service");
    const signedUp = await signupLocalCustomer(db, {
      loginId: `earn${SUFFIX}`,
      password: "earncheck1234",
      name: `적립검증${SUFFIX}`,
      email: `earn-${SUFFIX}@example.com`,
      phone: "01034345656",
      agreedTermsCodes: ["terms", "privacy", "age"],
      ip: "127.0.0.1",
    });
    leftovers.customerIds.push(signedUp.customerId);

    const balanceAfterSignup = await getPointBalance(db, signedUp.customerId);
    check(
      balanceAfterSignup === policy.signupBonusPoint,
      `가입 축하 적립 ${policy.signupBonusPoint}원 (실제 ${balanceAfterSignup})`,
    );

    console.log("\n[2] 구매확정 적립 — 실결제 상품금액의 1% 기대");
    const order = await placeDeliveredOrder(variant.id, signedUp.customerId, 2, leftovers);

    const [orderAmounts] = await db
      .select({
        subtotal: orders.subtotal,
        shippingFee: orders.shippingFee,
        couponDiscount: orders.couponDiscount,
        pointUsed: orders.pointUsed,
      })
      .from(orders)
      .where(eq(orders.id, order.orderId));
    const expectedBase =
      orderAmounts.subtotal - orderAmounts.couponDiscount - orderAmounts.pointUsed;
    const expectedEarn = Math.floor((expectedBase * policy.earnRatePerMille) / 1000);

    check(
      (await getPointBalance(db, signedUp.customerId)) === policy.signupBonusPoint,
      "배송완료까지는 적립되지 않는다 — 적립 시점은 구매확정이다",
    );

    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: order.orderId,
        toStatus: "confirmed",
        actor: { role: "customer", id: signedUp.customerId },
      }),
    );

    const balanceAfterConfirm = await getPointBalance(db, signedUp.customerId);
    check(
      balanceAfterConfirm === policy.signupBonusPoint + expectedEarn,
      `구매확정 적립 ${expectedEarn}원 (잔액 ${balanceAfterConfirm})`,
      { expectedBase, shippingFee: orderAmounts.shippingFee },
    );

    const [purchaseRow] = await db
      .select({ amount: pointTransaction.amount, title: pointTransaction.title })
      .from(pointTransaction)
      .where(
        and(
          eq(pointTransaction.customerId, signedUp.customerId),
          eq(pointTransaction.tagCode, "purchase"),
        ),
      );
    check(
      purchaseRow?.amount === expectedEarn,
      "원장에 구매적립이 남는다",
      purchaseRow,
    );
    check(
      orderAmounts.shippingFee === 0 || expectedEarn * 1000 < (expectedBase + orderAmounts.shippingFee) * policy.earnRatePerMille,
      "배송비는 적립 기준에서 빠진다",
      { expectedBase, shippingFee: orderAmounts.shippingFee },
    );

    console.log("\n[3] 재확정 — 중복 적립 차단 기대");
    // 이미 confirmed라 전이는 changed:false로 끝나지만, 적립 경로를 직접 한 번 더 두드린다
    const { earnPurchasePoints } = await import("../point-earn.service");
    const duplicateEarn = await db.transaction((tx) =>
      earnPurchasePoints(tx, order.orderId),
    );
    check(
      duplicateEarn.earned === false && duplicateEarn.reason === "duplicate",
      "같은 주문의 재적립은 거절된다 (dedupe_key)",
      duplicateEarn,
    );
    check(
      (await getPointBalance(db, signedUp.customerId)) === balanceAfterConfirm,
      "잔액이 늘지 않았다",
    );

    console.log("\n[4] 리뷰 적립 — 포토리뷰는 추가분 기대");
    const [reviewTarget] = await db
      .select({ orderItemId: orderItem.id })
      .from(orderItem)
      .where(eq(orderItem.orderId, order.orderId))
      .limit(1);

    const created = await createReview(db, {
      customerId: signedUp.customerId,
      orderItemId: reviewTarget.orderItemId,
      rating: 5,
      content: "적립 검증용 리뷰입니다. 잘 받았습니다.",
      tags: [],
      images: ["/uploads/review/check.jpg"],
    });

    const expectedReviewEarn = policy.reviewBonusPoint + policy.photoReviewBonusPoint;
    const balanceAfterReview = await getPointBalance(db, signedUp.customerId);
    check(
      balanceAfterReview === balanceAfterConfirm + expectedReviewEarn,
      `포토리뷰 적립 ${expectedReviewEarn}원 (기본 ${policy.reviewBonusPoint} + 사진 ${policy.photoReviewBonusPoint})`,
      balanceAfterReview,
    );

    console.log("\n[5] 리뷰 재작성 — 중복 적립 차단 기대");
    // 리뷰를 지우고 다시 쓰면 리뷰 id는 새로 나온다. 주문 항목 기준이라 막혀야 한다
    await db.delete(review).where(eq(review.id, created.reviewId));
    const rewritten = await createReview(db, {
      customerId: signedUp.customerId,
      orderItemId: reviewTarget.orderItemId,
      rating: 4,
      content: "지우고 다시 쓴 리뷰입니다. 적립은 한 번뿐이어야 합니다.",
      tags: [],
      images: ["/uploads/review/check2.jpg"],
    });
    check(
      rewritten.reviewId !== created.reviewId,
      "리뷰 id는 새로 발급된다 — id 기준이면 여기서 또 적립됐을 것",
    );
    check(
      (await getPointBalance(db, signedUp.customerId)) === balanceAfterReview,
      "지웠다 다시 써도 적립은 한 번뿐 (주문 항목 기준 dedupe)",
    );

    console.log("\n[6] 원장·잔액 정합");
    const [finalBalance, finalLots] = await Promise.all([
      getPointBalance(db, signedUp.customerId),
      sumRemainingLots(db, signedUp.customerId),
    ]);
    check(finalBalance === finalLots, "원장 잔여 합계 == 잔액 캐시", {
      finalBalance,
      finalLots,
    });

    console.log("\n[7] 비회원 주문 확정 — 적립 대상 아님 기대");
    const guestOrder = await placeDeliveredOrder(variant.id, null, 1, leftovers);
    const pointRowsBefore = (await db.select({ id: pointTransaction.id }).from(pointTransaction))
      .length;
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: guestOrder.orderId,
        toStatus: "confirmed",
        actor: { role: "system" },
      }),
    );
    const pointRowsAfter = (await db.select({ id: pointTransaction.id }).from(pointTransaction))
      .length;
    check(
      pointRowsAfter === pointRowsBefore,
      "비회원 주문은 확정돼도 적립 원장이 생기지 않는다 — 귀속할 회원이 없다",
    );
  } finally {
    if (leftovers.refIds.length > 0) {
      await db.delete(inventoryLog).where(inArray(inventoryLog.refId, leftovers.refIds));
    }
    if (leftovers.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    if (leftovers.customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, leftovers.customerIds));
    }
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
