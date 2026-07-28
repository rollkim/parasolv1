/**
 * 관리자 대시보드 검증 — 집계가 실제 DB 값과 맞는지 확인한다.
 * 실행: npm run check:admin-dashboard   (SSH 터널 켠 상태)
 *
 * 대시보드는 **틀려도 티가 안 나는** 화면이다. 숫자가 그럴듯하면 운영자가 그대로 믿는다.
 * 그래서 검증은 "값이 있다"가 아니라 **직접 센 값과 일치하는가**를 본다.
 *
 * 시나리오: [1]구조·기간 [2]오늘 KPI가 실제 주문과 일치 [3]대기열이 실제 상태와 일치
 *           [4]취소 주문은 매출에서 빠진다 [5]KST 경계 [6]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adminUser,
  cart,
  cartItem,
  claim,
  orders,
  productVariant,
  shipment,
} from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
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

const ADMIN = { role: "admin" as const, id: 1 };
const ORDERER = { name: "대시보드검증", phone: "010-5151-6161", email: "dash@example.com" };
const ADDRESS = {
  recipient: "대시보드검증",
  phone: "010-5151-6161",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
};

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

type Leftovers = { orderIds: number[]; cartIds: number[] };

async function setupPaidOrder(variantId: number, quantity: number, leftovers: Leftovers) {
  const cartToken = `DASH-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);

  const { gateway } = createStubPaymentGateway();
  await confirmPayment(db, gateway, {
    orderNo: created.orderNo,
    paymentKey: `STUB-${randomUUID()}`,
    amount: created.grandTotal,
    cartToken,
  });
  return created;
}

/** 대시보드와 같은 KST 기준으로 직접 센다 — 두 값이 맞아야 집계를 믿을 수 있다 */
async function countTodayOrdersDirectly() {
  const [row] = await db
    .select({
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.grandTotal}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["paid", "preparing", "shipping", "delivered", "confirmed"]),
        sql`(${orders.createdAt} AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date`,
      ),
    );
  return row;
}

