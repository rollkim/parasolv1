/**
 * Phase 3 검증 — 주문 생성(TXN-1)과 상태 초크포인트를 실제 DB에서 확인한다.
 * 실행: npm run check:order3   (SSH 터널 켠 상태)
 *
 * `tsx --conditions=react-server`로 도는 이유는 order-phase2.check.ts 주석 참조.
 * 생성한 주문·카트는 끝나면 삭제한다(cascade로 품목·이력·결제도 함께 정리).
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  orderItem,
  orders,
  orderStatusHistory,
  payment,
  productVariant,
  termsDocument,
} from "@/db/schema";
import { IllegalOrderTransitionError } from "@/domain/order";

import { applyOrderTransition } from "../order-status.service";
import { createPendingOrder, TermsNotAgreedError } from "../order.service";

/** 필수 약관 문서 id — 주문 생성이 동의 증빙을 요구한다 */
async function loadRequiredTermsIds(): Promise<number[]> {
  const rows = await db
    .select({ id: termsDocument.id })
    .from(termsDocument)
    .where(and(eq(termsDocument.isRequired, true), lte(termsDocument.effectiveAt, new Date())));
  return rows.map((row) => row.id);
}

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

/** 판매 가능한 variant로 임시 카트를 만든다 */
async function setupCart(quantity: number) {
  const [variant] = await db
    .select({ id: productVariant.id, price: productVariant.price, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("variant 없음 — npm run db:seed:dev 먼저 실행");

  const cartToken = `CHECK3-${randomUUID()}`;
  const [cartRow] = await db.insert(cart).values({ sessionToken: cartToken }).returning({ id: cart.id });
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity });
  return { cartToken, cartId: cartRow.id, variant };
}

async function cleanupCart(cartId: number, orderIds: number[]) {
  if (orderIds.length > 0) await db.delete(orders).where(inArray(orders.id, orderIds));
  await db.delete(cart).where(eq(cart.id, cartId));
}

const ORDERER = { name: "검증테스터", phone: "01000000000", email: "check@example.com" };
const ADDRESS = {
  recipient: "검증테스터",
  phone: "01000000000",
  zipcode: "04000",
  addr1: "서울 마포구 만리재로 1",
  addr2: "3층",
};

/** ① 주문 생성: 금액 서버 계산 + 재고 무점유 + 카트 유지 */
async function checkCreatePendingOrder() {
  console.log("\n[1] 주문 생성 — 금액 서버계산·재고 무점유·카트 유지 기대");
  const { cartToken, cartId, variant } = await setupCart(2);
  const orderIds: number[] = [];
  try {
    const created = await createPendingOrder(db, {
      cartToken,
      customerId: null,
      orderer: ORDERER,
      shippingAddress: ADDRESS,
      agreedTermsDocumentIds: await loadRequiredTermsIds(),
      agreementIp: "127.0.0.1",
    });
    orderIds.push(created.orderId);

    const expectedSubtotal = variant.price * 2;
    const expectedShipping = expectedSubtotal >= 30000 ? 0 : 3000;
    check(
      created.grandTotal === expectedSubtotal + expectedShipping,
      `금액 서버계산 (기대 ${expectedSubtotal + expectedShipping} / 실제 ${created.grandTotal})`,
    );
    check(/^\d{8}-\d{4,}$/.test(created.orderNo), `주문번호 형식 ${created.orderNo}`);
    check(created.guestToken !== null, "비회원 주문에 guestToken 발급");

    // ★핵심 불변식: pending은 재고를 잡지 않는다
    const [afterStock] = await db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, variant.id));
    check(afterStock.stock === variant.stock, `재고 무변동 (${variant.stock} → ${afterStock.stock})`);

    // 카트는 결제 성공 시에만 비운다(재시도 UX 보존)
    const cartItems = await db.select({ id: cartItem.id }).from(cartItem).where(eq(cartItem.cartId, cartId));
    check(cartItems.length === 1, `카트 유지 (라인 ${cartItems.length})`);

    // 스냅샷·결제대기·이력
    const items = await db
      .select({ productName: orderItem.productName, unitPrice: orderItem.unitPrice })
      .from(orderItem)
      .where(eq(orderItem.orderId, created.orderId));
    check(items.length === 1 && items[0].unitPrice === variant.price, "품목 스냅샷 기록", items);

    const [pay] = await db
      .select({ status: payment.status, amount: payment.amount })
      .from(payment)
      .where(eq(payment.orderId, created.orderId));
    check(pay?.status === "ready" && pay.amount === created.grandTotal, "결제행 ready 생성", pay);

    const history = await db
      .select({ from: orderStatusHistory.fromStatus, to: orderStatusHistory.toStatus })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, created.orderId));
    check(history.length === 1 && history[0].from === null && history[0].to === "pending", "생성 이력 기록", history);

    return { orderId: created.orderId, cartId, orderIds };
  } catch (error) {
    await cleanupCart(cartId, orderIds);
    throw error;
  }
}

