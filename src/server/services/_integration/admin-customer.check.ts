/**
 * 관리자 회원 관리 검증 — 목록·상세·정지·강제 탈퇴를 실제 DB에서 확인한다.
 * 실행: npm run check:admin-customer   (SSH 터널 켠 상태)
 *
 * 핵심 검증은 **강제 탈퇴**다. 개인정보를 지우면서 주문 이력은 남겨야 하고, 로그인 수단을
 * 지우지 않으면 소셜 로그인으로 같은 계정이 되살아난다 — 되돌릴 수 없는 조치라 한 번에 맞아야 한다.
 *
 * 시나리오: [1]목록·탭·검색 [2]누적 구매액이 취소를 뺀다 [3]상세 [4]정지·해제
 *           [5]강제 탈퇴(개인정보 삭제·주문 보존·재탈퇴 차단) [6]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  address,
  adminUser,
  cart,
  cartItem,
  customer,
  customerAuth,
  orders,
  productVariant,
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

const SUFFIX = randomUUID().slice(0, 8);
const TEST_EMAIL = `checkmember-${SUFFIX}@example.com`;
const TEST_PHONE = "01044445555";

async function main() {
  console.log("PaRaSOL 관리자 회원 관리 검증 (임시 회원·주문은 종료 시 삭제)");

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

  const createdCustomerIds: number[] = [];
  const createdOrderIds: number[] = [];
  const createdCartIds: number[] = [];

  try {
    const caller = await adminCaller(admin.id);

    // 검증용 회원 — 배송지·로그인 수단까지 갖춘 '진짜' 회원이어야 탈퇴 검증이 의미 있다
    const [createdCustomer] = await db
      .insert(customer)
      .values({
        name: `검증회원${SUFFIX}`,
        email: TEST_EMAIL,
        phone: TEST_PHONE,
        isActive: true,
      })
      .returning({ id: customer.id });
    createdCustomerIds.push(createdCustomer.id);

    await db.insert(customerAuth).values({
      customerId: createdCustomer.id,
      provider: "local",
      providerUid: TEST_EMAIL,
      passwordHash: "$2b$10$notarealhashnotarealhashnotarealhashnotarealhash",
    });
    await db.insert(address).values({
      customerId: createdCustomer.id,
      recipient: `검증회원${SUFFIX}`,
      phone: TEST_PHONE,
      zipcode: "04168",
      addr1: "서울특별시 마포구 만리재로 00",
      isDefault: true,
    });

    console.log("\n[1] 목록 — 탭·검색 기대");
    const allList = await caller.adminCustomer.list({});
    check(allList.totalCount > 0, `전체 ${allList.totalCount}명`);
    check(
      allList.tabCounts.all ===
        allList.tabCounts.active + allList.tabCounts.suspended + allList.tabCounts.withdrawn,
      "탭 건수 합이 전체와 같다 — 상태가 겹치지 않는다",
      allList.tabCounts,
    );

    const byEmail = await caller.adminCustomer.list({ keyword: TEST_EMAIL });
    check(
      byEmail.cards.some((card) => card.customerId === createdCustomer.id),
      "이메일로 검색된다",
    );
    const byPhone = await caller.adminCustomer.list({ keyword: "010-4444-5555" });
    check(
      byPhone.cards.some((card) => card.customerId === createdCustomer.id),
      "하이픈 연락처 검색도 찾는다",
    );
    const listedCard = byEmail.cards.find((card) => card.customerId === createdCustomer.id);
    check(listedCard?.phone === "010-4444-5555", "목록 연락처는 하이픈 표기", listedCard?.phone);

    console.log("\n[2] 누적 구매액 — 취소 주문은 빠진다 기대");
    const cartToken = `MEMBER-${randomUUID()}`;
    const [cartRow] = await db
      .insert(cart)
      .values({ sessionToken: cartToken, customerId: createdCustomer.id })
      .returning({ id: cart.id });
    createdCartIds.push(cartRow.id);
    await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: 1 });

    const created = await createPendingOrder(db, {
      cartToken,
      customerId: createdCustomer.id,
      orderer: { name: `검증회원${SUFFIX}`, phone: "010-4444-5555", email: TEST_EMAIL },
      shippingAddress: {
        recipient: `검증회원${SUFFIX}`,
        phone: "010-4444-5555",
        zipcode: "04168",
        addr1: "서울특별시 마포구 만리재로 00",
      },
      agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
      agreementIp: "127.0.0.1",
    });
    createdOrderIds.push(created.orderId);

    const { gateway } = createStubPaymentGateway();
    await confirmPayment(db, gateway, {
      orderNo: created.orderNo,
      paymentKey: `STUB-${randomUUID()}`,
      amount: created.grandTotal,
      cartToken,
    });

    const afterPaid = await caller.adminCustomer.detail({ customerId: createdCustomer.id });
    check(
      afterPaid.orderSummary.orderCount === 1 &&
        afterPaid.orderSummary.totalSpending === created.grandTotal,
      `결제 주문이 누적 구매액에 잡힌다 (${afterPaid.orderSummary.totalSpending})`,
    );

    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: created.orderId,
        toStatus: "cancelled",
        actor: { role: "admin", id: admin.id },
        memo: "회원 검증",
      }),
    );
    const afterCancel = await caller.adminCustomer.detail({ customerId: createdCustomer.id });
    check(
      afterCancel.orderSummary.orderCount === 0 && afterCancel.orderSummary.totalSpending === 0,
      "취소하면 누적 구매액에서 빠진다 — 취소를 포함하면 '많이 산 고객'을 잘못 고른다",
      afterCancel.orderSummary,
    );
    check(
      afterCancel.recentOrders.length === 1,
      "최근 주문 목록에는 취소 주문도 보인다 — CS가 확인해야 한다",
    );

    console.log("\n[3] 상세 — 배송지·로그인 수단 기대");
    check(afterCancel.addresses.length === 1, "배송지 1건");
    check(
      afterCancel.loginProviders.includes("local"),
      "로그인 수단 표시",
      afterCancel.loginProviders,
    );
    check(afterCancel.statusLabel === "정상", `상태 라벨 ${afterCancel.statusLabel}`);

    console.log("\n[4] 정지·해제 — 되돌릴 수 있다 기대");
    await caller.adminCustomer.changeActive({ customerId: createdCustomer.id, isActive: false });
    const suspended = await caller.adminCustomer.detail({ customerId: createdCustomer.id });
    check(suspended.isActive === false && suspended.statusLabel === "정지", "정지 반영");

    const suspendedList = await caller.adminCustomer.list({ tab: "suspended", keyword: TEST_EMAIL });
    check(
      suspendedList.cards.some((card) => card.customerId === createdCustomer.id),
      "정지 탭에 잡힌다",
    );

    await caller.adminCustomer.changeActive({ customerId: createdCustomer.id, isActive: true });
    const resumed = await caller.adminCustomer.detail({ customerId: createdCustomer.id });
    check(resumed.isActive === true, "정지 해제 반영 — 되돌릴 수 있는 조치다");

    await caller.adminCustomer.saveMemo({
      customerId: createdCustomer.id,
      memo: "검증용 메모",
    });
    const memoed = await caller.adminCustomer.detail({ customerId: createdCustomer.id });
    check(memoed.adminMemo === "검증용 메모", "메모 저장", memoed.adminMemo);

    console.log("\n[5] 강제 탈퇴 — 개인정보 삭제·주문 보존 기대");
    const withdrawResult = await caller.adminCustomer.withdraw({
      customerId: createdCustomer.id,
    });
    check(withdrawResult.removedAddressCount === 1, "배송지 삭제 1건");
    check(withdrawResult.removedAuthCount === 1, "로그인 수단 삭제 1건");

    const [rawCustomer] = await db
      .select({
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        deletedAt: customer.deletedAt,
        isActive: customer.isActive,
        adminMemo: customer.adminMemo,
      })
      .from(customer)
      .where(eq(customer.id, createdCustomer.id));
    check(
      rawCustomer.email === null && rawCustomer.phone === null && rawCustomer.name === "탈퇴회원",
      "이름·이메일·연락처가 지워진다",
      rawCustomer,
    );
    check(rawCustomer.deletedAt !== null && rawCustomer.isActive === false, "탈퇴 표시");
    check(
      rawCustomer.adminMemo?.includes("검증용 메모") === true &&
        rawCustomer.adminMemo.includes("강제 탈퇴"),
      "기존 메모는 남고 탈퇴 기록이 덧붙는다 — 분쟁 대응 근거",
      rawCustomer.adminMemo,
    );

    const remainingAuth = await db
      .select({ id: customerAuth.id })
      .from(customerAuth)
      .where(eq(customerAuth.customerId, createdCustomer.id));
    check(
      remainingAuth.length === 0,
      "로그인 수단이 남지 않는다 — 남으면 소셜 로그인으로 계정이 되살아난다",
    );

    const survivingOrders = await db
      .select({ id: orders.id, ordererName: orders.ordererName })
      .from(orders)
      .where(eq(orders.customerId, createdCustomer.id));
    check(
      survivingOrders.length === 1,
      "주문은 남는다 — 배송·정산·분쟁 대응에 필요하다",
      survivingOrders.length,
    );
    check(
      survivingOrders[0]?.ordererName.includes(SUFFIX) === true,
      "주문의 주문자 스냅샷은 그대로 — 지우면 배송·CS가 불가능해진다",
    );

    const withdrawnList = await caller.adminCustomer.list({ tab: "withdrawn" });
    check(
      withdrawnList.cards.some((card) => card.customerId === createdCustomer.id),
      "탈퇴 탭에 잡힌다",
    );

    let secondWithdrawBlocked = false;
    try {
      await caller.adminCustomer.withdraw({ customerId: createdCustomer.id });
    } catch (error) {
      secondWithdrawBlocked = error instanceof Error && /이미 탈퇴/.test(error.message);
    }
    check(secondWithdrawBlocked, "이미 탈퇴한 회원은 다시 탈퇴할 수 없다");

    let suspendBlocked = false;
    try {
      await caller.adminCustomer.changeActive({
        customerId: createdCustomer.id,
        isActive: true,
      });
    } catch (error) {
      suspendBlocked = error instanceof Error && /회원을 찾을 수 없습니다/.test(error.message);
    }
    check(suspendBlocked, "탈퇴 회원은 정지 해제 대상이 아니다");

    console.log("\n[6] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let listForbidden = false;
    let withdrawForbidden = false;
    try {
      await anonymous.adminCustomer.list({});
    } catch (error) {
      listForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminCustomer.withdraw({ customerId: createdCustomer.id });
    } catch (error) {
      withdrawForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(listForbidden, "관리자 세션 없이는 회원 목록 조회 불가");
    check(withdrawForbidden, "관리자 세션 없이는 강제 탈퇴 불가");
  } finally {
    if (createdOrderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, createdOrderIds));
    }
    if (createdCartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, createdCartIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds));
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
