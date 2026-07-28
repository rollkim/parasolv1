/**
 * 클레임 C5 검증 — 신청 화면이 쓰는 tRPC 표면을 HTTP 없이 직접 호출해 확인한다.
 * 실행: npm run check:claim5   (SSH 터널 켠 상태)
 *
 * 화면은 금액을 **도메인 함수로 직접 계산**한다(서버 왕복 없이 사유를 바꿔가며 미리보기).
 * 그 계산이 실제 접수 결과와 일치하는지가 이 스크립트의 핵심 검증이다 —
 * 어긋나면 "화면엔 4,500원이라 써 있었는데 4,000원만 환불" 같은 분쟁이 된다.
 *
 * 시나리오: [1]진입 데이터 [2]화면 계산 = 접수 결과 [3]잔여 수량 반영 [4]사유 필터 [5]오류 문구
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cart, cartItem, orders, productVariant } from "@/db/schema";
import { calcClaimAmounts } from "@/domain/claim";
import {
  CART_COOKIE_NAME,
  createTRPCContext,
  GUEST_ORDER_COOKIE_NAME,
} from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";

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

const ORDERER = { name: "C5테스터", phone: "010-4444-5555", email: "c5@example.com" };
const ADDRESS = {
  recipient: "C5테스터",
  phone: "010-4444-5555",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
};

async function guestCaller(cartToken: string, guestOrderToken?: string) {
  const cookieParts = [`${CART_COOKIE_NAME}=${cartToken}`];
  if (guestOrderToken) cookieParts.push(`${GUEST_ORDER_COOKIE_NAME}=${guestOrderToken}`);
  return createCaller(await createTRPCContext({ headers: new Headers({ cookie: cookieParts.join("; ") }) }));
}

async function main() {
  console.log("PaRaSOL 클레임 C5 검증 (임시 주문은 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id, price: productVariant.price })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const cartToken = `CLAIM5-${randomUUID()}`;
  const [cartRow] = await db.insert(cart).values({ sessionToken: cartToken }).returning({ id: cart.id });
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: 3 });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });

  try {
    for (const status of ["paid", "preparing", "shipping", "delivered"] as const) {
      await db.transaction((tx) =>
        applyOrderTransition(tx, {
          orderId: created.orderId,
          toStatus: status,
          actor: status === "paid" ? { role: "system" } : { role: "admin", id: 1 },
          memo: "C5 준비",
        }),
      );
    }

    const caller = await guestCaller(cartToken, created.guestToken ?? undefined);

    console.log("\n[1] 진입 데이터 — 대상·사유·배송비 기준 기대");
    const requestView = await caller.claim.getRequestView({
      orderNo: created.orderNo,
      claimType: "return",
    });
    check(requestView.targets.length === 1, `대상 품목 ${requestView.targets.length}건`);
    check(
      requestView.targets[0].claimableQuantity === 3,
      `잔여 수량 3 (실제 ${requestView.targets[0].claimableQuantity})`,
    );
    check(requestView.baseShippingFee > 0, `기본 배송비 ${requestView.baseShippingFee}`);
    check(!requestView.wholeOrderOnly, "반품은 부분 선택 가능");
    check(requestView.feeMethods[0] === "deduct_refund", "반품 수취방법 차감 고정");

    console.log("\n[2] 화면 계산 = 접수 결과 기대 (표시 금액과 실제 금액 일치)");
    const buyerReason = requestView.reasons.find((reason) => reason.fault === "buyer");
    if (!buyerReason) throw new Error("구매자 귀책 사유가 없다 — 시드 확인");

    // 화면이 하는 계산을 그대로 재현한다
    const previewed = calcClaimAmounts({
      claimType: "return",
      fault: buyerReason.fault,
      baseFee: requestView.baseShippingFee,
      orderShippingFee: requestView.orderShippingFee,
      lines: [
        {
          unitPrice: requestView.targets[0].unitPrice,
          claimQuantity: 2,
          orderedQuantity: requestView.targets[0].orderedQuantity,
          addonTotal: requestView.targets[0].addonTotal,
        },
      ],
    });

    const submitted = await caller.claim.request({
      orderNo: created.orderNo,
      claimType: "return",
      reasonCode: buyerReason.reasonCode,
      targets: [{ orderItemId: requestView.targets[0].orderItemId, quantity: 2 }],
    });

    check(
      submitted.goodsAmount === previewed.goodsAmount,
      `상품금액 일치 (미리보기 ${previewed.goodsAmount} = 접수 ${submitted.goodsAmount})`,
    );
    check(
      submitted.shippingFee === previewed.shippingFee,
      `배송비 일치 (${previewed.shippingFee})`,
    );
    check(
      submitted.refundAmount === previewed.refundAmount,
      `환불액 일치 (${previewed.refundAmount})`,
    );
    check(/^RT-\d{8}-\d{4,}$/.test(submitted.claimNo), `접수번호 ${submitted.claimNo}`);

    console.log("\n[3] 잔여 수량 반영 — 재진입 시 줄어든다 기대");
    const afterView = await caller.claim.getRequestView({
      orderNo: created.orderNo,
      claimType: "return",
    });
    check(
      afterView.targets[0].claimedQuantity === 2 && afterView.targets[0].claimableQuantity === 1,
      `이미 접수 2 · 잔여 1 (실제 ${afterView.targets[0].claimedQuantity}/${afterView.targets[0].claimableQuantity})`,
      afterView.targets[0],
    );

    console.log("\n[4] 사유 필터 — 유형별로 다르게 내려온다 기대");
    const exchangeView = await caller.claim.getRequestView({
      orderNo: created.orderNo,
      claimType: "exchange",
    });
    const returnCodes = requestView.reasons.map((reason) => reason.reasonCode);
    const exchangeCodes = exchangeView.reasons.map((reason) => reason.reasonCode);
    check(
      returnCodes.includes("change_mind") && !exchangeCodes.includes("change_mind"),
      "단순변심은 반품만(교환 불가) — 시드 정책 반영",
      { returnCodes, exchangeCodes },
    );
    check(
      exchangeCodes.includes("wrong_option"),
      "옵션 오선택은 교환에만",
      exchangeCodes,
    );
    check(exchangeView.feeMethods[0] === "bank_transfer", "교환 수취방법 계좌이체");

    console.log("\n[5] 오류 문구 — 사용자 문장으로 번역 기대");
    let overMessage = "";
    try {
      await caller.claim.request({
        orderNo: created.orderNo,
        claimType: "return",
        reasonCode: buyerReason.reasonCode,
        targets: [{ orderItemId: requestView.targets[0].orderItemId, quantity: 3 }],
      });
    } catch (error) {
      overMessage = error instanceof Error ? error.message : String(error);
    }
    check(
      /[가-힣]/.test(overMessage) && !/Error:|at \w+\./.test(overMessage),
      `수량 초과 문구: "${overMessage}"`,
    );

    let wrongReasonMessage = "";
    try {
      await caller.claim.request({
        orderNo: created.orderNo,
        claimType: "exchange",
        reasonCode: "change_mind",
        targets: [{ orderItemId: requestView.targets[0].orderItemId, quantity: 1 }],
      });
    } catch (error) {
      wrongReasonMessage = error instanceof Error ? error.message : String(error);
    }
    check(
      /[가-힣]/.test(wrongReasonMessage) && !/Error:|at \w+\./.test(wrongReasonMessage),
      `사유 불일치 문구: "${wrongReasonMessage}"`,
    );
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
