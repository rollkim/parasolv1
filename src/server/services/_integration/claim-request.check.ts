/**
 * 클레임 C2 검증 — 신청 서비스와 상태 초크포인트를 실제 DB에서 확인한다.
 * 실행: npm run check:claim2   (SSH 터널 켠 상태)
 *
 * 시나리오: [1]취소 접수(전체 단위·금액) [2]반품 부분 수량 접수 [3]수량 초과 차단
 *           [4]조건 위반 차단(상태·기간·사유) [5]소유 검증 [6]상태 전이(합법·불법·멱등·반려사유)
 *
 * `tsx --conditions=react-server`로 도는 이유는 order-phase2.check.ts 주석 참조.
 * 생성한 주문·클레임은 끝나면 삭제한다(cascade로 품목·이력이 함께 정리).
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  claim,
  claimItem,
  claimStatusHistory,
  orderItem,
  orders,
  productVariant,
} from "@/db/schema";
import {
  ClaimQuantityExceededError,
  ClaimReasonNotAllowedError,
  ClaimWindowExpiredError,
  IllegalClaimTransitionError,
  OrderNotClaimableError,
} from "@/domain/claim";

import {
  applyClaimTransition,
  ClaimTransitionMemoRequiredError,
} from "../claim-status.service";
import {
  ClaimOrderAccessDeniedError,
  requestClaim,
} from "../claim.service";
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

const ORDERER = { name: "클레임테스터", phone: "010-5555-6666", email: "claim@example.com" };
const ADDRESS = {
  recipient: "클레임테스터",
  phone: "010-5555-6666",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
  addr2: "3층",
};

type Leftovers = { orderIds: number[]; cartIds: number[] };

/** 주문 1건 생성 — 클레임 대상이 필요하므로 매 시나리오마다 새로 만든다 */
async function setupOrder(
  variantId: number,
  quantity: number,
  leftovers: Leftovers,
) {
  const cartToken = `CLAIM-${randomUUID()}`;
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
  return created;
}

/** 클레임 조건을 만들기 위해 주문 상태를 강제 전이한다(검증 편의 — 초크포인트 경유) */
async function advanceOrderTo(
  orderId: number,
  target: "paid" | "preparing" | "shipping" | "delivered",
) {
  const path = ["paid", "preparing", "shipping", "delivered"] as const;
  for (const status of path) {
    await db.transaction((tx) =>
      applyOrderTransition(tx, {
        orderId,
        toStatus: status,
        actor: status === "paid" ? { role: "system" } : { role: "admin", id: 1 },
        memo: "검증 준비",
      }),
    );
    if (status === target) return;
  }
}

/** ① 취소 접수 — 전체 주문 단위, 주문 배송비까지 환불 */
async function checkCancelRequest(variantId: number, leftovers: Leftovers) {
  console.log("\n[1] 취소 접수 — 전체 단위·주문 배송비 포함 환불 기대");
  const created = await setupOrder(variantId, 2, leftovers);
  await advanceOrderTo(created.orderId, "paid");

  const [orderRow] = await db
    .select({ subtotal: orders.subtotal, shippingFee: orders.shippingFee })
    .from(orders)
    .where(eq(orders.id, created.orderId));

  const result = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "cancel",
    reasonCode: "change_mind",
    customerId: null,
    guestToken: created.guestToken,
  });

  check(/^CN-\d{8}-\d{4,}$/.test(result.claimNo), `취소 접수번호 ${result.claimNo}`);
  check(
    result.goodsAmount === orderRow.subtotal,
    `상품금액 = 주문 소계 (${result.goodsAmount} / ${orderRow.subtotal})`,
  );
  check(result.shippingFee === 0, "취소는 클레임 배송비 0");
  check(
    result.refundAmount === orderRow.subtotal + orderRow.shippingFee,
    `환불액 = 소계 + 주문배송비 (${result.refundAmount})`,
  );
  check(result.feeMethod === null, "배송비 0이므로 수취 방법 없음");

  // 대상을 안 줘도 전 품목이 담긴다(취소는 전체 단위)
  const claimItems = await db
    .select({ quantity: claimItem.quantity })
    .from(claimItem)
    .where(eq(claimItem.claimId, result.claimId));
  check(
    claimItems.length === 1 && claimItems[0].quantity === 2,
    "대상 미지정 시 전 품목 전량 포함",
    claimItems,
  );

  const history = await db
    .select({ from: claimStatusHistory.fromStatus, to: claimStatusHistory.toStatus })
    .from(claimStatusHistory)
    .where(eq(claimStatusHistory.claimId, result.claimId));
  check(
    history.length === 1 && history[0].from === null && history[0].to === "requested",
    "접수 이력 기록",
    history,
  );

  // ★핵심: 접수는 돈도 재고도 건드리지 않는다
  const [variantRow] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return { created, claimId: result.claimId, stockAfterRequest: variantRow.stock };
}

