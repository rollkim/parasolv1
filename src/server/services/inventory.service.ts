import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { inventoryLog, productAddon, productVariant } from "@/db/schema";
import type { StockChangeTarget } from "@/domain/inventory";

import type { TransactionClient } from "./db-client";

/**
 * 재고 증감 — 조건부 UPDATE만 사용한다(RULE-11).
 *   UPDATE ... SET stock = stock - n WHERE id = ? AND stock >= n
 * 조회 후 차감(read-modify-write)은 두 요청이 같은 재고를 보고 각자 빼면서 초과판매를 만든다.
 * 조건을 UPDATE 자체에 넣으면 DB가 행 잠금으로 직렬화해 마지막 1개를 한 명만 가져간다.
 *
 * 모든 함수는 트랜잭션 안에서만 호출한다 — 부분 차감 상태가 커밋되면 안 되기 때문이다.
 */

export type StockFailure = {
  kind: "variant" | "addon";
  id: number;
  requested: number;
  available: number;
};

export class StockShortageError extends Error {
  constructor(readonly failures: StockFailure[]) {
    super("재고가 부족한 상품이 있습니다.");
    this.name = "StockShortageError";
  }
}

/** inventory_log.ref_id에 남길 참조 — 주문번호 또는 클레임번호 */
type StockActor = { refId: string; actor: string };

/** 사유 — inventory_log.reason 규약(영문 코드) */
export type StockRestoreReason = "cancel_restock" | "claim_restock";
export type StockDeductReason = "order" | "exchange_out";

/**
 * 재고 차감. targets는 domain/inventory.planStockDeductions가 만든
 * 락 순서(variant→addon, id 오름차순) 정렬 결과여야 한다 — 동시 주문 간 데드락 회피.
 * 하나라도 부족하면 StockShortageError를 던져 호출자가 트랜잭션 전체를 롤백하게 한다.
 *
 * 주문 결제(refId=주문번호, reason=order)와 교환 재발송(refId=클레임번호, reason=exchange_out)이
 * 함께 쓴다 — 조건부 UPDATE 규약(RULE-11)을 한 곳에만 두기 위해서다.
 */
export async function deductStock(
  tx: TransactionClient,
  args: {
    targets: StockChangeTarget[];
    refId: string;
    actor: string;
    reason?: StockDeductReason;
  },
): Promise<void> {
  const failures: StockFailure[] = [];

  for (const target of args.targets) {
    const updatedRows =
      target.kind === "variant"
        ? await tx
            .update(productVariant)
            .set({ stock: sql`${productVariant.stock} - ${target.quantity}` })
            .where(
              and(
                eq(productVariant.id, target.id),
                sql`${productVariant.stock} >= ${target.quantity}`,
              ),
            )
            .returning({ stockAfter: productVariant.stock })
        : await tx
            .update(productAddon)
            .set({ stock: sql`${productAddon.stock} - ${target.quantity}` })
            .where(
              and(
                eq(productAddon.id, target.id),
                sql`${productAddon.stock} >= ${target.quantity}`,
              ),
            )
            .returning({ stockAfter: productAddon.stock });

    if (updatedRows.length === 0) {
      // 조건 불충족(재고 부족) 또는 대상 없음 — 남은 재고를 읽어 사용자 안내에 쓴다
      failures.push({
        kind: target.kind,
        id: target.id,
        requested: target.quantity,
        available: await readCurrentStock(tx, target),
      });
      continue;
    }

    await writeInventoryLog(tx, {
      target,
      delta: -target.quantity,
      stockAfter: updatedRows[0].stockAfter,
      reason: args.reason ?? "order",
      refId: args.refId,
      actor: args.actor,
    });
  }

  if (failures.length > 0) {
    // 이미 성공한 차감도 호출자의 트랜잭션 롤백으로 함께 무효화된다
    throw new StockShortageError(failures);
  }
}

/**
 * 취소·클레임 재고 복원. 복원은 조건이 없다(늘리는 방향이라 음수가 될 수 없음).
 * refId는 복원을 일으킨 근거 — 전체 취소는 주문번호, 클레임 복원은 클레임번호를 남긴다.
 */
export async function restoreStock(
  tx: TransactionClient,
  args: {
    targets: StockChangeTarget[];
    refId: string;
    reason: StockRestoreReason;
    actor: string;
  },
): Promise<void> {
  for (const target of args.targets) {
    const updatedRows =
      target.kind === "variant"
        ? await tx
            .update(productVariant)
            .set({ stock: sql`${productVariant.stock} + ${target.quantity}` })
            .where(eq(productVariant.id, target.id))
            .returning({ stockAfter: productVariant.stock })
        : await tx
            .update(productAddon)
            .set({ stock: sql`${productAddon.stock} + ${target.quantity}` })
            .where(eq(productAddon.id, target.id))
            .returning({ stockAfter: productAddon.stock });

    // 상품이 하드 삭제된 경우 복원할 행이 없다 — 원장만 남기지 않고 건너뛴다
    if (updatedRows.length === 0) continue;

    await writeInventoryLog(tx, {
      target,
      delta: target.quantity,
      stockAfter: updatedRows[0].stockAfter,
      reason: args.reason,
      refId: args.refId,
      actor: args.actor,
    });
  }
}

/**
 * 이 주문이 실제로 차감한 내역 — 전체 취소 복원의 원천.
 * order_item에서 역산하지 않는 이유: 추가상품은 스냅샷이라 수량 추적이 어렵고,
 * 원장(append-only)이 "무엇을 얼마나 뺐는지"의 사실이기 때문이다.
 */
export async function readOrderDeductions(
  tx: TransactionClient,
  orderNo: string,
): Promise<StockChangeTarget[]> {
  const rows = await tx
    .select({
      variantId: inventoryLog.variantId,
      addonId: inventoryLog.addonId,
      delta: inventoryLog.delta,
    })
    .from(inventoryLog)
    .where(and(eq(inventoryLog.refId, orderNo), eq(inventoryLog.reason, "order")));

  return rows.flatMap((row): StockChangeTarget[] => {
    const quantity = Math.abs(row.delta);
    if (row.variantId !== null) return [{ kind: "variant", id: row.variantId, quantity }];
    if (row.addonId !== null) return [{ kind: "addon", id: row.addonId, quantity }];
    return []; // 상품 하드 삭제로 FK가 null이 된 이력 — 복원 대상 없음
  });
}

async function readCurrentStock(
  tx: TransactionClient,
  target: StockChangeTarget,
): Promise<number> {
  const rows =
    target.kind === "variant"
      ? await tx
          .select({ stock: productVariant.stock })
          .from(productVariant)
          .where(eq(productVariant.id, target.id))
          .limit(1)
      : await tx
          .select({ stock: productAddon.stock })
          .from(productAddon)
          .where(eq(productAddon.id, target.id))
          .limit(1);

  return rows[0]?.stock ?? 0;
}

async function writeInventoryLog(
  tx: TransactionClient,
  args: {
    target: StockChangeTarget;
    delta: number;
    stockAfter: number;
    reason: string;
  } & StockActor,
): Promise<void> {
  await tx.insert(inventoryLog).values({
    variantId: args.target.kind === "variant" ? args.target.id : null,
    addonId: args.target.kind === "addon" ? args.target.id : null,
    delta: args.delta,
    stockAfter: args.stockAfter,
    reason: args.reason,
    refId: args.refId,
    createdBy: args.actor,
  });
}
