/**
 * 체크아웃 라우터 검증 — tRPC 프로시저를 HTTP 없이 직접 호출해 화면이 쓰는 경로를 확인한다.
 * 실행: npm run check:checkout   (SSH 터널 켠 상태)
 *
 * 서비스 단위 검증(check:order3~5)과 달리 **zod 입력 검증·컨텍스트 해석까지** 지난다 —
 * 화면이 실제로 부르는 표면이 맞는지 보는 것이 목적이다.
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cart, cartItem, orders, productVariant } from "@/db/schema";
import {
  CART_COOKIE_NAME,
  createTRPCContext,
  GUEST_ORDER_COOKIE_NAME,
} from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";

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

/** 비회원 방문자 컨텍스트 — 카트 쿠키만 있고 세션은 없다 */
async function guestCaller(cartToken: string, guestOrderToken?: string) {
  const cookieParts = [`${CART_COOKIE_NAME}=${cartToken}`];
  if (guestOrderToken) cookieParts.push(`${GUEST_ORDER_COOKIE_NAME}=${guestOrderToken}`);
  const headers = new Headers({ cookie: cookieParts.join("; ") });
  return createCaller(await createTRPCContext({ headers }));
}

const ORDERER = { name: "체크아웃테스터", phone: "010-2222-3333", email: "checkout@example.com" };
const ADDRESS = {
  recipient: "체크아웃테스터",
  phone: "010-2222-3333",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
  addr2: "3층",
  deliveryMemo: "문 앞에 두고 벨 눌러주세요",
};

async function main() {
  console.log("PaRaSOL 체크아웃 라우터 검증 (임시 주문·카트는 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id, price: productVariant.price })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const cartToken = `CHECKOUT-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: 2 });

  const orderIds: number[] = [];
  try {
    const caller = await guestCaller(cartToken);

    console.log("\n[1] getCheckoutView — 진입 데이터 일괄 제공 기대");
    const view = await caller.order.getCheckoutView();
    check(view.isMember === false, "비회원 판정");
    check(view.cart.lines.length === 1, `카트 라인 ${view.cart.lines.length}건`);
    check(view.addresses.length === 0, "비회원은 저장 배송지 없음");
    check(view.ordererPrefill.name === "", "비회원은 주문자 프리필 비어 있음");
    check(view.terms.length > 0, `동의 대상 약관 ${view.terms.length}건`);
    check(
      view.terms.every((termsDoc) => termsDoc.isRequired || termsDoc.termsCode === "marketing"),
      "동의 대상은 필수 + 마케팅만 (안내 문서 제외)",
      view.terms.map((termsDoc) => termsDoc.termsCode),
    );
    check(
      view.cart.summary.grandTotal ===
        view.cart.summary.subtotal + view.cart.summary.shippingFee,
      "금액 요약 일관",
      view.cart.summary,
    );

    console.log("\n[2] createOrder — 화면 입력 그대로 주문 생성 기대");
    const requiredTermsIds = view.terms
      .filter((termsDoc) => termsDoc.isRequired)
      .map((termsDoc) => termsDoc.termsDocumentId);
    const created = await caller.order.createOrder({
      orderer: ORDERER,
      shippingAddress: ADDRESS,
      cartItemIds: view.cart.lines.map((line) => line.cartItemId),
      agreedTermsDocumentIds: requiredTermsIds,
    });
    orderIds.push(created.orderId);
    check(/^\d{8}-\d{4,}$/.test(created.orderNo), `주문번호 ${created.orderNo}`);
    check(
      created.grandTotal === view.cart.summary.grandTotal,
      "결제 예정금액이 요약과 일치",
      { view: view.cart.summary.grandTotal, created: created.grandTotal },
    );
    check(created.guestToken !== null, "비회원 guestToken 발급");

    console.log("\n[3] 필수 약관 누락 — 라우터가 거부 기대");
    const [secondCartRow] = await db
      .insert(cart)
      .values({ sessionToken: `${cartToken}-2` })
      .returning({ id: cart.id });
    await db.insert(cartItem).values({ cartId: secondCartRow.id, variantId: variant.id, quantity: 1 });
    const secondCaller = await guestCaller(`${cartToken}-2`);
    let termsRejected = false;
    let rejectMessage = "";
    try {
      await secondCaller.order.createOrder({
        orderer: ORDERER,
        shippingAddress: ADDRESS,
        agreedTermsDocumentIds: [],
      });
    } catch (error) {
      termsRejected = true;
      rejectMessage = error instanceof Error ? error.message : String(error);
    }
    check(termsRejected, "동의 없는 주문 거부");
    check(
      rejectMessage.includes("약관"),
      `사용자 문구로 번역됨: "${rejectMessage}"`,
    );
    await db.delete(cart).where(eq(cart.id, secondCartRow.id));

    console.log("\n[4] 조회 — 주문완료·비회원조회 경로 기대");
    // 주문완료는 발급받은 게스트 쿠키로 본인을 증명한다(URL에 토큰을 싣지 않는다)
    const completedCaller = await guestCaller(cartToken, created.guestToken ?? undefined);
    const result = await completedCaller.order.getOrderResult({ orderNo: created.orderNo });
    check(result.orderer.name === ORDERER.name, "주문완료는 마스킹 없음", result.orderer.name);

    let noCookieDenied = false;
    try {
      await caller.order.getOrderResult({ orderNo: created.orderNo });
    } catch {
      noCookieDenied = true;
    }
    check(noCookieDenied, "쿠키 없는 주문완료 조회 거부");

    const lookup = await caller.order.lookupGuestOrder({
      orderNo: created.orderNo,
      ordererPhone: ORDERER.phone,
    });
    check(lookup.orderer.name === "체***테스터".slice(0, 1) + "*".repeat(ORDERER.name.length - 1),
      `비회원조회는 마스킹 (${lookup.orderer.name})`);
    check(lookup.shippingAddress.deliveryMemo === null, "비회원조회는 배송메모 미노출");
  } finally {
    if (orderIds.length > 0) await db.delete(orders).where(inArray(orders.id, orderIds));
    await db.delete(cart).where(eq(cart.id, cartRow.id));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
