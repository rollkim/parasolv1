/**
 * 쿠폰 주문 금액 배선 검증 (C3).
 * 실행: npm run check:coupon-order   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **쿠폰을 쓴 만큼 청구액이 줄고, 주문·결제·쿠폰원장·적립 기준 네 곳의 숫자가 맞는다.**
 * 하나라도 어긋나면 고객이 덜 내거나 더 내고, 그 차이는 정산에서야 발견된다.
 *
 * 시나리오: [0]★쿠폰 입구가 주문 경로에 있는가 [0-b]★체크아웃 화면 목록 [1]정액 쿠폰 [2]정률·상한 [3]쿠폰+적립금 동시
 *           [4]최소주문금액 미달 거절 [5]범위(상품) 쿠폰 [6]비회원 차단 [7]위변조·중복 사용
 *           [8]주문 취소 시 쿠폰·적립금 동시 복원
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  coupon,
  couponIssue,
  customer,
  orders,
  payment,
  productVariant,
} from "@/db/schema";
import { calcExpiresAt } from "@/domain/point";

import { getCheckoutView } from "../checkout-view.service";
import { issueCouponToCustomer, CouponUseRejectedError } from "../coupon.service";
import { applyOrderTransition } from "../order-status.service";
import {
  GuestCouponUseError,
  createPendingOrder,
} from "../order.service";
import { earnPoints, getPointBalance } from "../point.service";
import { loadPointPolicy } from "../point-policy.service";
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

type Leftovers = {
  orderIds: number[];
  cartIds: number[];
  customerIds: number[];
  couponIds: number[];
};

async function expectRejected(
  run: () => Promise<unknown>,
  ErrorClass: new (...args: never[]) => Error,
): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (caught) {
    return caught instanceof ErrorClass;
  }
}

async function main() {
  console.log("PaRaSOL 쿠폰 주문 금액 검증 (임시 데이터는 종료 시 삭제)");

  const [variant] = await db
    .select({
      id: productVariant.id,
      productId: productVariant.productId,
      price: productVariant.price,
    })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], customerIds: [], couponIds: [] };

  /** 쿠폰 한 종을 만든다 */
  async function makeCoupon(values: {
    name: string;
    discountKind: "fixed" | "percent";
    discountValue: number;
    maxDiscount?: number | null;
    minOrderAmount?: number;
    scopeKind?: "all" | "category" | "product";
    scopeRefId?: number | null;
  }) {
    const [created] = await db
      .insert(coupon)
      .values({
        name: values.name,
        type: values.discountKind,
        value: values.discountValue,
        maxDiscount: values.maxDiscount ?? null,
        minOrderAmount: values.minOrderAmount ?? 0,
        scope: values.scopeKind ?? "all",
        scopeRefId: values.scopeRefId ?? null,
        issueMethod: "download",
        perCustomerLimit: 5,
        isActive: true,
      })
      .returning({ id: coupon.id });
    leftovers.couponIds.push(created.id);
    return created.id;
  }

  /** 주문 한 건을 만든다 — 수량으로 금액을 통제한다 */
  async function placeOrder(args: {
    customerId: number | null;
    quantity: number;
    couponIssueId?: number;
    pointToUse?: number;
  }) {
    const cartToken = `CPO-${randomUUID()}`;
    const [cartRow] = await db
      .insert(cart)
      .values({ sessionToken: cartToken, customerId: args.customerId })
      .returning({ id: cart.id });
    leftovers.cartIds.push(cartRow.id);
    await db
      .insert(cartItem)
      .values({ cartId: cartRow.id, variantId: variant.id, quantity: args.quantity });

    const created = await createPendingOrder(db, {
      cartToken,
      customerId: args.customerId,
      orderer: {
        name: `쿠폰주문${SUFFIX}`,
        phone: "010-5656-7878",
        email: `cpo-${SUFFIX}@example.com`,
      },
      shippingAddress: {
        recipient: `쿠폰주문${SUFFIX}`,
        phone: "010-5656-7878",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        addr2: null,
      },
      agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
      agreementIp: "127.0.0.1",
      couponIssueId: args.couponIssueId,
      pointToUse: args.pointToUse,
    });
    leftovers.orderIds.push(created.orderId);
    return created;
  }

  async function readOrderAmounts(orderId: number) {
    const [row] = await db
      .select({
        subtotal: orders.subtotal,
        shippingFee: orders.shippingFee,
        couponDiscount: orders.couponDiscount,
        pointUsed: orders.pointUsed,
        grandTotal: orders.grandTotal,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    const [paymentRow] = await db
      .select({ amount: payment.amount })
      .from(payment)
      .where(eq(payment.orderId, orderId));
    return { ...row, paymentAmount: paymentRow?.amount ?? null };
  }

  try {
    const [buyer] = await db
      .insert(customer)
      .values({ name: `쿠폰주문${SUFFIX}`, email: `cpo-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    leftovers.customerIds.push(buyer.id);

    /* 감사 교훈: 서비스가 맞는데 주문 경로에 연결되지 않으면 아무 일도 일어나지 않는다.
       이 절은 로직이 아니라 '쿠폰이 실제로 주문 금액을 바꾸는가'를 본다 */
    console.log("\n[0] ★쿠폰 입구가 주문 경로에 실제로 있는가");
    const flatCouponId = await makeCoupon({
      name: `정액5천${SUFFIX}`,
      discountKind: "fixed",
      discountValue: 5000,
    });
    const flatIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: flatCouponId, customerId: buyer.id }),
    );
    const withCoupon = await placeOrder({
      customerId: buyer.id,
      quantity: 2,
      couponIssueId: flatIssue.couponIssueId,
    });
    const withCouponAmounts = await readOrderAmounts(withCoupon.orderId);
    check(
      withCouponAmounts.couponDiscount === 5000,
      "★orders.coupon_discount가 0이 아니다 — 쿠폰이 주문 금액에 실제로 반영된다",
      withCouponAmounts,
    );

    console.log("\n[0-b] ★쿠폰 입구가 체크아웃 화면에도 있는가");
    // 감사 교훈: 서비스가 맞아도 화면에 목록이 안 내려가면 아무도 못 쓴다
    const viewCartToken = `CPO-VIEW-${randomUUID()}`;
    const [viewCart] = await db
      .insert(cart)
      .values({ sessionToken: viewCartToken, customerId: buyer.id })
      .returning({ id: cart.id });
    leftovers.cartIds.push(viewCart.id);
    await db.insert(cartItem).values({ cartId: viewCart.id, variantId: variant.id, quantity: 2 });

    const spareIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: flatCouponId, customerId: buyer.id }),
    );
    const memberCheckout = await getCheckoutView(db, {
      cartToken: viewCartToken,
      customerId: buyer.id,
    });
    const spareOption = memberCheckout.coupons.find(
      (option) => option.couponIssueId === spareIssue.couponIssueId,
    );
    check(
      spareOption !== undefined,
      "회원 주문서가 쿠폰 목록을 내려준다 — 없으면 화면에 선택지가 그려지지 않는다",
    );
    check(
      spareOption?.usable === true && spareOption.discountAmount === 5000,
      "★화면이 보여줄 할인액 == 주문 생성이 계산할 할인액 (같은 함수)",
      spareOption,
    );

    const guestCheckout = await getCheckoutView(db, {
      cartToken: viewCartToken,
      customerId: null,
    });
    check(
      guestCheckout.coupons.length === 0,
      "비회원 주문서는 쿠폰이 빈 배열 — 쿠폰은 회원에게 발급된다",
    );

    console.log("\n[1] 정액 쿠폰 — 청구액이 액면만큼 줄어든다");
    check(
      withCouponAmounts.grandTotal ===
        withCouponAmounts.subtotal - 5000 + withCouponAmounts.shippingFee,
      "청구액 = 상품금액 − 쿠폰 + 배송비",
      withCouponAmounts,
    );
    check(
      withCouponAmounts.paymentAmount === withCouponAmounts.grandTotal,
      "결제 대기 금액 == 주문 청구액 — 토스에 넘기는 금액이 여기서 나온다",
      withCouponAmounts,
    );
    check(
      withCoupon.grandTotal === withCouponAmounts.grandTotal,
      "서비스가 돌려준 금액도 같다 — 화면이 이 값으로 결제창을 연다",
    );
    const [usedIssue] = await db
      .select({ discountAmount: couponIssue.discountAmount, orderId: couponIssue.orderId })
      .from(couponIssue)
      .where(eq(couponIssue.id, flatIssue.couponIssueId));
    check(
      usedIssue.discountAmount === 5000 && usedIssue.orderId === withCoupon.orderId,
      "쿠폰 원장에도 같은 할인액·주문이 기록된다 — 반품 정산이 이 값을 쓴다",
      usedIssue,
    );

    console.log("\n[2] 정률 쿠폰 — 내림과 최대 할인액이 적용된다");
    // 10% · 최대 1,000원 → 상품금액이 얼마든 1,000원까지만
    const percentCouponId = await makeCoupon({
      name: `10퍼센트${SUFFIX}`,
      discountKind: "percent",
      discountValue: 100,
      maxDiscount: 1000,
    });
    const percentIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: percentCouponId, customerId: buyer.id }),
    );
    const percentOrder = await placeOrder({
      customerId: buyer.id,
      quantity: 2,
      couponIssueId: percentIssue.couponIssueId,
    });
    const percentAmounts = await readOrderAmounts(percentOrder.orderId);
    const expectedPercent = Math.min(1000, Math.floor((percentAmounts.subtotal * 100) / 1000));
    check(
      percentAmounts.couponDiscount === expectedPercent,
      `정률 할인 ${expectedPercent}원 (상한 1000)`,
      { got: percentAmounts.couponDiscount, expectedPercent, subtotal: percentAmounts.subtotal },
    );

    console.log("\n[3] 쿠폰 + 적립금 동시 사용 — 순서대로 깎인다");
    const policy = await loadPointPolicy(db);
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 5000,
        title: "검증용 사전 적립",
        tagCode: "manual",
        expiresAt: calcExpiresAt(new Date(), policy),
        dedupeKey: `check:${SUFFIX}:coupon-seed`,
      }),
    );
    const bothIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: flatCouponId, customerId: buyer.id }),
    );
    const bothOrder = await placeOrder({
      customerId: buyer.id,
      quantity: 2,
      couponIssueId: bothIssue.couponIssueId,
      pointToUse: 2000,
    });
    const bothAmounts = await readOrderAmounts(bothOrder.orderId);
    check(
      bothAmounts.couponDiscount === 5000 && bothAmounts.pointUsed === 2000,
      "쿠폰·적립금이 각각 기록된다",
      bothAmounts,
    );
    check(
      bothAmounts.grandTotal ===
        bothAmounts.subtotal - 5000 + bothAmounts.shippingFee - 2000,
      "★청구액 = 상품금액 − 쿠폰 + 배송비 − 적립금 (적용 순서)",
      bothAmounts,
    );
    check(
      bothAmounts.paymentAmount === bothAmounts.grandTotal,
      "결제 금액도 일치한다",
      bothAmounts,
    );

    console.log("\n[4] 최소 주문 금액 미달 — 거절 기대");
    const bigMinCouponId = await makeCoupon({
      name: `최소10만${SUFFIX}`,
      discountKind: "fixed",
      discountValue: 3000,
      minOrderAmount: 1_000_000,
    });
    const bigMinIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: bigMinCouponId, customerId: buyer.id }),
    );
    const minOrderBlocked = await expectRejected(
      () =>
        placeOrder({
          customerId: buyer.id,
          quantity: 1,
          couponIssueId: bigMinIssue.couponIssueId,
        }),
      CouponUseRejectedError,
    );
    check(minOrderBlocked, "최소 주문 금액에 못 미치면 주문이 거절된다");
    const [unusedAfterBlock] = await db
      .select({ usedAt: couponIssue.usedAt })
      .from(couponIssue)
      .where(eq(couponIssue.id, bigMinIssue.couponIssueId));
    check(
      unusedAfterBlock.usedAt === null,
      "거절된 주문이 쿠폰을 소모하지 않았다 — 롤백으로 미사용 상태가 유지된다",
    );

    console.log("\n[5] 범위(상품) 쿠폰 — 대상 상품이 있으면 적용, 없으면 거절");
    const scopedCouponId = await makeCoupon({
      name: `상품한정${SUFFIX}`,
      discountKind: "fixed",
      discountValue: 1000,
      scopeKind: "product",
      scopeRefId: variant.productId,
    });
    const scopedIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: scopedCouponId, customerId: buyer.id }),
    );
    const scopedOrder = await placeOrder({
      customerId: buyer.id,
      quantity: 1,
      couponIssueId: scopedIssue.couponIssueId,
    });
    const scopedAmounts = await readOrderAmounts(scopedOrder.orderId);
    check(scopedAmounts.couponDiscount === 1000, "대상 상품이 있으면 적용된다", scopedAmounts);

    const wrongScopeCouponId = await makeCoupon({
      name: `없는상품한정${SUFFIX}`,
      discountKind: "fixed",
      discountValue: 1000,
      scopeKind: "product",
      // 존재하지 않는 상품 id — 주문에 걸리는 라인이 없다
      scopeRefId: 999_999_999,
    });
    const wrongScopeIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: wrongScopeCouponId, customerId: buyer.id }),
    );
    const scopeBlocked = await expectRejected(
      () =>
        placeOrder({
          customerId: buyer.id,
          quantity: 1,
          couponIssueId: wrongScopeIssue.couponIssueId,
        }),
      CouponUseRejectedError,
    );
    check(scopeBlocked, "범위에 걸리는 상품이 없으면 거절된다 — 전체 할인으로 새지 않는다");

    console.log("\n[6] 비회원 — 쿠폰 사용 차단 기대");
    const guestBlocked = await expectRejected(
      () =>
        placeOrder({
          customerId: null,
          quantity: 1,
          couponIssueId: flatIssue.couponIssueId,
        }),
      GuestCouponUseError,
    );
    check(guestBlocked, "비회원은 쿠폰을 쓸 수 없다 — 쿠폰은 회원에게 발급된다");

    console.log("\n[7] 남의 쿠폰·이미 쓴 쿠폰 — 거절 기대");
    const reuseBlocked = await expectRejected(
      () =>
        placeOrder({
          customerId: buyer.id,
          quantity: 1,
          // [0]에서 이미 사용한 발급건
          couponIssueId: flatIssue.couponIssueId,
        }),
      CouponUseRejectedError,
    );
    check(reuseBlocked, "이미 쓴 쿠폰으로는 새 주문을 만들 수 없다");

    console.log("\n[8] 주문 취소 — 쿠폰·적립금이 함께 돌아온다");
    const balanceBeforeCancel = await getPointBalance(db, buyer.id);
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: bothOrder.orderId,
        toStatus: "cancelled",
        actor: { role: "customer", id: buyer.id },
        memo: "검증",
      }),
    );
    const [cancelledIssue] = await db
      .select({ usedAt: couponIssue.usedAt, orderId: couponIssue.orderId })
      .from(couponIssue)
      .where(eq(couponIssue.id, bothIssue.couponIssueId));
    check(
      cancelledIssue.usedAt === null && cancelledIssue.orderId === null,
      "★취소하면 쿠폰이 되돌아온다 (초크포인트)",
      cancelledIssue,
    );
    check(
      (await getPointBalance(db, buyer.id)) === balanceBeforeCancel + 2000,
      "적립금도 같은 전이에서 함께 복원된다 — 둘 중 하나만 돌아오는 일이 없다",
    );
  } finally {
    if (leftovers.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.couponIds.length > 0) {
      await db.delete(coupon).where(inArray(coupon.id, leftovers.couponIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    if (leftovers.customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, leftovers.customerIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
