/**
 * 관리자 주문 관리 검증 — 목록·상세·송장·상태 변경을 실제 DB에서 확인한다.
 * 실행: npm run check:admin-order   (SSH 터널 켠 상태)
 *
 * 핵심 검증: 관리자 경로가 **고객 경로와 같은 초크포인트**를 지나는가.
 * 별도 경로를 두면 전이표·이력이 두 벌이 되어 반드시 어긋난다.
 *
 * 시나리오: [1]목록·탭·검색 [2]상세·전이 후보 [3]송장 등록(+배송중 전이 원자성)
 *           [4]잘못된 단계 송장 차단 [5]불법 전이 차단 [6]권한 게이트
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cart, cartItem, orders, orderStatusHistory, productVariant, shipment } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { adminUser } from "@/db/schema";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

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

const ORDERER = { name: "관리자검증", phone: "010-3333-4444", email: "adminorder@example.com" };
const ADDRESS = {
  recipient: "관리자검증",
  phone: "010-3333-4444",
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

async function main() {
  console.log("PaRaSOL 관리자 주문 관리 검증 (임시 주문은 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const [variant] = await db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const cartToken = `ADMINORD-${randomUUID()}`;
  const [cartRow] = await db.insert(cart).values({ sessionToken: cartToken }).returning({ id: cart.id });
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: 1 });
  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });

  try {
    const caller = await adminCaller(admin.id);

    console.log("\n[1] 목록 — 탭·검색 기대");
    const allList = await caller.adminOrder.list({});
    check(allList.totalCount > 0, `전체 ${allList.totalCount}건`);
    check(
      allList.tabCounts.all >= allList.tabCounts.paid,
      "탭 건수 집계",
      allList.tabCounts,
    );

    // 주문자명으로 검색되는지 — CS가 실제로 쓰는 경로
    const searched = await caller.adminOrder.list({ keyword: ORDERER.name });
    check(
      searched.cards.some((card) => card.orderNo === created.orderNo),
      "주문자명 검색으로 방금 주문을 찾는다",
    );
    // 연락처는 하이픈 있는 입력으로도 찾아야 한다(저장은 정규화)
    const byPhone = await caller.adminOrder.list({ keyword: "010-3333-4444" });
    check(
      byPhone.cards.some((card) => card.orderNo === created.orderNo),
      "하이픈 연락처 검색도 찾는다",
    );

    console.log("\n[2] 상세 — 전이 후보를 서버가 정한다 기대");
    const pendingDetail = await caller.adminOrder.detail({ orderNo: created.orderNo });
    check(pendingDetail.orderStatus === "pending", `상태 ${pendingDetail.orderStatus}`);
    check(
      pendingDetail.nextStatuses.length === 0,
      "결제 전에는 관리자가 옮길 수 있는 상태가 없다",
      pendingDetail.nextStatuses,
    );

    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: created.orderId,
        toStatus: "paid",
        actor: { role: "system" },
        memo: "검증",
      }),
    );
    const paidDetail = await caller.adminOrder.detail({ orderNo: created.orderNo });
    check(
      paidDetail.nextStatuses.some((next) => next.status === "preparing"),
      "결제완료 → 배송준비 제시",
      paidDetail.nextStatuses.map((n) => n.status),
    );

    console.log("\n[3] 송장 등록 — 배송중 전이가 함께 일어난다 기대");
    let invoiceBlockedAtPaid = false;
    try {
      await caller.adminOrder.registerInvoice({
        orderNo: created.orderNo,
        carrierCode: "cj",
        trackingNo: "123456789012",
      });
    } catch {
      invoiceBlockedAtPaid = true;
    }
    check(invoiceBlockedAtPaid, "결제완료 상태에서는 송장 등록 차단");

    await caller.adminOrder.changeStatus({
      orderNo: created.orderNo,
      toStatus: "preparing",
    });
    const registered = await caller.adminOrder.registerInvoice({
      orderNo: created.orderNo,
      carrierCode: "cj",
      trackingNo: "123456789012",
    });
    check(registered.orderStatus === "shipping", "송장 등록 시 배송중 전이");

    const [shipmentRow] = await db
      .select({ carrier: shipment.carrier, trackingNo: shipment.trackingNo })
      .from(shipment)
      .where(eq(shipment.orderId, created.orderId));
    check(
      shipmentRow?.trackingNo === "123456789012" && shipmentRow.carrier === "cj",
      "송장 기록",
      shipmentRow,
    );

    console.log("\n[4] 초크포인트 공유 — 이력이 한 곳에 쌓인다 기대");
    const history = await db
      .select({ to: orderStatusHistory.toStatus, actor: orderStatusHistory.actor })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, created.orderId));
    check(
      history.some((row) => row.to === "shipping" && row.actor === `admin:${admin.id}`),
      "관리자 전이도 같은 이력 테이블에 actor와 함께 남는다",
      history,
    );

    console.log("\n[5] 불법 전이 차단 기대");
    let illegalBlocked = false;
    try {
      await caller.adminOrder.changeStatus({ orderNo: created.orderNo, toStatus: "paid" });
    } catch {
      illegalBlocked = true;
    }
    check(illegalBlocked, "배송중 → 결제완료 되돌리기 차단");

    console.log("\n[6] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let forbidden = false;
    try {
      await anonymous.adminOrder.list({});
    } catch (error) {
      forbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(forbidden, "관리자 세션 없이는 주문 목록 조회 불가");
  } finally {
    await db.delete(orders).where(inArray(orders.id, [created.orderId]));
    await db.delete(cart).where(eq(cart.id, cartRow.id));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
