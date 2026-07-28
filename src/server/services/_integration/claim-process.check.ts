/**
 * 클레임 C3 검증 — 처리 전이와 **재고 복원 시점**을 실제 DB에서 확인한다.
 * 실행: npm run check:claim3   (SSH 터널 켠 상태)
 *
 * 이 스크립트의 존재 이유: 설계 D4("검수 전에는 복원하지 않는다")가 코드로 지켜지는지는
 * 단위 테스트로 알 수 없다 — 실제 재고 컬럼을 단계마다 읽어야 증명된다.
 *
 * 시나리오: [1]승인·회수 단계에서 재고 무변동 [2]교환 완료(재입고) 순증 0
 *           [3]교환 완료(폐기) 순 −N [4]배송비 미입금 시 발송 차단 [5]입금 확인 [6]유형 가드
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  claim,
  inventoryLog,
  orderItem,
  orders,
  productVariant,
} from "@/db/schema";
import { ClaimFeeUnsettledError } from "@/domain/claim";

import {
  approveClaim,
  ClaimFeeAlreadySettledError,
  ClaimTypeMismatchError,
  completeExchange,
  markCollected,
  rejectClaim,
  settleClaimFee,
} from "../claim-process.service";
import { requestClaim } from "../claim.service";
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

const ADMIN = { role: "admin" as const, id: 1 };
const ORDERER = { name: "C3테스터", phone: "010-7777-8888", email: "c3@example.com" };
const ADDRESS = {
  recipient: "C3테스터",
  phone: "010-7777-8888",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
};

type Leftovers = { orderIds: number[]; cartIds: number[]; claimNos: string[] };

async function readStock(variantId: number): Promise<number> {
  const [row] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return row.stock;
}

/** 배송완료 주문 1건 — 교환·반품 신청이 가능한 상태까지 진행 */
async function setupDeliveredOrder(
  variantId: number,
  quantity: number,
  leftovers: Leftovers,
) {
  const cartToken = `C3-${randomUUID()}`;
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

  for (const status of ["paid", "preparing", "shipping", "delivered"] as const) {
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: created.orderId,
        toStatus: status,
        actor: status === "paid" ? { role: "system" } : ADMIN,
        memo: "C3 준비",
      }),
    );
  }
  return created;
}

async function firstOrderItemId(orderId: number): Promise<number> {
  const [row] = await db
    .select({ id: orderItem.id })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderId));
  return row.id;
}

/** 교환 클레임 접수 — 판매자 귀책(damaged)이면 배송비 0, 구매자 귀책(wrong_option)이면 6,000 */
async function requestExchange(
  orderNo: string,
  guestToken: string | null,
  orderItemId: number,
  quantity: number,
  reasonCode: "damaged" | "wrong_option",
  leftovers: Leftovers,
) {
  const result = await requestClaim(db, {
    orderNo,
    claimType: "exchange",
    reasonCode,
    targets: [{ orderItemId, quantity }],
    customerId: null,
    guestToken,
  });
  leftovers.claimNos.push(result.claimNo);
  return result;
}

/** ① 승인·회수 단계에서는 재고가 움직이지 않는다 (설계 D4 핵심) */
async function checkNoStockUntilInspection(variantId: number, leftovers: Leftovers) {
  console.log("\n[1] 승인·회수 단계 — 재고 무변동 기대");
  const created = await setupDeliveredOrder(variantId, 2, leftovers);
  const orderItemId = await firstOrderItemId(created.orderId);
  const stockBefore = await readStock(variantId);

  const claimResult = await requestExchange(
    created.orderNo,
    created.guestToken,
    orderItemId,
    2,
    "damaged", // 판매자 귀책 → 배송비 0 → 입금 게이트 없음
    leftovers,
  );
  check(claimResult.shippingFee === 0, "판매자 귀책 교환은 배송비 0", claimResult.shippingFee);
  check((await readStock(variantId)) === stockBefore, `접수 후 재고 무변동 (${stockBefore})`);

  await approveClaim(db, { claimId: claimResult.claimId, actor: ADMIN });
  check((await readStock(variantId)) === stockBefore, "승인 후에도 재고 무변동");

  await markCollected(db, { claimId: claimResult.claimId, actor: ADMIN });
  check((await readStock(variantId)) === stockBefore, "회수 완료 후에도 재고 무변동 — 검수 전");

  const logs = await db
    .select({ id: inventoryLog.id })
    .from(inventoryLog)
    .where(eq(inventoryLog.refId, claimResult.claimNo));
  check(logs.length === 0, "검수 전에는 원장 기록도 없다", logs.length);

  return { created, orderItemId, claimResult, stockBefore };
}