/** ② 상태 초크포인트: 합법 전이·멱등·불법 차단·이력 */
async function checkTransitions(orderId: number) {
  console.log("\n[2] 상태 전이 — 합법·멱등·불법차단 기대");

  const first = await db.transaction((tx) =>
    applyOrderTransition(tx, { orderId, toStatus: "paid", actor: { role: "system" }, memo: "검증" }),
  );
  check(first.changed && first.fromStatus === "pending", "pending→paid 전이", first);

  // 같은 전이를 다시 — 결제 콜백 중복 도착 상황
  const again = await db.transaction((tx) =>
    applyOrderTransition(tx, { orderId, toStatus: "paid", actor: { role: "system" } }),
  );
  check(!again.changed, "동일 상태 재전이는 멱등(no-op)");

  // 불법: paid에서 delivered로 건너뛰기
  let illegalBlocked = false;
  try {
    await db.transaction((tx) =>
      applyOrderTransition(tx, { orderId, toStatus: "delivered", actor: { role: "admin" } }),
    );
  } catch (error) {
    illegalBlocked = error instanceof IllegalOrderTransitionError;
  }
  check(illegalBlocked, "불법 전이(paid→delivered) 차단");

  // 권한: 고객은 배송준비로 못 바꾼다
  let roleBlocked = false;
  try {
    await db.transaction((tx) =>
      applyOrderTransition(tx, { orderId, toStatus: "preparing", actor: { role: "customer", id: 1 } }),
    );
  } catch (error) {
    roleBlocked = error instanceof IllegalOrderTransitionError;
  }
  check(roleBlocked, "권한 없는 actor(customer→preparing) 차단");

  // delivered 전이 시 delivered_at 자동 기록
  await db.transaction((tx) =>
    applyOrderTransition(tx, { orderId, toStatus: "preparing", actor: { role: "admin", id: 1 } }),
  );
  await db.transaction((tx) =>
    applyOrderTransition(tx, { orderId, toStatus: "shipping", actor: { role: "admin", id: 1 } }),
  );
  await db.transaction((tx) =>
    applyOrderTransition(tx, { orderId, toStatus: "delivered", actor: { role: "admin", id: 1 } }),
  );
  const [row] = await db
    .select({ status: orders.status, deliveredAt: orders.deliveredAt })
    .from(orders)
    .where(eq(orders.id, orderId));
  check(row.status === "delivered" && row.deliveredAt !== null, "delivered_at 자동 기록", row);

  const history = await db
    .select({ to: orderStatusHistory.toStatus, actor: orderStatusHistory.actor })
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, orderId));
  check(history.length === 5, `이력 5건 누적 (실제 ${history.length})`, history.map((h) => h.to));
  check(
    history.some((h) => h.actor === "admin:1") && history.some((h) => h.actor === "system"),
    "actor 규약 기록(admin:1 / system)",
  );
}

/** ③ 주문 불가 라인이 있으면 생성 거부 */
async function checkBlockedLineRejected() {
  console.log("\n[3] 재고 부족 라인 — 주문 생성 거부 기대");
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);

  const cartToken = `CHECK3-${randomUUID()}`;
  const [cartRow] = await db.insert(cart).values({ sessionToken: cartToken }).returning({ id: cart.id });
  // 재고보다 많은 수량을 담는다
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId: variant.id, quantity: variant.stock + 5 });

  try {
    let rejected = false;
    try {
      await createPendingOrder(db, {
        cartToken,
        customerId: null,
        orderer: ORDERER,
        shippingAddress: ADDRESS,
        agreedTermsDocumentIds: await loadRequiredTermsIds(),
        agreementIp: "127.0.0.1",
      });
    } catch {
      rejected = true;
    }
    check(rejected, "재고 초과 수량 주문 거부");

    const leftovers = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.guestToken, cartToken));
    check(leftovers.length === 0, "거부 시 주문 잔여물 없음");
  } finally {
    await db.delete(cart).where(eq(cart.id, cartRow.id));
  }
}

/** ④ 필수 약관 미동의 — 서버가 직접 차단해야 한다(화면 검증만으로는 API 호출로 뚫린다) */
async function checkTermsAgreementRequired() {
  console.log("\n[4] 필수 약관 미동의 — 주문 생성 거부 기대");
  const requiredIds = await loadRequiredTermsIds();
  if (requiredIds.length === 0) {
    console.log("  – 필수 약관 문서가 없어 건너뜀 (npm run db:seed 확인)");
    return;
  }

  const { cartToken, cartId } = await setupCart(1);
  try {
    let rejected = false;
    try {
      await createPendingOrder(db, {
        cartToken,
        customerId: null,
        orderer: ORDERER,
        shippingAddress: ADDRESS,
        agreedTermsDocumentIds: [], // 동의 없이 API 직접 호출
        agreementIp: "127.0.0.1",
      });
    } catch (error) {
      rejected = error instanceof TermsNotAgreedError;
    }
    check(rejected, "동의 없는 주문 거부(TermsNotAgreedError)");

    const leftovers = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.guestToken, cartToken));
    check(leftovers.length === 0, "거부 시 주문 잔여물 없음");
  } finally {
    await cleanupCart(cartId, []);
  }
}

async function main() {
  console.log("PaRaSOL 주문 Phase 3 검증 (임시 주문·카트는 종료 시 삭제)");
  const created = await checkCreatePendingOrder();
  try {
    await checkTransitions(created.orderId);
    await checkBlockedLineRejected();
    await checkTermsAgreementRequired();
  } finally {
    await cleanupCart(created.cartId, created.orderIds);
  }
  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
