import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { claim, claimItem, orderItem, orderItemAddon, orders } from "@/db/schema";
import {
  assertExchangeFeeSettled,
  isClaimFeeSettled,
  type ClaimType,
} from "@/domain/claim";
import { compareLockOrder, type StockChangeTarget } from "@/domain/inventory";

import { applyClaimTransition } from "./claim-status.service";
import type { DatabaseClient, TransactionClient } from "./db-client";
import { deductStock, restoreStock } from "./inventory.service";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 클레임 처리(관리자) — 승인·반려·회수완료·검수완료(교환)·배송비 입금확인.
 *
 * 설계 확정본: 설계_클레임도메인(claim-domain-design)_20260728.md
 * **환불이 걸리는 전이(취소 승인·반품 검수완료)는 여기 없다** — 외부 결제 경계라 C4가 맡는다.
 * 여기 있는 것은 돈이 오가지 않는 전이 + 교환 완료(환불 없음)뿐이다.
 *
 * 재고 복원 시점(설계 D4): 취소는 승인 즉시(C4), 반품·교환은 **검수 합격 후**.
 * 검수 전에 복원하면 파손품이 판매 가능 재고로 올라간다.
 */

export class ClaimProcessNotFoundError extends Error {
  constructor(readonly claimId: number) {
    super(`클레임을 찾을 수 없습니다: id=${claimId}`);
    this.name = "ClaimProcessNotFoundError";
  }
}

export class ClaimTypeMismatchError extends Error {
  constructor(readonly expected: ClaimType, readonly actual: ClaimType) {
    super("이 클레임 유형에는 적용할 수 없는 처리입니다.");
    this.name = "ClaimTypeMismatchError";
  }
}

export class ClaimFeeAlreadySettledError extends Error {
  constructor() {
    super("이미 입금 확인된 클레임입니다.");
    this.name = "ClaimFeeAlreadySettledError";
  }
}

/**
 * 이 클레임이 되돌릴(또는 다시 내보낼) 재고 목록.
 *
 * 원장(inventory_log)이 아니라 claim_item에서 만든다 — 클레임은 주문의 **일부**라
 * 주문 차감 원장 전체를 되돌리면 안 되기 때문이다(부분 반품).
 * 추가상품은 라인 전량 클레임일 때만 포함한다(설계 D11) — 부분 수량이면 복원 수량이 소수가 된다.
 */
async function buildClaimStockTargets(
  tx: TransactionClient,
  claimId: number,
): Promise<StockChangeTarget[]> {
  const itemRows = await tx
    .select({
      orderItemId: claimItem.orderItemId,
      claimQuantity: claimItem.quantity,
      orderedQuantity: orderItem.quantity,
      variantId: orderItem.variantId,
    })
    .from(claimItem)
    .innerJoin(orderItem, eq(claimItem.orderItemId, orderItem.id))
    .where(eq(claimItem.claimId, claimId));

  const variantQuantity = new Map<number, number>();
  const addonQuantity = new Map<number, number>();

  for (const itemRow of itemRows) {
    // 상품이 하드 삭제되면 variant_id가 null이 된다 — 되돌릴 대상이 없으므로 건너뛴다
    if (itemRow.variantId !== null) {
      variantQuantity.set(
        itemRow.variantId,
        (variantQuantity.get(itemRow.variantId) ?? 0) + itemRow.claimQuantity,
      );
    }

    if (itemRow.claimQuantity !== itemRow.orderedQuantity) continue;

    const addonRows = await tx
      .select({ addonId: orderItemAddon.addonId, quantity: orderItemAddon.quantity })
      .from(orderItemAddon)
      .where(eq(orderItemAddon.orderItemId, itemRow.orderItemId));
    for (const addonRow of addonRows) {
      if (addonRow.addonId === null) continue;
      addonQuantity.set(
        addonRow.addonId,
        (addonQuantity.get(addonRow.addonId) ?? 0) + addonRow.quantity,
      );
    }
  }

  return [
    ...[...variantQuantity].map(([id, quantity]): StockChangeTarget => ({ kind: "variant", id, quantity })),
    ...[...addonQuantity].map(([id, quantity]): StockChangeTarget => ({ kind: "addon", id, quantity })),
  ].sort(compareLockOrder);
}

/** 클레임 + 원주문의 식별자를 한 번에 — 원장 refId·게이트 판정에 쓴다 */
async function loadClaimContext(tx: TransactionClient, claimId: number) {
  const [row] = await tx
    .select({
      claimNo: claim.claimNo,
      claimType: claim.type,
      status: claim.status,
      shippingFee: claim.shippingFee,
      feeSettledAt: claim.feeSettledAt,
      orderId: claim.orderId,
      orderNo: orders.orderNo,
    })
    .from(claim)
    .innerJoin(orders, eq(claim.orderId, orders.id))
    .where(eq(claim.id, claimId))
    .limit(1);
  if (!row) throw new ClaimProcessNotFoundError(claimId);
  return row;
}

export type ClaimProcessResult = {
  claimId: number;
  claimNo: string;
  status: string;
};

/**
 * 승인 — 반품·교환만. 회수를 요청하는 단계라 재고·돈은 움직이지 않는다.
 * 취소 승인은 곧 환불이므로 C4(refundClaim)가 맡는다.
 */
