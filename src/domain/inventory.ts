/**
 * 재고 차감 계획 — 순수 로직. 실제 조건부 UPDATE는 inventory.service가 수행한다.
 * 여기서는 주문 라인들을 "무엇을 몇 개 차감할지" 타깃 목록으로 집계하고 락 순서로 정렬한다.
 * 락 순서 고정(variant 먼저·id 오름차순)은 동시 주문 간 데드락을 막는다.
 */

export type StockChangeTarget =
  | { kind: "variant"; id: number; quantity: number }
  | { kind: "addon"; id: number; quantity: number };

export type OrderLineForStock = {
  variantId: number;
  quantity: number;
  addons: { addonId: number; quantity: number }[];
};

/** variant 먼저, 그다음 addon. 같은 kind면 id 오름차순 — 데드락 회피용 전역 순서 */
export function compareLockOrder(a: StockChangeTarget, b: StockChangeTarget): number {
  if (a.kind !== b.kind) return a.kind === "variant" ? -1 : 1;
  return a.id - b.id;
}

/**
 * 주문 라인들을 타깃별 수량으로 집계한다.
 * 같은 variant/addon이 여러 라인에 흩어져 있으면 합산한다(한 번에 한 행만 차감).
 * 반환은 락 순서로 정렬 — 서비스가 이 순서대로 조건부 UPDATE 한다.
 */
export function planStockDeductions(
  lines: OrderLineForStock[],
): StockChangeTarget[] {
  const variantQty = new Map<number, number>();
  const addonQty = new Map<number, number>();

  for (const line of lines) {
    variantQty.set(line.variantId, (variantQty.get(line.variantId) ?? 0) + line.quantity);
    for (const addon of line.addons) {
      addonQty.set(addon.addonId, (addonQty.get(addon.addonId) ?? 0) + addon.quantity);
    }
  }

  const targets: StockChangeTarget[] = [
    ...[...variantQty].map(([id, quantity]): StockChangeTarget => ({ kind: "variant", id, quantity })),
    ...[...addonQty].map(([id, quantity]): StockChangeTarget => ({ kind: "addon", id, quantity })),
  ];

  return targets.sort(compareLockOrder);
}
