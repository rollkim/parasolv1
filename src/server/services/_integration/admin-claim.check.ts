/**
 * 관리자 클레임 관리(C6) 검증 — 목록·상세·처리를 **tRPC 라우터 경유로** 확인한다.
 * 실행: npm run check:admin-claim   (SSH 터널 켠 상태)
 *
 * C3·C4(서비스 레이어)는 check:claim3/4가 이미 검증한다. 여기서 새로 확인하는 것은
 * **관리자 표면**이다: 서버가 내려주는 행동 목록이 실제 처리 가능한 것과 일치하는가,
 * 라우터가 처리 로직을 복제하지 않고 위임하는가, 권한·검증이 HTTP 경계에서 서는가.
 *
 * pg_api 환불은 여기서 돌리지 않는다 — TOSS_SECRET_KEY가 있으면 실제 토스 API를 부른다.
 * 수동 채널(pg_console)은 게이트웨이를 부르지 않으므로 안전하고, D10의 핵심 경로다.
 *
 * 시나리오: [1]목록·필터·검색 [2]행동 목록이 상태를 따라간다 [3]반품 전 과정(라우터 경유)
 *           [4]수동 환불 근거 강제 [5]중복 처리 차단 [6]메모 [7]권한 게이트
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  adminUser,
  cart,
  cartItem,
  claim,
  inventoryLog,
  orderItem,
  orders,
  productVariant,
} from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

import { createStubPaymentGateway } from "../../payments/stub-payment-gateway";
import { requestClaim } from "../claim.service";
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
const ORDERER = { name: "C6검증자", phone: "010-7777-8888", email: "c6@example.com" };
const ADDRESS = {
  recipient: "C6검증자",
  phone: "010-7777-8888",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
};

type Leftovers = { orderIds: number[]; cartIds: number[]; refIds: string[] };

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

async function readStock(variantId: number): Promise<number> {
  const [row] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return row.stock;
}

/** 결제까지 완료된 주문 — 클레임은 실제 결제 건이 있어야 성립한다 */
async function setupPaidOrder(variantId: number, quantity: number, leftovers: Leftovers) {
  const cartToken = `C6-${randomUUID()}`;
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
  leftovers.refIds.push(created.orderNo);

  const { gateway } = createStubPaymentGateway();
  await confirmPayment(db, gateway, {
    orderNo: created.orderNo,
    paymentKey: `STUB-${randomUUID()}`,
    amount: created.grandTotal,
    cartToken,
  });
  return created;
}

async function advanceToDelivered(orderId: number) {
  for (const status of ["preparing", "shipping", "delivered"] as const) {
    await db.transaction((tx) =>
      applyOrderTransition(tx, { orderId, toStatus: status, actor: ADMIN, memo: "C6 준비" }),
    );
  }
}

async function firstOrderItemId(orderId: number): Promise<number> {
  const [row] = await db
    .select({ id: orderItem.id })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderId));
  return row.id;
}

/** 배송완료 주문 + 반품 클레임 한 건 */
async function setupReturnClaim(variantId: number, quantity: number, leftovers: Leftovers) {
  const created = await setupPaidOrder(variantId, quantity, leftovers);
  await advanceToDelivered(created.orderId);
  const orderItemId = await firstOrderItemId(created.orderId);
  const claimResult = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "return",
    reasonCode: "change_mind", // 구매자 귀책 → 반품 배송비 차감
    targets: [{ orderItemId, quantity: 1 }],
    customerId: null,
    guestToken: created.guestToken,
  });
  leftovers.refIds.push(claimResult.claimNo);
  return { created, claimResult };
}