/** ② 반품 부분 수량 접수 — 배송비 차감·추가상품 제외(D11) */
async function checkPartialReturn(variantId: number, leftovers: Leftovers) {
  console.log("\n[2] 반품 부분 수량 — 배송비 차감·수취방법 차감 고정 기대");
  const created = await setupOrder(variantId, 3, leftovers);
  await advanceOrderTo(created.orderId, "delivered");

  const [itemRow] = await db
    .select({ id: orderItem.id, unitPrice: orderItem.unitPrice })
    .from(orderItem)
    .where(eq(orderItem.orderId, created.orderId));

  const result = await requestClaim(db, {
    orderNo: created.orderNo,
    claimType: "return",
    reasonCode: "change_mind", // 구매자 귀책 → 배송비 부과
    targets: [{ orderItemId: itemRow.id, quantity: 1 }],
    customerId: null,
    guestToken: created.guestToken,
  });

  check(/^RT-\d{8}-\d{4,}$/.test(result.claimNo), `반품 접수번호 ${result.claimNo}`);
  check(
    result.goodsAmount === itemRow.unitPrice,
    `부분 수량 상품금액 (${result.goodsAmount} = 단가 ${itemRow.unitPrice} × 1)`,
  );
  check(result.shippingFee === 3000, `구매자 귀책 반품 배송비 3,000 (실제 ${result.shippingFee})`);
  check(
    result.refundAmount === Math.max(0, itemRow.unitPrice - 3000),
    `환불액 = 상품금액 − 배송비 (${result.refundAmount})`,
  );
  check(result.feeMethod === "deduct_refund", `반품 수취방법 차감 고정 (${result.feeMethod})`);

  const [claimRow] = await db
    .select({ fault: claim.fault, feeSettledAt: claim.feeSettledAt })
    .from(claim)
    .where(eq(claim.id, result.claimId));
  check(claimRow.fault === "buyer", "사유가 귀책을 결정(change_mind → buyer)");
  check(claimRow.feeSettledAt === null, "접수 시점에는 미수취");

  return { created, orderItemId: itemRow.id, claimId: result.claimId };
}

/** ③ 수량 초과 차단 — 이미 접수된 수량 누적 */
async function checkQuantityGuard(orderNo: string, orderItemId: number, guestToken: string | null) {
  console.log("\n[3] 수량 초과 — 누적 기준 차단 기대");
  // 주문 3개 중 1개는 [2]에서 접수됨 → 3개를 더 신청하면 초과
  let exceeded = false;
  try {
    await requestClaim(db, {
      orderNo,
      claimType: "return",
      reasonCode: "change_mind",
      targets: [{ orderItemId, quantity: 3 }],
      customerId: null,
      guestToken,
    });
  } catch (error) {
    exceeded = error instanceof ClaimQuantityExceededError;
  }
  check(exceeded, "누적 초과 신청 거부");

  // 잔여 2개는 통과해야 한다
  const remaining = await requestClaim(db, {
    orderNo,
    claimType: "return",
    reasonCode: "change_mind",
    targets: [{ orderItemId, quantity: 2 }],
    customerId: null,
    guestToken,
  });
  check(remaining.claimId > 0, "잔여 수량 신청은 통과");
}