export async function approveClaim(
  database: DatabaseClient,
  input: { claimId: number; actor: TransitionActor; memo?: string | null },
): Promise<ClaimProcessResult> {
  return database.transaction(async (tx) => {
    const context = await loadClaimContext(tx, input.claimId);
    if (context.claimType === "cancel") {
      throw new ClaimTypeMismatchError("return", "cancel");
    }

    const result = await applyClaimTransition(tx, {
      claimId: input.claimId,
      toStatus: "collecting",
      actor: input.actor,
      memo: input.memo ?? "클레임 승인 · 회수 요청",
    });

    return { claimId: input.claimId, claimNo: context.claimNo, status: result.toStatus };
  });
}

/** 반려 — 사유는 고객에게 그대로 안내된다(초크포인트가 필수를 강제). 재고·돈 무관 */
export async function rejectClaim(
  database: DatabaseClient,
  input: { claimId: number; actor: TransitionActor; memo: string },
): Promise<ClaimProcessResult> {
  return database.transaction(async (tx) => {
    const context = await loadClaimContext(tx, input.claimId);
    const result = await applyClaimTransition(tx, {
      claimId: input.claimId,
      toStatus: "rejected",
      actor: input.actor,
      memo: input.memo,
    });
    return { claimId: input.claimId, claimNo: context.claimNo, status: result.toStatus };
  });
}

/** 회수 완료 — 입고 확인. 아직 검수 전이라 재고를 올리지 않는다 */
export async function markCollected(
  database: DatabaseClient,
  input: { claimId: number; actor: TransitionActor; memo?: string | null },
): Promise<ClaimProcessResult> {
  return database.transaction(async (tx) => {
    const context = await loadClaimContext(tx, input.claimId);
    const result = await applyClaimTransition(tx, {
      claimId: input.claimId,
      toStatus: "inspecting",
      actor: input.actor,
      memo: input.memo ?? "회수 완료 · 검수 대기",
    });
    return { claimId: input.claimId, claimNo: context.claimNo, status: result.toStatus };
  });
}

/**
 * 배송비 입금 확인(교환) — 상태가 아니라 fee_settled_at 축을 채운다.
 * 조건부 UPDATE로 이미 확인된 건의 중복 처리를 막는다.
 */
export async function settleClaimFee(
  database: DatabaseClient,
  input: { claimId: number; actor: TransitionActor; memo?: string | null },
): Promise<{ claimId: number; settledAt: Date }> {
  return database.transaction(async (tx) => {
    const context = await loadClaimContext(tx, input.claimId);
    if (isClaimFeeSettled(context)) throw new ClaimFeeAlreadySettledError();

    const updated = await tx
      .update(claim)
      .set({
        feeSettledAt: sql`now()`,
        feeMemo: input.memo?.trim() ? input.memo.trim() : null,
      })
      .where(and(eq(claim.id, input.claimId), sql`${claim.feeSettledAt} IS NULL`))
      .returning({ settledAt: claim.feeSettledAt });
    if (updated.length === 0) throw new ClaimFeeAlreadySettledError();

    return { claimId: input.claimId, settledAt: updated[0].settledAt as Date };
  });
}

/**
 * 검수 완료 → 교환품 발송(교환 전용). 환불이 없으므로 여기서 종결된다.
 *
 * `restockable`은 관리자 판단이다 — 오배송(멀쩡한 상품)은 재입고, 파손·불량은 폐기다.
 * 귀책으로 유추할 수 없다: 판매자 귀책이어도 오배송이면 재판매 가능하다.
 * 재입고하지 않으면 원장에 복원 기록이 남지 않는 것 자체가 폐기의 증거다.
 *
 * 교환품 차감은 항상 일어난다 — 재입고 여부와 무관하게 새 상품이 나가기 때문이다.
 * 같은 variant 재발송이면 복원 +N / 차감 −N으로 순증 0이 되고, 폐기면 순 −N이 된다.
 */
export async function completeExchange(
  database: DatabaseClient,
  input: {
    claimId: number;
    actor: TransitionActor;
    /** 회수품을 판매 재고로 되돌릴 수 있는가 */
    restockable: boolean;
    memo?: string | null;
  },
): Promise<ClaimProcessResult & { restoredTargets: number; deductedTargets: number }> {
  return database.transaction(async (tx) => {
    const context = await loadClaimContext(tx, input.claimId);
    if (context.claimType !== "exchange") {
      throw new ClaimTypeMismatchError("exchange", context.claimType);
    }

    // 배송비를 못 받은 채 상품이 나가는 일을 구조로 막는다(설계 §1.3)
    assertExchangeFeeSettled({
      claimType: context.claimType,
      shippingFee: context.shippingFee,
      feeSettledAt: context.feeSettledAt,
    });

    const targets = await buildClaimStockTargets(tx, input.claimId);
    const actorText = serializeActor(input.actor);

    if (input.restockable && targets.length > 0) {
      await restoreStock(tx, {
        targets,
        refId: context.claimNo,
        reason: "claim_restock",
        actor: actorText,
      });
    }

    // 교환품 발송 — 재고가 부족하면 StockShortageError로 트랜잭션 전체가 롤백된다
    if (targets.length > 0) {
      await deductStock(tx, {
        targets,
        refId: context.claimNo,
        reason: "exchange_out",
        actor: actorText,
      });
    }

    const result = await applyClaimTransition(tx, {
      claimId: input.claimId,
      toStatus: "done",
      actor: input.actor,
      memo:
        input.memo ??
        `검수 완료 · 교환품 발송 (회수품 ${input.restockable ? "재입고" : "폐기"})`,
    });

    return {
      claimId: input.claimId,
      claimNo: context.claimNo,
      status: result.toStatus,
      restoredTargets: input.restockable ? targets.length : 0,
      deductedTargets: targets.length,
    };
  });
}
