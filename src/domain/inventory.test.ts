import { describe, expect, it } from "vitest";

import {
  compareLockOrder,
  planStockDeductions,
  type StockChangeTarget,
} from "./inventory";

describe("재고 차감 계획", () => {
  it("variant·addon 타깃으로 집계", () => {
    const targets = planStockDeductions([
      { variantId: 5, quantity: 2, addons: [{ addonId: 10, quantity: 1 }] },
    ]);
    expect(targets).toEqual([
      { kind: "variant", id: 5, quantity: 2 },
      { kind: "addon", id: 10, quantity: 1 },
    ]);
  });

  it("같은 variant가 여러 라인에 흩어지면 수량 합산(한 행만 차감)", () => {
    const targets = planStockDeductions([
      { variantId: 5, quantity: 2, addons: [] },
      { variantId: 5, quantity: 3, addons: [] },
      { variantId: 7, quantity: 1, addons: [{ addonId: 10, quantity: 2 }] },
    ]);
    const variant5 = targets.find((t) => t.kind === "variant" && t.id === 5);
    expect(variant5?.quantity).toBe(5);
  });

  it("락 순서 정렬 — variant(id asc) 먼저, 그다음 addon(id asc)", () => {
    const targets = planStockDeductions([
      { variantId: 9, quantity: 1, addons: [{ addonId: 3, quantity: 1 }] },
      { variantId: 2, quantity: 1, addons: [{ addonId: 1, quantity: 1 }] },
    ]);
    expect(targets).toEqual([
      { kind: "variant", id: 2, quantity: 1 },
      { kind: "variant", id: 9, quantity: 1 },
      { kind: "addon", id: 1, quantity: 1 },
      { kind: "addon", id: 3, quantity: 1 },
    ]);
  });

  it("compareLockOrder — variant가 addon보다 먼저", () => {
    const v: StockChangeTarget = { kind: "variant", id: 100, quantity: 1 };
    const a: StockChangeTarget = { kind: "addon", id: 1, quantity: 1 };
    expect(compareLockOrder(v, a)).toBeLessThan(0);
    expect(compareLockOrder(a, v)).toBeGreaterThan(0);
  });

  it("빈 주문은 빈 계획", () => {
    expect(planStockDeductions([])).toEqual([]);
  });
});