/** ④ 조건 위반 — 상태·기간·사유 */
async function checkConditionGuards(variantId: number, leftovers: Leftovers) {
  console.log("\n[4] 조건 위반 — 상태·기간·사유 차단 기대");

  // 배송 중에는 취소도 반품도 불가
  const shipping = await setupOrder(variantId, 1, leftovers);
  await advanceOrderTo(shipping.orderId, "shipping");
  for (const claimType of ["cancel", "return"] as const) {
    let blocked = false;
    try {
      await requestClaim(db, {
        orderNo: shipping.orderNo,
        claimType,
        reasonCode: claimType === "cancel" ? "change_mind" : "damaged",
        customerId: null,
        guestToken: shipping.guestToken,
      });
    } catch (error) {
      blocked = error instanceof OrderNotClaimableError;
    }
    check(blocked, `배송 중 ${claimType} 차단`);
  }

  // 사유가 유형을 허용하지 않으면 거부 — change_mind는 교환 불가(시드 정책)
  const delivered = await setupOrder(variantId, 1, leftovers);
  await advanceOrderTo(delivered.orderId, "delivered");
  let reasonBlocked = false;
  try {
    await requestClaim(db, {
      orderNo: delivered.orderNo,
      claimType: "exchange",
      reasonCode: "change_mind",
      customerId: null,
      guestToken: delivered.guestToken,
    });
  } catch (error) {
    reasonBlocked = error instanceof ClaimReasonNotAllowedError;
  }
  check(reasonBlocked, "사유-유형 불일치 차단(change_mind → exchange)");

  // 기간 경과 — delivered_at을 8일 전으로 되돌린다
  await db
    .update(orders)
    .set({ deliveredAt: sql`now() - interval '8 days'` })
    .where(eq(orders.id, delivered.orderId));
  let expired = false;
  try {
    await requestClaim(db, {
      orderNo: delivered.orderNo,
      claimType: "return",
      reasonCode: "damaged",
      customerId: null,
      guestToken: delivered.guestToken,
    });
  } catch (error) {
    expired = error instanceof ClaimWindowExpiredError;
  }
  check(expired, "배송완료 8일 경과 시 차단(7일 기한)");

  return delivered;
}

/** ⑤ 소유 검증 */
async function checkOwnership(orderNo: string) {
  console.log("\n[5] 소유 검증 — 토큰 불일치 차단 기대");
  let denied = false;
  try {
    await requestClaim(db, {
      orderNo,
      claimType: "cancel",
      reasonCode: "change_mind",
      customerId: null,
      guestToken: randomUUID(),
    });
  } catch (error) {
    denied = error instanceof ClaimOrderAccessDeniedError;
  }
  check(denied, "다른 게스트 토큰으로 신청 거부");
}

