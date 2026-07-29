/**
 * 배송지 주소록 검증 — 주문이 주소록을 채우는지, 상한이 지켜지는지 실제 DB에서 확인한다.
 * 실행: npm run check:address-book   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **주소록 사정이 주문을 막지 않는다.** 저장은 어디까지나 편의라,
 * 중복이든 상한 초과든 주문은 그대로 성공해야 한다.
 *
 * 시나리오: [1]첫 주문이 주소록을 채운다(기본 배송지) [2]같은 주소 재주문은 중복 저장 안 함
 *           [3]다른 주소는 추가된다 [4]5개 상한 [5]상한 초과여도 주문은 성공
 *           [6]비회원 주문은 저장 대상이 아니다
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  address,
  cart,
  cartItem,
  customer,
  inventoryLog,
  orders,
  productVariant,
} from "@/db/schema";

import { MAX_SAVED_ADDRESSES } from "@/domain/address";

import { createAddress } from "../customer.service";
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

type Leftovers = { orderIds: number[]; cartIds: number[]; customerIds: number[]; refIds: string[] };

/** 주문 하나를 만든다 — 배송지만 바꿔가며 부른다 */
async function placeOrder(
  variantId: number,
  customerId: number | null,
  shipping: { zipcode: string; addr1: string; addr2?: string | null },
  leftovers: Leftovers,
) {
  const cartToken = `ADDR-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken, customerId })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity: 1 });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId,
    orderer: { name: `주소검증${SUFFIX}`, phone: "010-8282-9393", email: `addr-${SUFFIX}@example.com` },
    shippingAddress: {
      recipient: `주소검증${SUFFIX}`,
      phone: "010-8282-9393",
      zipcode: shipping.zipcode,
      addr1: shipping.addr1,
      addr2: shipping.addr2 ?? null,
    },
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  leftovers.refIds.push(created.orderNo);
  return created;
}

async function readAddresses(customerId: number) {
  return db
    .select({
      addressId: address.id,
      zipcode: address.zipcode,
      addr1: address.addr1,
      addr2: address.addr2,
      isDefault: address.isDefault,
    })
    .from(address)
    .where(eq(address.customerId, customerId))
    .orderBy(address.id);
}

async function main() {
  console.log("PaRaSOL 배송지 주소록 검증 (임시 회원·주문은 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], customerIds: [], refIds: [] };

  try {
    const [buyer] = await db
      .insert(customer)
      .values({ name: `주소검증${SUFFIX}`, email: `addr-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    leftovers.customerIds.push(buyer.id);

    console.log("\n[1] 첫 주문 — 주소록이 채워지고 기본이 된다 기대");
    check((await readAddresses(buyer.id)).length === 0, "가입 직후 주소록은 비어 있다");

    await placeOrder(variant.id, buyer.id, { zipcode: "04168", addr1: "서울 마포구 만리재로 00", addr2: "3층" }, leftovers);

    const afterFirst = await readAddresses(buyer.id);
    check(afterFirst.length === 1, `주문 배송지가 저장된다 (${afterFirst.length}건)`);
    check(
      afterFirst[0]?.isDefault === true,
      "첫 배송지는 기본이 된다 — 다음 체크아웃이 바로 채워진다",
    );
    check(afterFirst[0]?.addr2 === "3층", "상세주소까지 저장", afterFirst[0]?.addr2);

    console.log("\n[2] 같은 주소 재주문 — 중복 저장 안 함 기대");
    await placeOrder(variant.id, buyer.id, { zipcode: "04168", addr1: "서울 마포구 만리재로 00", addr2: "3층" }, leftovers);
    check(
      (await readAddresses(buyer.id)).length === 1,
      "같은 주소는 다시 쌓이지 않는다 — 열 번 주문해도 1건",
    );

    // 받는 분이 달라도 같은 곳이면 같은 주소로 본다
    await placeOrder(variant.id, buyer.id, { zipcode: "04168", addr1: "서울 마포구 만리재로 00", addr2: "3층" }, leftovers);
    check((await readAddresses(buyer.id)).length === 1, "세 번째 같은 주소도 그대로 1건");

    console.log("\n[3] 다른 주소 — 추가된다 기대");
    await placeOrder(variant.id, buyer.id, { zipcode: "48058", addr1: "부산 해운대구 우동 11", addr2: null }, leftovers);
    const afterSecond = await readAddresses(buyer.id);
    check(afterSecond.length === 2, `다른 주소는 추가 (${afterSecond.length}건)`);
    check(
      afterSecond.filter((row) => row.isDefault).length === 1,
      "기본 배송지는 여전히 하나뿐",
      afterSecond.map((row) => row.isDefault),
    );

    console.log("\n[4] 상한 — 5개까지 기대");
    // 3건을 직접 채워 5개를 만든다
    for (const index of [3, 4, 5]) {
      await createAddress(db, {
        customerId: buyer.id,
        recipient: `주소검증${SUFFIX}`,
        phone: "01082829393",
        zipcode: `1000${index}`,
        addr1: `테스트 주소 ${index}`,
      });
    }
    const filled = await readAddresses(buyer.id);
    check(filled.length === MAX_SAVED_ADDRESSES, `주소록 ${MAX_SAVED_ADDRESSES}건 채움 (${filled.length})`);

    let limitBlocked = false;
    try {
      await createAddress(db, {
        customerId: buyer.id,
        recipient: "초과",
        phone: "01082829393",
        zipcode: "10099",
        addr1: "초과 주소",
      });
    } catch (error) {
      limitBlocked = error instanceof Error && /5개까지/.test(error.message);
    }
    check(limitBlocked, "직접 추가는 상한에서 막힌다 — 화면이 아니라 서버가 판정한다");

    console.log("\n[5] 상한 초과 주문 — 주문은 성공한다 기대");
    const overflowOrder = await placeOrder(
      variant.id,
      buyer.id,
      { zipcode: "63322", addr1: "제주 어딘가 22", addr2: null },
      leftovers,
    );
    check(
      overflowOrder.orderNo.length > 0,
      "주소록이 꽉 찼어도 주문은 만들어진다 — 주소록 사정이 주문을 막으면 안 된다",
    );
    check(
      (await readAddresses(buyer.id)).length === MAX_SAVED_ADDRESSES,
      "새 주소는 저장되지 않는다(가장 오래된 것을 지우지도 않는다)",
    );

    console.log("\n[6] 비회원 주문 — 저장 대상 아님 기대");
    const beforeGuest = (await db.select({ id: address.id }).from(address)).length;
    await placeOrder(variant.id, null, { zipcode: "04168", addr1: "비회원 주소" }, leftovers);
    const afterGuest = (await db.select({ id: address.id }).from(address)).length;
    check(afterGuest === beforeGuest, "비회원 주문은 주소록을 만들지 않는다(귀속할 회원이 없다)");
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
    if (leftovers.customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, leftovers.customerIds));
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
