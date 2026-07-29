/**
 * 결제 대사(Phase 6) 검증 — 인위적으로 끊긴 상태를 만들어 대사가 실제로 잡는지 본다.
 * 실행: npm run check:reconcile   (SSH 터널 켠 상태)
 *
 * 대사는 **평소에 아무것도 하지 않는 코드**라, 정작 필요한 순간에 동작하지 않아도
 * 아무도 모른다. 그래서 검증이 끊긴 상태를 직접 만들어 낸다.
 *
 * 시나리오: [1]끊긴 결제를 확정한다 [2]PG에 없으면 미결제로 분류 [3]결제키 없으면 대상 아님
 *           [4]시간 조건 [5]불일치 탐지 3종
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  inventoryLog,
  orders,
  payment,
  productVariant,
} from "@/db/schema";
import { createStubPaymentGateway } from "../../payments/stub-payment-gateway";
import {
  countStuckPayments,
  findReconcileAnomalies,
  reconcilePendingPayments,
} from "../payment-reconcile.service";

import { createPendingOrder } from "../order.service";
import { applyOrderTransition } from "../order-status.service";
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

const ORDERER = { name: "대사검증", phone: "010-2323-4545", email: "recon@example.com" };
const ADDRESS = {
  recipient: "대사검증",
  phone: "010-2323-4545",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
};

type Leftovers = { orderIds: number[]; cartIds: number[]; refIds: string[] };

async function setupPendingOrder(variantId: number, leftovers: Leftovers) {
  const cartToken = `RECON-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity: 1 });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  leftovers.refIds.push(created.orderNo);
  return created;
}

/**
 * 승인 도중 끊긴 상태를 만든다 — confirmPayment가 결제키를 선점한 직후 프로세스가
 * 죽은 모양이다. 결제 행을 ready로 두고 키만 박고 시각을 과거로 민다.
 */
async function makeStuckPayment(orderId: number, paymentKey: string, minutesAgo: number) {
  await db
    .update(payment)
    .set({
      paymentKey,
      status: "ready",
      createdAt: sql`now() - ${sql.raw(`interval '${minutesAgo} minutes'`)}`,
    })
    .where(eq(payment.orderId, orderId));
}

