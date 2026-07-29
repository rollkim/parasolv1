/**
 * 도서·산간 추가배송비 검증 — 주문 금액에 실제로 반영되는지 본다.
 * 실행: npm run check:remote-shipping   (SSH 터널 켠 상태)
 *
 * 도메인 함수는 단위 테스트가 지킨다(domain/cart.test.ts). 여기서 확인할 것은
 * **설정값이 주문 금액까지 실제로 흘러가는가**다 — 화면에 보인 금액과 결제액이 갈리면
 * 고객은 다른 금액을 결제하게 되고, 금액 검증(assertPaidAmountMatches)에 걸려 결제가 막힌다.
 *
 * 시나리오: [1]육지 주문 [2]제주 주문에 추가비 [3]무료배송이어도 추가비는 붙는다
 *           [4]설정이 0이면 붙지 않는다
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { cart, cartItem, orders, productVariant, siteSetting } from "@/db/schema";

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

const ORDERER = { name: "도서산간검증", phone: "010-6161-7272", email: "remote@example.com" };

const MAINLAND_ZIP = "04168"; // 서울 마포
const JEJU_ZIP = "63322"; // 제주

type Leftovers = { orderIds: number[]; cartIds: number[] };

async function placeOrder(
  variantId: number,
  quantity: number,
  zipcode: string,
  leftovers: Leftovers,
) {
  const cartToken = `REMOTE-${randomUUID()}`;
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
    shippingAddress: {
      recipient: "도서산간검증",
      phone: "010-6161-7272",
      zipcode,
      addr1: "테스트 주소",
    },
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);

  const [row] = await db
    .select({
      subtotal: orders.subtotal,
      shippingFee: orders.shippingFee,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(eq(orders.id, created.orderId));
  return row;
}

async function setShippingPolicy(policy: {
  baseFee: number;
  freeThreshold: number;
  remoteSurcharge: number;
}) {
  await db
    .insert(siteSetting)
    .values({ key: "shipping_policy", value: policy })
    .onConflictDoUpdate({ target: siteSetting.key, set: { value: policy } });
}

async function main() {
  console.log("PaRaSOL 도서·산간 배송비 검증 (설정·임시 주문은 종료 시 복원)");

  const [variant] = await db
    .select({ id: productVariant.id, price: productVariant.price })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const [originalPolicy] = await db
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, "shipping_policy"));

  const leftovers: Leftovers = { orderIds: [], cartIds: [] };

  try {
    // 상품 1개로 무료배송 기준을 못 넘게, 여러 개로 넘게 만들 수 있는 정책을 세운다
    const freeThreshold = variant.price * 3;
    await setShippingPolicy({ baseFee: 3000, freeThreshold, remoteSurcharge: 3000 });

    console.log("\n[1] 육지 주문 — 기본 배송비만 기대");
    const mainland = await placeOrder(variant.id, 1, MAINLAND_ZIP, leftovers);
    check(mainland.shippingFee === 3000, `배송비 3000 (${mainland.shippingFee})`);
    check(
      mainland.grandTotal === mainland.subtotal + mainland.shippingFee,
      "합계가 상품+배송비",
      mainland,
    );

    console.log("\n[2] 제주 주문 — 추가비가 붙는다 기대");
    const jeju = await placeOrder(variant.id, 1, JEJU_ZIP, leftovers);
    check(
      jeju.shippingFee === 6000,
      `배송비 3000 + 추가 3000 = 6000 (${jeju.shippingFee}) — 설정값이 주문까지 흘러간다`,
    );
    check(
      jeju.grandTotal === mainland.grandTotal + 3000,
      `같은 상품인데 제주가 3000원 비싸다 (${mainland.grandTotal} → ${jeju.grandTotal})`,
    );

    console.log("\n[3] 무료배송 기준 초과 — 추가비는 여전히 붙는다 기대");
    const freeMainland = await placeOrder(variant.id, 3, MAINLAND_ZIP, leftovers);
    check(freeMainland.shippingFee === 0, `육지 무료배송 (${freeMainland.shippingFee})`);

    const freeJeju = await placeOrder(variant.id, 3, JEJU_ZIP, leftovers);
    check(
      freeJeju.shippingFee === 3000,
      `제주는 무료배송이어도 추가비 3000 (${freeJeju.shippingFee}) — 묻어 보내면 그만큼이 손실이다`,
    );

    console.log("\n[4] 추가비 0 설정 — 붙지 않는다 기대");
    await setShippingPolicy({ baseFee: 3000, freeThreshold, remoteSurcharge: 0 });
    const noSurcharge = await placeOrder(variant.id, 1, JEJU_ZIP, leftovers);
    check(
      noSurcharge.shippingFee === 3000,
      `추가비를 설정하지 않은 몰에는 갑자기 붙지 않는다 (${noSurcharge.shippingFee})`,
    );
  } finally {
    if (leftovers.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    await db.delete(siteSetting).where(eq(siteSetting.key, "shipping_policy"));
    if (originalPolicy) {
      await db
        .insert(siteSetting)
        .values({ key: "shipping_policy", value: originalPolicy.value });
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
