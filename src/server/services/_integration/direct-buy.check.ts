/**
 * 바로구매 검증 — 장바구니를 건드리지 않고 지금 고른 것만 주문되는지.
 * 실행: npm run check:direct-buy   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **바로구매는 장바구니와 완전히 분리된다.**
 * 같은 상품이 장바구니에 있어도 수량이 합쳐지지 않고, 바로구매 후에도 장바구니는 그대로다.
 *
 * 시나리오: [1]임시 카트 생성 [2]장바구니 불변 [3]수량 합산 없음 [4]주문 생성
 *           [5]토큰 접두사 방어 [6]재고 보정
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cart, cartItem, customer, inventoryLog, orders, productVariant } from "@/db/schema";

import {
  addCartItem,
  createDirectBuyCart,
  getCartWithItems,
  isDirectBuyToken,
} from "../cart.service";
import { createPendingOrder } from "../order.service";
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

async function main() {
  console.log("PaRaSOL 바로구매 검증 (임시 카트·주문은 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const cartTokens: string[] = [];
  const orderIds: number[] = [];
  const refIds: string[] = [];
  const customerIds: number[] = [];

  try {
    const [buyer] = await db
      .insert(customer)
      .values({ name: `바로구매${SUFFIX}`, email: `buy-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    customerIds.push(buyer.id);

    console.log("\n[1] 장바구니에 2개 담긴 상태에서 시작");
    const shoppingCartToken = `CART-${randomUUID()}`;
    cartTokens.push(shoppingCartToken);
    await addCartItem(db, { cartToken: shoppingCartToken, variantId: variant.id, quantity: 2 });
    const cartBefore = await getCartWithItems(db, shoppingCartToken);
    check(
      cartBefore.lines.length === 1 && cartBefore.lines[0].quantity === 2,
      "장바구니에 2개",
      cartBefore.lines.map((l) => l.quantity),
    );

    console.log("\n[2] 바로구매 1개 — 임시 카트가 따로 생긴다 기대");
    const directBuy = await createDirectBuyCart(db, {
      customerId: buyer.id,
      variantId: variant.id,
      quantity: 1,
    });
    cartTokens.push(directBuy.buyToken);

    check(isDirectBuyToken(directBuy.buyToken), "바로구매 토큰 접두사(bn_)", directBuy.buyToken);
    check(directBuy.buyToken !== shoppingCartToken, "장바구니와 다른 토큰");

    const directCart = await getCartWithItems(db, directBuy.buyToken);
    check(
      directCart.lines.length === 1 && directCart.lines[0].quantity === 1,
      "임시 카트에는 방금 고른 1개만",
      directCart.lines.map((l) => l.quantity),
    );

    console.log("\n[3] 장바구니 불변 — 합쳐지지 않는다 기대");
    const cartAfter = await getCartWithItems(db, shoppingCartToken);
    check(
      cartAfter.lines.length === 1 && cartAfter.lines[0].quantity === 2,
      "장바구니는 그대로 2개 — 바로구매가 담긴 수량을 건드리지 않는다",
      cartAfter.lines.map((l) => l.quantity),
    );
    check(
      directCart.lines[0].quantity !== cartAfter.lines[0].quantity + 1,
      "수량이 합쳐지지 않았다 — 화면에서 1개 골랐으면 결제도 1개다",
    );

    console.log("\n[4] 바로구매 토큰으로 주문 생성");
    const created = await createPendingOrder(db, {
      cartToken: directBuy.buyToken,
      customerId: buyer.id,
      orderer: { name: `바로구매${SUFFIX}`, phone: "010-2323-4545", email: `buy-${SUFFIX}@example.com` },
      shippingAddress: {
        recipient: `바로구매${SUFFIX}`,
        phone: "010-2323-4545",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        addr2: null,
      },
      agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
      agreementIp: "127.0.0.1",
    });
    orderIds.push(created.orderId);
    refIds.push(created.orderNo);

    const [orderRow] = await db
      .select({ subtotal: orders.subtotal })
      .from(orders)
      .where(eq(orders.id, created.orderId));
    const unitPrice = directCart.lines[0].unitPrice;
    check(
      orderRow.subtotal === unitPrice,
      `주문 금액이 1개 기준 (${orderRow.subtotal} = ${unitPrice})`,
    );

    const cartAfterOrder = await getCartWithItems(db, shoppingCartToken);
    check(
      cartAfterOrder.lines.length === 1 && cartAfterOrder.lines[0].quantity === 2,
      "주문 뒤에도 장바구니는 2개 그대로 — 담아둔 건 그대로 남는다",
      cartAfterOrder.lines.map((l) => l.quantity),
    );

    console.log("\n[5] 토큰 접두사 방어 — 장바구니 토큰은 URL로 통하지 않는다 기대");
    check(
      !isDirectBuyToken(shoppingCartToken),
      "일반 장바구니 토큰은 바로구매 토큰으로 인정되지 않는다 — 라우터가 이걸로 URL 경유를 막는다",
    );

    console.log("\n[6] 재고 보정 — 재고보다 많이 요청");
    const overflowBuy = await createDirectBuyCart(db, {
      customerId: buyer.id,
      variantId: variant.id,
      quantity: 9999,
    });
    cartTokens.push(overflowBuy.buyToken);
    check(
      overflowBuy.stockLimited && overflowBuy.appliedQuantity <= variant.stock,
      `재고만큼 보정된다 (${overflowBuy.appliedQuantity} ≤ ${variant.stock})`,
      overflowBuy,
    );
  } finally {
    if (refIds.length > 0) {
      await db.delete(inventoryLog).where(inArray(inventoryLog.refId, refIds));
    }
    if (orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (cartTokens.length > 0) {
      const rows = await db
        .select({ id: cart.id })
        .from(cart)
        .where(inArray(cart.sessionToken, cartTokens));
      const ids = rows.map((row) => row.id);
      if (ids.length > 0) {
        await db.delete(cartItem).where(inArray(cartItem.cartId, ids));
        await db.delete(cart).where(inArray(cart.id, ids));
      }
    }
    if (customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, customerIds));
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