async function main() {
  console.log("PaRaSOL 결제 대사 검증 (임시 주문은 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], refIds: [] };

  try {
    console.log("\n[1] 끊긴 결제 — 확정 기대");
    const stuckOrder = await setupPendingOrder(variant.id, leftovers);
    const stuckKey = `STUB-${randomUUID()}`;
    await makeStuckPayment(stuckOrder.orderId, stuckKey, 30);

    const stuckCount = await countStuckPayments(db);
    check(stuckCount >= 1, `대사 대상 ${stuckCount}건으로 잡힌다`);

    const stockBefore = (
      await db
        .select({ stock: productVariant.stock })
        .from(productVariant)
        .where(eq(productVariant.id, variant.id))
    )[0].stock;

    // 스텁 게이트웨이는 승인을 성공시킨다 = "PG에는 결제가 있었다"
    const { gateway } = createStubPaymentGateway();
    const report = await reconcilePendingPayments(db, gateway, { stuckMinutes: 15 });
    const stuckItem = report.items.find((item) => item.orderNo === stuckOrder.orderNo);
    check(stuckItem?.outcome === "confirmed", "PG에 결제가 있으면 확정된다", stuckItem);

    const [orderAfter] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, stuckOrder.orderId));
    check(orderAfter.status === "paid", `주문이 결제완료로 (${orderAfter.status})`);

    const stockAfter = (
      await db
        .select({ stock: productVariant.stock })
        .from(productVariant)
        .where(eq(productVariant.id, variant.id))
    )[0].stock;
    check(
      stockAfter === stockBefore - 1,
      `재고도 함께 차감된다 (${stockBefore} → ${stockAfter}) — 대사가 별도 경로를 쓰지 않는다는 증거`,
    );

    console.log("\n[2] PG에 결제가 없는 경우 — 미결제로 분류 기대");
    const abandonedOrder = await setupPendingOrder(variant.id, leftovers);
    // 스텁은 FAIL- 접두 키를 확정 거절한다 = "PG에 결제가 없다(결제창을 닫았다)"
    await makeStuckPayment(abandonedOrder.orderId, `FAIL-${randomUUID()}`, 30);

    const rejectReport = await reconcilePendingPayments(db, gateway, { stuckMinutes: 15 });
    const abandonedItem = rejectReport.items.find(
      (item) => item.orderNo === abandonedOrder.orderNo,
    );
    check(
      abandonedItem?.outcome === "notPaid",
      "확정 거절은 '미결제'로 분류된다 — 실패가 아니라 정상 종료다",
      abandonedItem,
    );
    const [abandonedAfter] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, abandonedOrder.orderId));
    check(abandonedAfter.status === "pending", "미결제 주문은 그대로 pending", abandonedAfter);

    console.log("\n[3] 결제키 없음 — 대사 대상이 아니다 기대");
    const neverTriedOrder = await setupPendingOrder(variant.id, leftovers);
    await db
      .update(payment)
      .set({ createdAt: sql`now() - interval '60 minutes'` })
      .where(eq(payment.orderId, neverTriedOrder.orderId));

    const noKeyReport = await reconcilePendingPayments(db, gateway, { stuckMinutes: 15 });
    check(
      !noKeyReport.items.some((item) => item.orderNo === neverTriedOrder.orderNo),
      "결제창에 가지도 않은 주문은 건드리지 않는다 — 결제키가 시도의 흔적이다",
    );

    console.log("\n[4] 시간 조건 — 방금 시도한 건은 제외 기대");
    const freshOrder = await setupPendingOrder(variant.id, leftovers);
    await makeStuckPayment(freshOrder.orderId, `STUB-${randomUUID()}`, 1);
    const freshReport = await reconcilePendingPayments(db, gateway, { stuckMinutes: 15 });
    check(
      !freshReport.items.some((item) => item.orderNo === freshOrder.orderNo),
      "1분 전 시도는 아직 결제창에 있을 수 있어 건드리지 않는다",
    );

    console.log("\n[5] 불일치 탐지 — 사람이 봐야 하는 것들 기대");
    // 환불됐는데 주문이 진행 중 — 돈은 돌려줬는데 상품이 나가는 상태
    await db
      .update(payment)
      .set({ status: "cancelled" })
      .where(eq(payment.orderId, stuckOrder.orderId));
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: stuckOrder.orderId,
        toStatus: "preparing",
        // paid → preparing은 관리자 전이다(전이표가 주체까지 검사한다)
        actor: { role: "admin", id: 1 },
        memo: "대사 검증",
      }),
    );

    const anomalies = await findReconcileAnomalies(db);
    check(
      anomalies.refundedButActiveOrders.some((row) => row.orderNo === stuckOrder.orderNo),
      "환불됐는데 진행 중인 주문을 잡는다 — 돈은 돌려줬는데 상품이 나간다",
      anomalies.refundedButActiveOrders,
    );

    // 결제완료인데 결제 건이 없는 주문
    const orphanOrder = await setupPendingOrder(variant.id, leftovers);
    await db.delete(payment).where(eq(payment.orderId, orphanOrder.orderId));
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: orphanOrder.orderId,
        toStatus: "paid",
        actor: { role: "system" },
        memo: "대사 검증",
      }),
    );
    const anomalies2 = await findReconcileAnomalies(db);
    check(
      anomalies2.paidOrdersWithoutPayment.some((row) => row.orderNo === orphanOrder.orderNo),
      "결제완료인데 결제 건이 없는 주문을 잡는다",
      anomalies2.paidOrdersWithoutPayment,
    );
    check(
      anomalies2.settledClaimsWithoutRefund.length >= 0,
      "종결 클레임 환불 누락 조회가 동작한다",
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