async function main() {
  console.log("PaRaSOL 관리자 대시보드 검증 (임시 주문은 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [] };

  try {
    const caller = await adminCaller(admin.id);

    console.log("\n[1] 구조 — 기간과 항목 수 기대");
    const baseline = await caller.adminDashboard.summary();
    check(baseline.dailyRevenue.length === 7, `일별 매출 7일 (${baseline.dailyRevenue.length})`);
    check(baseline.hourlyOrders.length === 6, `시간대 6구간 (${baseline.hourlyOrders.length})`);
    check(
      baseline.dailyRevenue[6].reportDate >= baseline.dailyRevenue[0].reportDate,
      "오래된 날짜가 앞, 오늘이 뒤",
      baseline.dailyRevenue.map((row) => row.reportDate),
    );
    check(
      baseline.excludedMetrics.length > 0 &&
        baseline.excludedMetrics.every((metric) => metric.reason.length > 0),
      "못 보여주는 지표는 이유와 함께 밝힌다 — 빈 자리는 의심을, 가짜 숫자는 오판을 부른다",
    );
    check(
      baseline.kpi.pendingTaskCount ===
        baseline.queue.reduce((sum, item) => sum + item.count, 0),
      "처리 대기 KPI = 대기열 합계",
      { kpi: baseline.kpi.pendingTaskCount, queue: baseline.queue.map((q) => q.count) },
    );

    console.log("\n[2] 오늘 KPI — 직접 센 값과 일치 기대");
    const created = await setupPaidOrder(variant.id, 2, leftovers);
    const afterOrder = await caller.adminDashboard.summary();
    const direct = await countTodayOrdersDirectly();

    check(
      afterOrder.kpi.todayOrderCount === direct.orderCount,
      `오늘 주문 수가 직접 센 값과 같다 (${afterOrder.kpi.todayOrderCount} = ${direct.orderCount})`,
    );
    check(
      afterOrder.kpi.todayRevenue === direct.revenue,
      `오늘 매출이 직접 센 값과 같다 (${afterOrder.kpi.todayRevenue} = ${direct.revenue})`,
    );
    check(
      afterOrder.kpi.todayOrderCount === baseline.kpi.todayOrderCount + 1,
      "새 결제 주문이 오늘 건수에 1 더해진다",
    );
    check(
      afterOrder.kpi.todayRevenue === baseline.kpi.todayRevenue + created.grandTotal,
      `매출이 결제액만큼 늘었다 (+${created.grandTotal})`,
    );

    // 오늘 칸은 일별 차트의 마지막과 같아야 한다 — 두 집계가 다른 식을 쓰면 여기서 어긋난다
    const todayCell = afterOrder.dailyRevenue[6];
    check(
      todayCell.revenue === afterOrder.kpi.todayRevenue,
      "일별 차트의 오늘 칸 = 오늘 매출 KPI",
      { chart: todayCell.revenue, kpi: afterOrder.kpi.todayRevenue },
    );

    console.log("\n[3] 대기열 — 실제 상태와 일치 기대");
    const beforePreparing =
      afterOrder.queue.find((item) => item.queueKey === "await_invoice")?.count ?? 0;
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: created.orderId,
        toStatus: "preparing",
        actor: ADMIN,
        memo: "대시보드 검증",
      }),
    );
    const afterPreparing = await caller.adminDashboard.summary();
    check(
      (afterPreparing.queue.find((item) => item.queueKey === "await_invoice")?.count ?? 0) ===
        beforePreparing + 1,
      "배송준비 + 송장 없음이 대기열에 잡힌다",
    );

    // 송장을 넣으면 대기열에서 빠져야 한다 — '해야 할 일'이 사라지는 것이 이 지표의 쓸모다
    await db.insert(shipment).values({
      orderId: created.orderId,
      carrier: "cj",
      trackingNo: "999888777666",
      shippedAt: sql`now()`,
    });
    const afterInvoice = await caller.adminDashboard.summary();
    check(
      (afterInvoice.queue.find((item) => item.queueKey === "await_invoice")?.count ?? 0) ===
        beforePreparing,
      "송장을 넣으면 대기열에서 빠진다",
    );

    console.log("\n[4] 취소 주문 — 매출에서 빠진다 기대");
    const revenueBeforeCancel = afterInvoice.kpi.todayRevenue;
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: created.orderId,
        toStatus: "cancelled",
        actor: ADMIN,
        memo: "대시보드 검증",
      }),
    );
    const afterCancel = await caller.adminDashboard.summary();
    check(
      afterCancel.kpi.todayRevenue === revenueBeforeCancel - created.grandTotal,
      `취소하면 매출에서 빠진다 (${revenueBeforeCancel} → ${afterCancel.kpi.todayRevenue})`,
    );
    check(
      afterCancel.kpi.todayOrderCount === baseline.kpi.todayOrderCount,
      "주문 건수도 원래대로 — 취소 주문을 매출 건수로 세지 않는다",
    );

    console.log("\n[5] 날짜 경계 — KST 기준 기대");
    const [boundaryRow] = await db
      .select({
        kstDate: sql<string>`to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')`,
      })
      .from(orders)
      .limit(1);
    check(
      afterCancel.dailyRevenue[6].reportDate === boundaryRow.kstDate,
      `차트의 마지막 날이 KST 오늘이다 (${afterCancel.dailyRevenue[6].reportDate} = ${boundaryRow.kstDate}) — UTC로 세면 아침마다 어제를 본다`,
    );

    console.log("\n[6] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let forbidden = false;
    try {
      await anonymous.adminDashboard.summary();
    } catch (error) {
      forbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(forbidden, "관리자 세션 없이는 대시보드 조회 불가");
  } finally {
    if (leftovers.orderIds.length > 0) {
      await db.delete(claim).where(inArray(claim.orderId, leftovers.orderIds));
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    // 결제 승인으로 차감된 재고를 되돌린다(취소 전이만으로는 복원되지 않는다)
    await db
      .update(productVariant)
      .set({ stock: variant.stock })
      .where(and(eq(productVariant.id, variant.id), isNull(productVariant.deletedAt)));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