/** ⑥ 상태 전이 — 유형별 합법·불법·멱등·반려사유 */
async function checkTransitions(cancelClaimId: number, returnClaimId: number) {
  console.log("\n[6] 상태 전이 — 유형별 규칙 기대");

  // 반품은 requested→done 불가(회수·검수 없이 환불 금지)
  let illegalBlocked = false;
  try {
    await db.transaction((tx) =>
      applyClaimTransition(tx, {
        claimId: returnClaimId,
        toStatus: "done",
        actor: { role: "admin", id: 1 },
      }),
    );
  } catch (error) {
    illegalBlocked = error instanceof IllegalClaimTransitionError;
  }
  check(illegalBlocked, "반품 requested→done 차단");

  // 반려 사유 없으면 차단
  let memoRequired = false;
  try {
    await db.transaction((tx) =>
      applyClaimTransition(tx, {
        claimId: returnClaimId,
        toStatus: "rejected",
        actor: { role: "admin", id: 1 },
      }),
    );
  } catch (error) {
    memoRequired = error instanceof ClaimTransitionMemoRequiredError;
  }
  check(memoRequired, "반려 사유 미입력 차단");

  // 정상 경로: requested → collecting → inspecting
  const toCollecting = await db.transaction((tx) =>
    applyClaimTransition(tx, {
      claimId: returnClaimId,
      toStatus: "collecting",
      actor: { role: "admin", id: 1 },
    }),
  );
  check(
    toCollecting.changed && toCollecting.sideEffects.includes("request_pickup"),
    "반품 승인 → 회수 요청 부작용",
    toCollecting.sideEffects,
  );

  const again = await db.transaction((tx) =>
    applyClaimTransition(tx, {
      claimId: returnClaimId,
      toStatus: "collecting",
      actor: { role: "admin", id: 1 },
    }),
  );
  check(!again.changed, "동일 상태 재전이는 멱등(no-op)");

  await db.transaction((tx) =>
    applyClaimTransition(tx, {
      claimId: returnClaimId,
      toStatus: "inspecting",
      actor: { role: "admin", id: 1 },
    }),
  );
  const inspectingToDone = await db.transaction((tx) =>
    applyClaimTransition(tx, {
      claimId: returnClaimId,
      toStatus: "done",
      actor: { role: "admin", id: 1 },
    }),
  );
  check(
    inspectingToDone.sideEffects.includes("refund") &&
      inspectingToDone.sideEffects.includes("restore_stock"),
    "반품 검수완료 → 환불·재고복원 부작용",
    inspectingToDone.sideEffects,
  );

  const [doneRow] = await db
    .select({ status: claim.status, resolvedAt: claim.resolvedAt })
    .from(claim)
    .where(eq(claim.id, returnClaimId));
  check(doneRow.status === "done" && doneRow.resolvedAt !== null, "종결 시각 자동 기록", doneRow);

  // 종결 후에는 어떤 전이도 불가
  let terminalBlocked = false;
  try {
    await db.transaction((tx) =>
      applyClaimTransition(tx, {
        claimId: returnClaimId,
        toStatus: "collecting",
        actor: { role: "admin", id: 1 },
      }),
    );
  } catch (error) {
    terminalBlocked = error instanceof IllegalClaimTransitionError;
  }
  check(terminalBlocked, "종결(done) 이후 전이 차단");

  // 취소는 requested→done이 합법 + 주문 취소 부작용을 지시한다
  const cancelDone = await db.transaction((tx) =>
    applyClaimTransition(tx, {
      claimId: cancelClaimId,
      toStatus: "done",
      actor: { role: "admin", id: 1 },
      memo: "취소 승인",
    }),
  );
  check(
    cancelDone.sideEffects.includes("transition_order_cancelled"),
    "취소 승인 → 주문취소 부작용 지시",
    cancelDone.sideEffects,
  );

  const historyRows = await db
    .select({ actor: claimStatusHistory.actor })
    .from(claimStatusHistory)
    .where(eq(claimStatusHistory.claimId, returnClaimId));
  check(
    historyRows.some((row) => row.actor === "admin:1"),
    "actor 규약 기록(admin:1)",
  );
}

async function main() {
  console.log("PaRaSOL 클레임 C2 검증 (임시 주문·클레임은 종료 시 삭제)");
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const leftovers: Leftovers = { orderIds: [], cartIds: [] };
  try {
    const cancelCase = await checkCancelRequest(variant.id, leftovers);
    check(
      cancelCase.stockAfterRequest === variant.stock,
      `접수는 재고를 건드리지 않는다 (${variant.stock} → ${cancelCase.stockAfterRequest})`,
    );

    const returnCase = await checkPartialReturn(variant.id, leftovers);
    await checkQuantityGuard(
      returnCase.created.orderNo,
      returnCase.orderItemId,
      returnCase.created.guestToken,
    );
    const deliveredCase = await checkConditionGuards(variant.id, leftovers);
    await checkOwnership(deliveredCase.orderNo);
    await checkTransitions(cancelCase.claimId, returnCase.claimId);
  } finally {
    if (leftovers.orderIds.length > 0) {
      // 클레임은 order cascade로 함께 삭제된다
      await db.delete(orders).where(inArray(orders.id, leftovers.orderIds));
    }
    if (leftovers.cartIds.length > 0) {
      await db.delete(cart).where(inArray(cart.id, leftovers.cartIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
