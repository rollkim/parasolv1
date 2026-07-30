/**
 * 클레임 적립금 정산 검증 (P5) — 부분 반품의 비례 배분.
 * 실행: npm run check:claim-point   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **나눠서 반품해도 합계가 정확히 맞는다.**
 * 내림으로 흘린 잔여가 마지막 정산에서 정리되지 않으면 적립금 몇 원이 영영 묶인다.
 *
 * 시나리오: [1]확정 전 부분 반품 — 사용분 비례 복원 [2]남은 분 반품 — 잔여 전액 정리
 *           [3]확정 후 반품 — 적립분 회수 [4]같은 클레임 재정산 차단
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  claim,
  claimItem,
  customer,
  orderItem,
  orders,
  pointTransaction,
  productVariant,
} from "@/db/schema";
import { calcExpiresAt } from "@/domain/point";

import { settleClaimPoints } from "../claim-point.service";
import { earnPoints, getPointBalance, sumRemainingLots } from "../point.service";
import { loadPointPolicy } from "../point-policy.service";

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
  console.log("PaRaSOL 클레임 적립금 정산 검증 (임시 데이터는 종료 시 삭제)");

  const policy = await loadPointPolicy(db);
  const [variant] = await db
    .select({ id: productVariant.id, price: productVariant.price })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const customerIds: number[] = [];
  const orderIds: number[] = [];
  const claimIds: number[] = [];

  try {
    const [buyer] = await db
      .insert(customer)
      .values({
        name: `클레임적립${SUFFIX}`,
        email: `cp-${SUFFIX}@example.com`,
        isActive: true,
      })
      .returning({ id: customer.id });
    customerIds.push(buyer.id);

    // 주문을 직접 만든다 — 금액 구성을 정확히 통제해야 비례 계산을 검증할 수 있다.
    // 상품 20,000 · 적립금 2,000 사용 · 배송비 0 → 카드 18,000
    const [orderRow] = await db
      .insert(orders)
      .values({
        orderNo: `9999${SUFFIX.slice(0, 4)}-0001`,
        customerId: buyer.id,
        status: "delivered",
        channel: "web",
        ordererName: `클레임적립${SUFFIX}`,
        ordererPhone: "01011112222",
        recipient: `클레임적립${SUFFIX}`,
        phone: "01011112222",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        subtotal: 20_000,
        shippingFee: 0,
        couponDiscount: 0,
        pointUsed: 2_000,
        grandTotal: 18_000,
        deliveredAt: new Date(),
      })
      .returning({ id: orders.id });
    orderIds.push(orderRow.id);

    const [item] = await db
      .insert(orderItem)
      .values({
        orderId: orderRow.id,
        variantId: variant.id,
        productName: "검증 상품",
        unitPrice: 10_000,
        quantity: 2,
        lineTotal: 20_000,
      })
      .returning({ id: orderItem.id });

    /** 클레임 한 건을 만든다 — goodsAmount가 비례 기준이다 */
    async function makeClaim(goodsAmount: number, sequence: number) {
      const [created] = await db
        .insert(claim)
        .values({
          claimNo: `RT-9999${SUFFIX.slice(0, 4)}-${String(sequence).padStart(4, "0")}`,
          orderId: orderRow.id,
          type: "return",
          status: "inspecting",
          reasonCode: "change_mind",
          fault: "buyer",
          goodsAmount,
          shippingFee: 0,
          refundAmount: goodsAmount,
        })
        .returning({ id: claim.id, claimNo: claim.claimNo });
      claimIds.push(created.id);
      await db.insert(claimItem).values({
        claimId: created.id,
        orderItemId: item.id,
        quantity: 1,
      });
      return created;
    }

    console.log("\n[1] 확정 전 절반 반품 — 사용 적립금도 절반 복원 기대");
    const firstClaim = await makeClaim(10_000, 1);
    const balanceBefore = await getPointBalance(db, buyer.id);
    const firstSettle = await db.transaction((tx) =>
      settleClaimPoints(tx, {
        claimId: firstClaim.id,
        claimNo: firstClaim.claimNo,
        orderId: orderRow.id,
      }),
    );
    check(
      firstSettle.restoredPoint === 1_000,
      "2만원 중 1만원 반품 → 적립금 2000의 절반 1000 복원",
      firstSettle,
    );
    check(
      firstSettle.clawedBackPoint === 0,
      "확정 전이라 적립이 없었으니 회수도 0 — 없는 돈을 걷지 않는다",
    );
    check(
      (await getPointBalance(db, buyer.id)) === balanceBefore + 1_000,
      "잔액이 1000 늘었다",
    );
    // 클레임을 done으로 만들어 다음 정산의 '남은 금액' 계산에 반영시킨다
    await db.update(claim).set({ status: "done" }).where(eq(claim.id, firstClaim.id));

    console.log("\n[2] 나머지 반품 — 잔여 전액 정리 기대");
    const secondClaim = await makeClaim(10_000, 2);
    const secondSettle = await db.transaction((tx) =>
      settleClaimPoints(tx, {
        claimId: secondClaim.id,
        claimNo: secondClaim.claimNo,
        orderId: orderRow.id,
      }),
    );
    check(
      firstSettle.restoredPoint + secondSettle.restoredPoint === 2_000,
      `나눠 반품해도 복원 합계가 사용액과 정확히 맞는다 (${firstSettle.restoredPoint} + ${secondSettle.restoredPoint})`,
    );
    await db.update(claim).set({ status: "done" }).where(eq(claim.id, secondClaim.id));

    console.log("\n[3] 같은 클레임 재정산 — 중복 복원 차단 기대");
    const balanceBeforeRetry = await getPointBalance(db, buyer.id);
    const retrySettle = await db.transaction((tx) =>
      settleClaimPoints(tx, {
        claimId: secondClaim.id,
        claimNo: secondClaim.claimNo,
        orderId: orderRow.id,
      }),
    );
    check(
      retrySettle.restoredPoint === 0,
      "같은 클레임을 다시 정산해도 복원하지 않는다 (dedupe_key)",
      retrySettle,
    );
    check(
      (await getPointBalance(db, buyer.id)) === balanceBeforeRetry,
      "잔액이 늘지 않았다 — 환불 재시도가 돈을 늘리면 안 된다",
    );

    console.log("\n[4] 확정 후 반품 — 적립분 회수 기대");
    // 새 주문: 상품 20,000 · 적립금 미사용 · 확정 적립 200원이 이미 지급된 상태
    const [confirmedOrder] = await db
      .insert(orders)
      .values({
        orderNo: `9999${SUFFIX.slice(0, 4)}-0002`,
        customerId: buyer.id,
        status: "confirmed",
        channel: "web",
        ordererName: `클레임적립${SUFFIX}`,
        ordererPhone: "01011112222",
        recipient: `클레임적립${SUFFIX}`,
        phone: "01011112222",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        subtotal: 20_000,
        shippingFee: 0,
        couponDiscount: 0,
        pointUsed: 0,
        grandTotal: 20_000,
        deliveredAt: new Date(),
        confirmedAt: new Date(),
      })
      .returning({ id: orders.id });
    orderIds.push(confirmedOrder.id);

    const [confirmedItem] = await db
      .insert(orderItem)
      .values({
        orderId: confirmedOrder.id,
        variantId: variant.id,
        productName: "검증 상품",
        unitPrice: 10_000,
        quantity: 2,
        lineTotal: 20_000,
      })
      .returning({ id: orderItem.id });

    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 200,
        title: "구매 확정 적립 (1%)",
        tagCode: "purchase",
        orderId: confirmedOrder.id,
        expiresAt: calcExpiresAt(new Date(), policy),
        dedupeKey: `order:${confirmedOrder.id}:purchase`,
      }),
    );

    const [clawbackClaim] = await db
      .insert(claim)
      .values({
        claimNo: `RT-9999${SUFFIX.slice(0, 4)}-0003`,
        orderId: confirmedOrder.id,
        type: "return",
        status: "inspecting",
        reasonCode: "change_mind",
        fault: "buyer",
        goodsAmount: 10_000,
        shippingFee: 0,
        refundAmount: 10_000,
      })
      .returning({ id: claim.id, claimNo: claim.claimNo });
    claimIds.push(clawbackClaim.id);
    await db.insert(claimItem).values({
      claimId: clawbackClaim.id,
      orderItemId: confirmedItem.id,
      quantity: 1,
    });

    const balanceBeforeClawback = await getPointBalance(db, buyer.id);
    const clawbackSettle = await db.transaction((tx) =>
      settleClaimPoints(tx, {
        claimId: clawbackClaim.id,
        claimNo: clawbackClaim.claimNo,
        orderId: confirmedOrder.id,
      }),
    );
    check(
      clawbackSettle.clawedBackPoint === 100,
      "적립 200원 주문의 절반 반품 → 100원 회수",
      clawbackSettle,
    );
    check(
      clawbackSettle.restoredPoint === 0,
      "적립금을 안 쓴 주문이라 복원은 0",
    );
    check(
      (await getPointBalance(db, buyer.id)) === balanceBeforeClawback - 100,
      "잔액이 100 줄었다 — '적립받고 반품' 반복을 막는다",
    );

    console.log("\n[5] 원장·잔액 정합");
    const [finalBalance, finalLots] = await Promise.all([
      getPointBalance(db, buyer.id),
      sumRemainingLots(db, buyer.id),
    ]);
    check(finalBalance === finalLots, "원장 잔여 합계 == 잔액 캐시", {
      finalBalance,
      finalLots,
    });
  } finally {
    if (claimIds.length > 0) {
      await db.delete(claim).where(inArray(claim.id, claimIds));
    }
    if (orderIds.length > 0) {
      await db.delete(pointTransaction).where(inArray(pointTransaction.orderId, orderIds));
      await db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, customerIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
