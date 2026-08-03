/**
 * 쿠폰 발급·사용·복원 검증 (C2).
 * 실행: npm run check:coupon   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **같은 쿠폰이 두 번 발급되거나 두 번 사용되지 않는다.**
 * 조회 후 판정(read-modify-write)이면 동시 요청에서 수량을 넘기거나 한 장을 두 번 쓴다.
 * 여기서는 순차 호출로 조건부 UPDATE의 판정을 확인한다 — 동시성 자체는 조건부 UPDATE가
 * DB 수준에서 보장하므로, 검증은 '조건이 실제로 걸리는가'를 본다.
 *
 * 시나리오: [0]★스키마 준비 [1]발급 [2]인당 한도 [3]수량 소진 [4]사용 [5]중복 사용 차단
 *           [6]주문 취소 시 복원 [7]기간 만료 발급 차단
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { coupon, couponIssue, customer, orders } from "@/db/schema";

import {
  CouponIssueUnavailableError,
  CouponUseRejectedError,
  countUsableCoupons,
  issueCouponToCustomer,
  listCustomerCoupons,
  restoreOrderCoupon,
  useCouponForOrder,
} from "../coupon.service";

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
  console.log("PaRaSOL 쿠폰 발급·사용 검증 (임시 데이터는 종료 시 삭제)");

  const couponIds: number[] = [];
  const customerIds: number[] = [];
  const orderIds: number[] = [];

  try {
    console.log("\n[0] ★스키마 준비 — per_customer_limit 컬럼이 실제로 있는가");
    // 이 컬럼이 없으면 아래 전부가 무의미하다. SQL 미실행을 여기서 잡는다
    const [schemaProbe] = await db
      .insert(coupon)
      .values({
        name: `검증쿠폰${SUFFIX}`,
        type: "fixed",
        value: 5000,
        minOrderAmount: 10000,
        scope: "all",
        issueMethod: "download",
        totalQuantity: 2,
        perCustomerLimit: 1,
        isActive: true,
      })
      .returning({ id: coupon.id, perCustomerLimit: coupon.perCustomerLimit });
    couponIds.push(schemaProbe.id);
    check(
      schemaProbe.perCustomerLimit === 1,
      "coupon.per_customer_limit 저장·조회 가능 (SQL 적용됨)",
      schemaProbe,
    );

    const [buyer] = await db
      .insert(customer)
      .values({ name: `쿠폰검증${SUFFIX}`, email: `cp1-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    customerIds.push(buyer.id);

    const [otherBuyer] = await db
      .insert(customer)
      .values({ name: `쿠폰검증2${SUFFIX}`, email: `cp2-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    customerIds.push(otherBuyer.id);

    console.log("\n[1] 발급 — 수량이 줄고 발급건이 생긴다");
    const firstIssue = await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: schemaProbe.id, customerId: buyer.id }),
    );
    check(firstIssue.couponIssueId > 0, "발급건이 생성됐다");
    const [afterFirst] = await db
      .select({ issuedCount: coupon.issuedCount })
      .from(coupon)
      .where(eq(coupon.id, schemaProbe.id));
    check(afterFirst.issuedCount === 1, "issued_count가 1 늘었다", afterFirst);
    check(
      (await countUsableCoupons(db, buyer.id)) === 1,
      "사용 가능 쿠폰 개수 1 — 마이페이지·헤더가 이 값을 쓴다",
    );

    console.log("\n[2] 인당 한도 — 같은 사람이 또 받으면 거절 + 수량 원복");
    const limitBlocked = await expectRejected(
      () =>
        db.transaction((tx) =>
          issueCouponToCustomer(tx, { couponId: schemaProbe.id, customerId: buyer.id }),
        ),
      CouponIssueUnavailableError,
    );
    check(limitBlocked, "인당 한도 초과는 거절된다");
    const [afterLimit] = await db
      .select({ issuedCount: coupon.issuedCount })
      .from(coupon)
      .where(eq(coupon.id, schemaProbe.id));
    check(
      afterLimit.issuedCount === 1,
      "★거절된 시도가 수량을 갉아먹지 않았다 — 롤백으로 issued_count도 되돌아간다",
      afterLimit,
    );

    console.log("\n[3] 수량 소진 — 마지막 한 장까지만 나간다");
    await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: schemaProbe.id, customerId: otherBuyer.id }),
    );
    const [afterSecond] = await db
      .select({ issuedCount: coupon.issuedCount })
      .from(coupon)
      .where(eq(coupon.id, schemaProbe.id));
    check(afterSecond.issuedCount === 2, "2장 모두 발급됨", afterSecond);

    const [thirdCustomer] = await db
      .insert(customer)
      .values({ name: `쿠폰검증3${SUFFIX}`, email: `cp3-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    customerIds.push(thirdCustomer.id);

    const soldOutBlocked = await expectRejected(
      () =>
        db.transaction((tx) =>
          issueCouponToCustomer(tx, { couponId: schemaProbe.id, customerId: thirdCustomer.id }),
        ),
      CouponIssueUnavailableError,
    );
    check(soldOutBlocked, "수량이 소진되면 발급이 거절된다 — 100장 한정이 103장 나가지 않는다");

    console.log("\n[4] 사용 — 주문에 붙고 사용 시각이 찍힌다");
    const [orderRow] = await db
      .insert(orders)
      .values({
        orderNo: `8888${SUFFIX.slice(0, 4)}-0001`,
        customerId: buyer.id,
        status: "paid",
        channel: "web",
        ordererName: `쿠폰검증${SUFFIX}`,
        ordererPhone: "01033334444",
        recipient: `쿠폰검증${SUFFIX}`,
        phone: "01033334444",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        subtotal: 20000,
        shippingFee: 0,
        couponDiscount: 5000,
        pointUsed: 0,
        grandTotal: 15000,
      })
      .returning({ id: orders.id });
    orderIds.push(orderRow.id);

    await db.transaction((tx) =>
      useCouponForOrder(tx, {
        couponIssueId: firstIssue.couponIssueId,
        customerId: buyer.id,
        orderId: orderRow.id,
        discountAmount: 5000,
      }),
    );
    const [usedRow] = await db
      .select({
        usedAt: couponIssue.usedAt,
        orderId: couponIssue.orderId,
        discountAmount: couponIssue.discountAmount,
      })
      .from(couponIssue)
      .where(eq(couponIssue.id, firstIssue.couponIssueId));
    check(usedRow.usedAt !== null, "used_at이 찍혔다");
    check(usedRow.orderId === orderRow.id, "어느 주문에 썼는지 남는다");
    check(usedRow.discountAmount === 5000, "실제 할인액이 기록된다 — 반품 정산이 이 값을 쓴다");
    check(
      (await countUsableCoupons(db, buyer.id)) === 0,
      "쓴 쿠폰은 사용 가능 개수에서 빠진다",
    );

    console.log("\n[5] 중복 사용 — 같은 쿠폰을 두 번 쓸 수 없다");
    const doubleUseBlocked = await expectRejected(
      () =>
        db.transaction((tx) =>
          useCouponForOrder(tx, {
            couponIssueId: firstIssue.couponIssueId,
            customerId: buyer.id,
            orderId: orderRow.id,
            discountAmount: 5000,
          }),
        ),
      CouponUseRejectedError,
    );
    check(doubleUseBlocked, "★이미 쓴 쿠폰의 재사용은 거절된다 (used_at IS NULL 조건)");

    console.log("\n[6] 남의 쿠폰 — 다른 회원 id로는 쓸 수 없다");
    const secondIssueRows = await db
      .select({ id: couponIssue.id })
      .from(couponIssue)
      .where(eq(couponIssue.customerId, otherBuyer.id));
    const foreignUseBlocked = await expectRejected(
      () =>
        db.transaction((tx) =>
          useCouponForOrder(tx, {
            couponIssueId: secondIssueRows[0].id,
            // 남의 발급건 id를 알아도 내 id로는 못 쓴다
            customerId: buyer.id,
            orderId: orderRow.id,
            discountAmount: 5000,
          }),
        ),
      CouponUseRejectedError,
    );
    check(foreignUseBlocked, "남의 발급건 id로 사용 시도는 거절된다");

    console.log("\n[7] 주문 취소 — 쿠폰이 되돌아온다");
    const restored = await db.transaction((tx) => restoreOrderCoupon(tx, orderRow.id));
    check(restored.restoredCount === 1, "복원 1건", restored);
    const [restoredRow] = await db
      .select({ usedAt: couponIssue.usedAt, orderId: couponIssue.orderId })
      .from(couponIssue)
      .where(eq(couponIssue.id, firstIssue.couponIssueId));
    check(
      restoredRow.usedAt === null && restoredRow.orderId === null,
      "취소하면 다시 쓸 수 있다 — 물건도 쿠폰도 잃는 일이 없다",
      restoredRow,
    );
    check(
      (await countUsableCoupons(db, buyer.id)) === 1,
      "사용 가능 개수도 되돌아온다",
    );

    const reRestored = await db.transaction((tx) => restoreOrderCoupon(tx, orderRow.id));
    check(
      reRestored.restoredCount === 0,
      "이미 복원된 주문을 다시 복원해도 아무 일도 없다 (used_at IS NOT NULL 조건)",
    );

    console.log("\n[8] 기간 만료 쿠폰 — 발급 자체가 막힌다");
    const [expiredCoupon] = await db
      .insert(coupon)
      .values({
        name: `만료쿠폰${SUFFIX}`,
        type: "percent",
        value: 100,
        minOrderAmount: 0,
        scope: "all",
        issueMethod: "download",
        endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        isActive: true,
      })
      .returning({ id: coupon.id });
    couponIds.push(expiredCoupon.id);

    const expiredBlocked = await expectRejected(
      () =>
        db.transaction((tx) =>
          issueCouponToCustomer(tx, { couponId: expiredCoupon.id, customerId: buyer.id }),
        ),
      CouponIssueUnavailableError,
    );
    check(expiredBlocked, "종료된 쿠폰은 받을 수 없다");

    console.log("\n[9] 마이페이지 목록 — 상태가 구분된다");
    const myCoupons = await listCustomerCoupons(db, buyer.id);
    check(myCoupons.length === 1, "보유 쿠폰 1건", myCoupons.length);
    check(
      myCoupons[0].usedAt === null && myCoupons[0].isExpired === false,
      "사용 가능 상태로 보인다",
      myCoupons[0],
    );
  } finally {
    if (orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (couponIds.length > 0) {
      // coupon_issue는 coupon 삭제 시 cascade로 함께 지워진다
      await db.delete(coupon).where(inArray(coupon.id, couponIds));
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
