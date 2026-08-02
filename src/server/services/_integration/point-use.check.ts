/**
 * 적립금 사용 검증 (P4) — 체크아웃에서 적립금이 결제 금액을 정확히 줄이는지.
 * 실행: npm run check:point-use   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **적립금을 쓴 만큼 청구액이 줄고, 원장·잔액·주문·결제 네 곳의 숫자가 모두 맞는다.**
 * 하나라도 어긋나면 고객이 덜 내거나 더 내고, 그 차이는 정산에서야 발견된다.
 *
 * 시나리오: [0]★앱 안에 입구가 있는가(주문서·마이페이지) [1]사용 없는 주문 [2]사용 주문의 금액 4곳 일치 [3]정책 위반 거절
 *           [4]잔액 초과 거절 [5]비회원 차단 [6]주문 취소 시 복원 [7]위변조 시도
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  customer,
  inventoryLog,
  orders,
  payment,
  productVariant,
} from "@/db/schema";
import { calcExpiresAt } from "@/domain/point";

import { getCheckoutView } from "../checkout-view.service";
import { getPointHistory, getPointSummary } from "../point-history.service";
import { applyOrderTransition } from "../order-status.service";
import {
  GuestPointUseError,
  PointUseRejectedError,
  createPendingOrder,
} from "../order.service";
import { earnPoints, getPointBalance, sumRemainingLots } from "../point.service";
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

type Leftovers = { orderIds: number[]; cartIds: number[]; customerIds: number[]; refIds: string[] };

async function placeOrder(
  variantId: number,
  customerId: number | null,
  quantity: number,
  pointToUse: number | undefined,
  leftovers: Leftovers,
) {
  const cartToken = `USE-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken, customerId })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId,
    orderer: { name: `사용검증${SUFFIX}`, phone: "010-7878-1212", email: `use-${SUFFIX}@example.com` },
    shippingAddress: {
      recipient: `사용검증${SUFFIX}`,
      phone: "010-7878-1212",
      zipcode: "04168",
      addr1: "서울 마포구 만리재로 00",
      addr2: null,
    },
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
    pointToUse,
  });
  leftovers.orderIds.push(created.orderId);
  leftovers.refIds.push(created.orderNo);
  return created;
}

async function readOrderAmounts(orderId: number) {
  const [row] = await db
    .select({
      subtotal: orders.subtotal,
      shippingFee: orders.shippingFee,
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

async function main() {
  console.log("PaRaSOL 적립금 사용 검증 (임시 회원·주문은 종료 시 삭제)");

  const policy = await loadPointPolicy(db);
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], customerIds: [], refIds: [] };

  try {
    const [buyer] = await db
      .insert(customer)
      .values({ name: `사용검증${SUFFIX}`, email: `use-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    leftovers.customerIds.push(buyer.id);

    // 넉넉히 적립해 두고 시작한다
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 5000,
        title: "검증용 사전 적립",
        tagCode: "manual",
        expiresAt: calcExpiresAt(new Date(), policy),
        dedupeKey: `check:${SUFFIX}:seed`,
      }),
    );
    check((await getPointBalance(db, buyer.id)) === 5000, "사전 적립 5000");

    /* 감사 교훈: 서비스가 맞는데 **화면에 연결이 안 되어** 아무도 못 쓰는 경우를 검증이 놓쳤다.
       이 절은 로직이 아니라 '앱 안에 입구가 있는가'를 본다 — 없으면 아래 [2]가 통과해도 무의미하다 */
    console.log("\n[0] ★적립금 입구가 실제로 앱 안에 있는가");
    const memberCartToken = `USE-VIEW-${randomUUID()}`;
    const [viewCart] = await db
      .insert(cart)
      .values({ sessionToken: memberCartToken, customerId: buyer.id })
      .returning({ id: cart.id });
    leftovers.cartIds.push(viewCart.id);
    await db.insert(cartItem).values({ cartId: viewCart.id, variantId: variant.id, quantity: 1 });

    const memberCheckout = await getCheckoutView(db, {
      cartToken: memberCartToken,
      customerId: buyer.id,
    });
    check(
      memberCheckout.point !== null,
      "회원 주문서가 적립금 정보를 내려준다 — 없으면 화면에 입력 칸이 그려지지 않는다",
    );
    check(
      memberCheckout.point?.usableBalance === 5000,
      "주문서가 내려준 사용 가능액이 실제 잔액과 같다",
      memberCheckout.point,
    );
    check(
      memberCheckout.point?.useUnitPoint === policy.useUnitPoint &&
        memberCheckout.point?.minUsePoint === policy.minUsePoint,
      "사용 규칙도 함께 내려준다 — 화면이 숫자를 따로 적으면 정책 변경 때 갈라진다",
    );

    const guestCheckout = await getCheckoutView(db, {
      cartToken: memberCartToken,
      customerId: null,
    });
    check(
      guestCheckout.point === null,
      "비회원 주문서는 적립금이 null — 잔액이 귀속될 회원이 없다",
    );

    const summary = await getPointSummary(db, buyer.id);
    check(summary.usableBalance === 5000, "마이페이지 요약이 사용 가능액을 준다", summary);
    const historyPage = await getPointHistory(db, { customerId: buyer.id });
    check(
      historyPage.rows.length === 1 && historyPage.rows[0].amount === 5000,
      "마이페이지 내역에 적립 한 건이 보인다 — 잔액만 보이면 '왜 줄었는지'를 물어야 한다",
      historyPage.rows.length,
    );

    console.log("\n[1] 적립금 없이 주문 — 기존 동작 그대로 기대");
    const plainOrder = await placeOrder(variant.id, buyer.id, 1, undefined, leftovers);
    const plainAmounts = await readOrderAmounts(plainOrder.orderId);
    check(plainAmounts.pointUsed === 0, "point_used = 0");
    check(
      plainAmounts.grandTotal === plainAmounts.subtotal + plainAmounts.shippingFee,
      "청구액 = 상품 + 배송비",
      plainAmounts,
    );
    check(
      (await getPointBalance(db, buyer.id)) === 5000,
      "적립금을 안 쓰면 잔액이 그대로다",
    );

    console.log("\n[2] 적립금 2000 사용 — 주문·결제·잔액·원장 네 곳 일치 기대");
    const usedOrder = await placeOrder(variant.id, buyer.id, 1, 2000, leftovers);
    const usedAmounts = await readOrderAmounts(usedOrder.orderId);

    check(usedAmounts.pointUsed === 2000, "orders.point_used = 2000", usedAmounts.pointUsed);
    check(
      usedAmounts.grandTotal ===
        usedAmounts.subtotal + usedAmounts.shippingFee - 2000,
      "청구액이 적립금만큼 줄었다",
      usedAmounts,
    );
    check(
      usedAmounts.paymentAmount === usedAmounts.grandTotal,
      "결제 대기 금액 == 주문 청구액 — 토스에 넘기는 금액이 여기서 나온다",
      usedAmounts,
    );
    check(
      usedOrder.grandTotal === usedAmounts.grandTotal,
      "서비스가 돌려준 금액도 같다 — 화면이 이 값으로 결제창을 연다",
    );
    check((await getPointBalance(db, buyer.id)) === 3000, "잔액 5000 → 3000");
    check(
      (await sumRemainingLots(db, buyer.id)) === 3000,
      "원장 잔여 합계도 3000 — 잔액만 깎이고 원장이 남는 일이 없다",
    );

    console.log("\n[3] 정책 위반 — 최소액·단위 거절 기대");
    let belowMinimumBlocked = false;
    try {
      await placeOrder(variant.id, buyer.id, 1, 500, leftovers);
    } catch (error) {
      belowMinimumBlocked =
        error instanceof PointUseRejectedError && /1,000원부터/.test(error.message);
    }
    check(belowMinimumBlocked, "최소 사용액 미만은 거절 (500원)");

    let notUnitBlocked = false;
    try {
      await placeOrder(variant.id, buyer.id, 1, 1005, leftovers);
    } catch (error) {
      notUnitBlocked = error instanceof PointUseRejectedError && /10원 단위/.test(error.message);
    }
    check(notUnitBlocked, "사용 단위 위반은 거절 (1005원)");

    console.log("\n[4] 잔액 초과 — 거절 기대");
    let overBalanceBlocked = false;
    try {
      await placeOrder(variant.id, buyer.id, 1, 99000, leftovers);
    } catch (error) {
      overBalanceBlocked = error instanceof PointUseRejectedError;
    }
    check(overBalanceBlocked, "잔액보다 많이 쓰면 거절");
    check((await getPointBalance(db, buyer.id)) === 3000, "거절된 시도는 잔액을 건드리지 않았다");

    console.log("\n[5] 비회원 — 적립금 사용 차단 기대");
    let guestBlocked = false;
    try {
      await placeOrder(variant.id, null, 1, 1000, leftovers);
    } catch (error) {
      guestBlocked = error instanceof GuestPointUseError;
    }
    check(
      guestBlocked,
      "비회원은 적립금을 쓸 수 없다 — 잔액이 귀속될 회원이 없는데 금액만 깎이면 그대로 손실이다",
    );

    console.log("\n[6] 주문 취소 — 사용 적립금 복원 기대");
    const balanceBeforeCancel = await getPointBalance(db, buyer.id);
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: usedOrder.orderId,
        toStatus: "cancelled",
        actor: { role: "customer", id: buyer.id },
      }),
    );
    const balanceAfterCancel = await getPointBalance(db, buyer.id);
    check(
      balanceAfterCancel === balanceBeforeCancel + 2000,
      "취소하면 쓴 적립금이 돌아온다 — 없으면 돈도 안 냈는데 적립금만 잃는다",
      { balanceBeforeCancel, balanceAfterCancel },
    );
    check(
      (await sumRemainingLots(db, buyer.id)) === balanceAfterCancel,
      "복원 후에도 원장 == 잔액",
    );

    console.log("\n[7] 취소 재실행 — 중복 복원 차단 기대");
    const { restoreOrderPoints } = await import("../point-earn.service");
    const duplicateRestore = await db.transaction((tx) =>
      restoreOrderPoints(tx, usedOrder.orderId),
    );
    check(
      duplicateRestore.earned === false && duplicateRestore.reason === "duplicate",
      "같은 주문의 재복원은 거절된다 (dedupe_key)",
      duplicateRestore,
    );
    check(
      (await getPointBalance(db, buyer.id)) === balanceAfterCancel,
      "잔액이 두 번 늘지 않았다",
    );

    console.log("\n[8] 위변조 — 결제액보다 큰 적립금 기대");
    // 주문 금액을 넘는 적립금은 정책 검증(over_order_amount)에서 막힌다.
    // 잔액을 충분히 채운 뒤 시도해야 '잔액 부족'이 아니라 '주문금액 초과'로 걸리는지 확인된다
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 500000,
        title: "검증용 대량 적립",
        tagCode: "manual",
        expiresAt: calcExpiresAt(new Date(), policy),
        dedupeKey: `check:${SUFFIX}:big`,
      }),
    );
    let overOrderBlocked = false;
    try {
      await placeOrder(variant.id, buyer.id, 1, 400000, leftovers);
    } catch (error) {
      overOrderBlocked =
        error instanceof PointUseRejectedError && /결제 금액보다/.test(error.message);
    }
    check(
      overOrderBlocked,
      "결제액보다 많은 적립금은 거절 — 청구액이 음수가 되는 주문을 만들 수 없다",
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