async function main() {
  console.log("PaRaSOL 관리자 클레임(C6) 검증 (임시 주문·클레임은 종료 시 삭제)");

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

  const leftovers: Leftovers = { orderIds: [], cartIds: [], refIds: [] };

  try {
    const caller = await adminCaller(admin.id);
    const { created, claimResult } = await setupReturnClaim(variant.id, 3, leftovers);

    console.log("\n[1] 목록 — 유형·상태 필터와 검색 기대");
    const allList = await caller.adminClaim.list({});
    check(allList.totalCount > 0, `전체 ${allList.totalCount}건`);
    check(
      allList.typeCounts.all ===
        allList.typeCounts.cancel + allList.typeCounts.return + allList.typeCounts.exchange,
      "유형 건수 합이 전체와 같다",
      allList.typeCounts,
    );

    const returnOnly = await caller.adminClaim.list({ claimTypeFilter: "return" });
    check(
      returnOnly.cards.every((card) => card.claimType === "return"),
      "유형 필터가 반품만 남긴다",
    );

    const requestedOnly = await caller.adminClaim.list({ claimStatus: "requested" });
    check(
      requestedOnly.cards.some((card) => card.claimNo === claimResult.claimNo),
      "상태 필터(승인 대기)에 방금 접수한 건이 보인다",
    );

    const byOrderNo = await caller.adminClaim.list({ keyword: created.orderNo });
    check(
      byOrderNo.cards.some((card) => card.claimNo === claimResult.claimNo),
      "주문번호로 검색된다",
    );
    const byPhone = await caller.adminClaim.list({ keyword: "010-7777-8888" });
    check(
      byPhone.cards.some((card) => card.claimNo === claimResult.claimNo),
      "하이픈 연락처 검색도 찾는다",
    );

    console.log("\n[2] 상세 — 행동 목록이 상태를 따라간다 기대");
    const requestedDetail = await caller.adminClaim.detail({ claimNo: claimResult.claimNo });
    check(requestedDetail.claimStatus === "requested", `상태 ${requestedDetail.claimStatus}`);
    check(
      requestedDetail.availableActions.map((option) => option.action).join(",") ===
        "approve,reject",
      "접수 상태에서는 승인·반려만",
      requestedDetail.availableActions,
    );
    check(
      requestedDetail.amounts.refundAmount === claimResult.refundAmount,
      `환불 예정액이 접수 시 확정액과 같다 (${requestedDetail.amounts.refundAmount})`,
    );
    check(
      requestedDetail.timeline.steps.length === 4 && requestedDetail.timeline.currentStep === 0,
      "반품 타임라인 4단계 · 현재 접수",
      requestedDetail.timeline,
    );
    check(requestedDetail.items.length === 1, "대상 상품 1건", requestedDetail.items.length);

    console.log("\n[3] 반품 전 과정 — 라우터가 처리 서비스에 위임한다 기대");
    await caller.adminClaim.approve({ claimNo: claimResult.claimNo });
    const collectingDetail = await caller.adminClaim.detail({ claimNo: claimResult.claimNo });
    check(collectingDetail.claimStatus === "collecting", "승인 → 회수 중");
    check(
      collectingDetail.availableActions.map((option) => option.action).join(",") ===
        "markCollected",
      "회수 중에는 회수 완료만",
      collectingDetail.availableActions,
    );

    const stockBeforeCollect = await readStock(variant.id);
    await caller.adminClaim.markCollected({ claimNo: claimResult.claimNo });
    const inspectingDetail = await caller.adminClaim.detail({ claimNo: claimResult.claimNo });
    check(inspectingDetail.claimStatus === "inspecting", "회수 완료 → 검수 중");
    check(
      (await readStock(variant.id)) === stockBeforeCollect,
      "회수 완료 시점에는 재고를 올리지 않는다 — 검수 전 파손품이 판매 재고가 되면 안 된다",
    );
    check(
      inspectingDetail.availableActions.map((option) => option.action).join(",") === "refund,reject",
      "검수 중에는 환불·반려",
      inspectingDetail.availableActions,
    );

    // 수동 채널(pg_console) — 게이트웨이를 부르지 않는 경로. D10의 핵심
    const stockBeforeRefund = await readStock(variant.id);
    const refunded = await caller.adminClaim.refund({
      claimNo: claimResult.claimNo,
      refundChannel: "pg_console",
      refundReference: "TOSS-CONSOLE-991",
      restockable: true,
    });
    check(
      refunded.refundedAmount === claimResult.refundAmount,
      `환불 완료 (${refunded.refundedAmount})`,
    );
    check(
      (await readStock(variant.id)) === stockBeforeRefund + 1,
      `검수 합격 시점에 재고 복원 (${stockBeforeRefund} → ${await readStock(variant.id)})`,
    );
    const doneDetail = await caller.adminClaim.detail({ claimNo: claimResult.claimNo });
    check(doneDetail.claimStatus === "done", "클레임 종결");
    check(doneDetail.availableActions.length === 0, "종결 후 남은 행동 없음");
    check(
      doneDetail.history.some((row) => row.actor === `admin:${admin.id}`),
      "이력에 관리자 actor가 남는다",
      doneDetail.history.map((row) => row.actor),
    );

    console.log("\n[4] 수동 환불 근거 강제 — 참조 없으면 차단 기대");
    const secondCase = await setupReturnClaim(variant.id, 1, leftovers);
    await caller.adminClaim.approve({ claimNo: secondCase.claimResult.claimNo });
    await caller.adminClaim.markCollected({ claimNo: secondCase.claimResult.claimNo });

    let referenceBlocked = false;
    try {
      await caller.adminClaim.refund({
        claimNo: secondCase.claimResult.claimNo,
        refundChannel: "bank_transfer",
        refundReference: "   ",
      });
    } catch (error) {
      // 도메인이 던지고 HTTP 경계가 번역한다 — 500이 아니라 읽을 수 있는 문구여야 한다
      referenceBlocked = error instanceof Error && /참조 정보/.test(error.message);
    }
    check(referenceBlocked, "근거 없는 수동 환불 차단 — 대사 불가능한 기록을 만들지 않는다");

    console.log("\n[5] 중복 처리 차단 — 이미 종결된 건 기대");
    let duplicateBlocked = false;
    try {
      await caller.adminClaim.approve({ claimNo: claimResult.claimNo });
    } catch (error) {
      duplicateBlocked = error instanceof Error && /이미 처리된/.test(error.message);
    }
    check(duplicateBlocked, "종결된 클레임 재처리 차단 — 안내 문구로 번역된다");

    let rejectReasonRequired = false;
    try {
      await caller.adminClaim.reject({
        claimNo: secondCase.claimResult.claimNo,
        memo: "   ",
      });
    } catch {
      rejectReasonRequired = true;
    }
    check(rejectReasonRequired, "사유 없는 반려 차단 — 고객에게 안내할 문구가 없다");

    console.log("\n[6] 관리자 메모 기대");
    await caller.adminClaim.saveMemo({
      claimNo: secondCase.claimResult.claimNo,
      memo: "고객 통화 완료",
    });
    const memoDetail = await caller.adminClaim.detail({
      claimNo: secondCase.claimResult.claimNo,
    });
    check(memoDetail.adminMemo === "고객 통화 완료", "메모 저장", memoDetail.adminMemo);

    console.log("\n[7] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let listForbidden = false;
    let refundForbidden = false;
    try {
      await anonymous.adminClaim.list({});
    } catch (error) {
      listForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminClaim.refund({ claimNo: secondCase.claimResult.claimNo });
    } catch (error) {
      refundForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(listForbidden, "관리자 세션 없이는 목록 조회 불가");
    check(refundForbidden, "관리자 세션 없이는 환불 실행 불가");
  } finally {
    if (leftovers.refIds.length > 0) {
      await db.delete(inventoryLog).where(inArray(inventoryLog.refId, leftovers.refIds));
    }
    if (leftovers.orderIds.length > 0) {
      // claim은 order에 cascade로 물려 있다
      await db.delete(claim).where(inArray(claim.orderId, leftovers.orderIds));
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