/** ② 교환 완료(재입고 가능) — 복원 +N, 차감 −N → 순증 0 */
async function checkExchangeRestock(
  variantId: number,
  claimId: number,
  claimNo: string,
  stockBefore: number,
) {
  console.log("\n[2] 교환 완료(재입고) — 순증 0 · 원장 2줄 기대");
  const result = await completeExchange(db, { claimId, actor: ADMIN, restockable: true });

  const stockAfter = await readStock(variantId);
  check(stockAfter === stockBefore, `순증 0 (${stockBefore} → ${stockAfter})`);
  check(result.restoredTargets === 1 && result.deductedTargets === 1, "복원·차감 각 1건", result);

  const logs = await db
    .select({ delta: inventoryLog.delta, reason: inventoryLog.reason })
    .from(inventoryLog)
    .where(eq(inventoryLog.refId, claimNo));
  const restored = logs.filter((row) => row.reason === "claim_restock");
  const shipped = logs.filter((row) => row.reason === "exchange_out");
  check(
    restored.length === 1 && restored[0].delta === 2,
    "복원 원장 +2 (claim_restock)",
    restored,
  );
  check(
    shipped.length === 1 && shipped[0].delta === -2,
    "발송 원장 −2 (exchange_out)",
    shipped,
  );

  const [claimRow] = await db
    .select({ status: claim.status, resolvedAt: claim.resolvedAt })
    .from(claim)
    .where(eq(claim.id, claimId));
  check(claimRow.status === "done" && claimRow.resolvedAt !== null, "종결 처리", claimRow);
}

/** ③ 교환 완료(폐기) — 복원 없음, 차감만 → 순 −N */
async function checkExchangeDiscard(variantId: number, leftovers: Leftovers) {
  console.log("\n[3] 교환 완료(폐기) — 순 −N · 복원 원장 없음 기대");
  const created = await setupDeliveredOrder(variantId, 1, leftovers);
  const orderItemId = await firstOrderItemId(created.orderId);
  const claimResult = await requestExchange(
    created.orderNo,
    created.guestToken,
    orderItemId,
    1,
    "damaged",
    leftovers,
  );

  await approveClaim(db, { claimId: claimResult.claimId, actor: ADMIN });
  await markCollected(db, { claimId: claimResult.claimId, actor: ADMIN });

  const stockBefore = await readStock(variantId);
  await completeExchange(db, { claimId: claimResult.claimId, actor: ADMIN, restockable: false });
  const stockAfter = await readStock(variantId);

  check(stockAfter === stockBefore - 1, `폐기 시 순 −1 (${stockBefore} → ${stockAfter})`);
  const logs = await db
    .select({ reason: inventoryLog.reason })
    .from(inventoryLog)
    .where(eq(inventoryLog.refId, claimResult.claimNo));
  check(
    logs.every((row) => row.reason !== "claim_restock"),
    "복원 원장 없음 — 기록 부재가 폐기의 증거",
    logs,
  );
}

/** ④⑤ 구매자 귀책 교환 — 배송비 입금 전 발송 차단, 입금 확인 후 통과 */
async function checkFeeGate(variantId: number, leftovers: Leftovers) {
  console.log("\n[4] 배송비 미입금 — 교환품 발송 차단 기대");
  const created = await setupDeliveredOrder(variantId, 1, leftovers);
  const orderItemId = await firstOrderItemId(created.orderId);
  const claimResult = await requestExchange(
    created.orderNo,
    created.guestToken,
    orderItemId,
    1,
    "wrong_option", // 구매자 귀책 → 왕복 6,000
    leftovers,
  );
  check(claimResult.shippingFee === 6000, `구매자 귀책 교환 6,000 (실제 ${claimResult.shippingFee})`);
  check(claimResult.feeMethod === "bank_transfer", `교환 수취방법 계좌이체 (${claimResult.feeMethod})`);

  await approveClaim(db, { claimId: claimResult.claimId, actor: ADMIN });
  await markCollected(db, { claimId: claimResult.claimId, actor: ADMIN });

  const stockBefore = await readStock(variantId);
  let gated = false;
  try {
    await completeExchange(db, { claimId: claimResult.claimId, actor: ADMIN, restockable: true });
  } catch (error) {
    gated = error instanceof ClaimFeeUnsettledError;
  }
  check(gated, "미입금 상태에서 발송 차단");
  check((await readStock(variantId)) === stockBefore, "차단 시 재고 무변동(트랜잭션 롤백)");

  console.log("\n[5] 입금 확인 — 게이트 해제·중복 확인 차단 기대");
  const settled = await settleClaimFee(db, {
    claimId: claimResult.claimId,
    actor: ADMIN,
    memo: "홍길동 6000원 입금",
  });
  check(settled.settledAt !== null, "입금 확인 시각 기록");

  let duplicated = false;
  try {
    await settleClaimFee(db, { claimId: claimResult.claimId, actor: ADMIN });
  } catch (error) {
    duplicated = error instanceof ClaimFeeAlreadySettledError;
  }
  check(duplicated, "중복 입금 확인 차단");

  const done = await completeExchange(db, {
    claimId: claimResult.claimId,
    actor: ADMIN,
    restockable: true,
  });
  check(done.status === "done", "입금 확인 후 발송 통과");
  check((await readStock(variantId)) === stockBefore, "재입고 교환은 순증 0");
}

/** ⑥ 유형 가드 — 취소에는 승인·교환완료를 적용할 수 없다 */
async function checkTypeGuards(variantId: number, leftovers: Leftovers) {
  console.log("\n[6] 유형 가드 — 취소에 교환 처리 차단 기대");
  const cartToken = `C3-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);
  await db.insert(cartItem).values({ cartId: cartRow.id, variantId, quantity: 1 });
  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    agreedTermsDocumentIds: await getRequiredTermsDocumentIds(db),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  await db.transaction((tx) =>
    applyOrderTransition(tx, { orderId: created.orderId, toStatus: "paid", actor: { role: "system" } }),
  );

  const cancelClaim = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "cancel",
    reasonCode: "change_mind",
    customerId: null,
    guestToken: created.guestToken,
  });
  leftovers.claimNos.push(cancelClaim.claimNo);

  let approveBlocked = false;
  try {
    await approveClaim(db, { claimId: cancelClaim.claimId, actor: ADMIN });
  } catch (error) {
    approveBlocked = error instanceof ClaimTypeMismatchError;
  }
  check(approveBlocked, "취소에 승인(회수요청) 적용 차단 — 환불은 C4 몫");

  let exchangeBlocked = false;
  try {
    await completeExchange(db, { claimId: cancelClaim.claimId, actor: ADMIN, restockable: true });
  } catch (error) {
    exchangeBlocked = error instanceof ClaimTypeMismatchError;
  }
  check(exchangeBlocked, "취소에 교환완료 적용 차단");

  // 반려는 유형 무관 — 취소도 반려할 수 있다
  const rejected = await rejectClaim(db, {
    claimId: cancelClaim.claimId,
    actor: ADMIN,
    memo: "재고 확인 결과 이미 출고됨",
  });
  check(rejected.status === "rejected", "취소 반려는 통과");
}

async function main() {
  console.log("PaRaSOL 클레임 C3 검증 (임시 주문·클레임은 종료 시 삭제)");
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [], claimNos: [] };
  try {
    const first = await checkNoStockUntilInspection(variant.id, leftovers);
    await checkExchangeRestock(
      variant.id,
      first.claimResult.claimId,
      first.claimResult.claimNo,
      first.stockBefore,
    );
    await checkExchangeDiscard(variant.id, leftovers);
    await checkFeeGate(variant.id, leftovers);
    await checkTypeGuards(variant.id, leftovers);
  } finally {
    if (leftovers.claimNos.length > 0) {
      await db.delete(inventoryLog).where(inArray(inventoryLog.refId, leftovers.claimNos));
    }
    if (leftovers.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
    // 폐기 시나리오가 재고를 실제로 줄였으므로 시작값으로 되돌린다
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
