import { describe, expect, it } from "vitest";

import { orderStatus, paymentStatus } from "@/db/schema";

import {
  allowedTargets,
  assertPaidAmountMatches,
  assertTransition,
  BlockedOrderLineError,
  buildOrderDraft,
  canTransition,
  canTransitionPaymentStatus,
  IllegalOrderTransitionError,
  isTerminalStatus,
  maskOrdererName,
  maskPhone,
  OrderAmountMismatchError,
  ORDER_STATUSES,
  type OrderDraftLine,
  type OrderStatus,
  PAYMENT_STATUSES,
  sideEffectsFor,
} from "./order";
import type { ShippingPolicy } from "./cart";

const POLICY: ShippingPolicy = { baseFee: 3000, freeThreshold: 30000 };

function line(over: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return {
    variantId: 1,
    productId: 1,
    productName: "통밀 오트 쿠키 세트",
    makerName: "볕든 공방",
    variantName: "24개입 / 기본 포장",
    unitPrice: 20700,
    quantity: 1,
    addons: [],
    orderable: true,
    ...over,
  };
}

describe("상태 전이표", () => {
  it("정상 흐름 pending→paid→preparing→shipping→delivered→confirmed", () => {
    expect(canTransition("pending", "paid", "system")).toBe(true);
    expect(canTransition("paid", "preparing", "admin")).toBe(true);
    expect(canTransition("preparing", "shipping", "admin")).toBe(true);
    expect(canTransition("shipping", "delivered", "admin")).toBe(true);
    expect(canTransition("delivered", "confirmed", "customer")).toBe(true);
  });

  it("actor 권한 — 고객은 배송준비/발송을 못 한다", () => {
    expect(canTransition("paid", "preparing", "customer")).toBe(false);
    expect(canTransition("preparing", "shipping", "customer")).toBe(false);
    expect(canTransition("pending", "paid", "customer")).toBe(false); // 결제 전이는 system만
  });

  it("건너뛰기·역행·정의되지 않은 전이는 불법", () => {
    expect(canTransition("pending", "shipping", "admin")).toBe(false);
    expect(canTransition("delivered", "shipping", "admin")).toBe(false);
    expect(canTransition("paid", "pending", "admin")).toBe(false);
  });

  it("종료 상태에서는 어떤 전이도 불가", () => {
    expect(isTerminalStatus("confirmed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    for (const to of orderStatus.enumValues) {
      expect(canTransition("confirmed", to as OrderStatus, "admin")).toBe(false);
      expect(canTransition("cancelled", to as OrderStatus, "system")).toBe(false);
    }
  });

  it("assertTransition은 불법 전이에 IllegalOrderTransitionError를 던진다", () => {
    expect(() => assertTransition("pending", "paid", "system")).not.toThrow();
    expect(() => assertTransition("pending", "delivered", "admin")).toThrow(
      IllegalOrderTransitionError,
    );
  });

  it("전이 부작용 — paid는 재고차감+카트소진, 취소는 환불+복원", () => {
    expect(sideEffectsFor("pending", "paid")).toEqual(["deduct_stock", "consume_cart"]);
    expect(sideEffectsFor("pending", "cancelled")).toEqual([]); // pending 무점유
    expect(sideEffectsFor("paid", "cancelled")).toEqual(["refund", "restore_stock"]);
    expect(sideEffectsFor("shipping", "delivered")).toEqual(["set_delivered_at"]);
    expect(sideEffectsFor("delivered", "confirmed")).toEqual(["set_confirmed_at"]);
  });

  it("allowedTargets — 화면 버튼 노출용 목적지", () => {
    expect(allowedTargets("paid", "admin").sort()).toEqual(["cancelled", "preparing"]);
    expect(allowedTargets("delivered", "customer")).toEqual(["confirmed"]);
    expect(allowedTargets("confirmed", "admin")).toEqual([]);
  });
});

describe("결제 상태 전이", () => {
  it("허용/불허", () => {
    expect(canTransitionPaymentStatus("ready", "paid")).toBe(true);
    expect(canTransitionPaymentStatus("paid", "cancelled")).toBe(true);
    expect(canTransitionPaymentStatus("paid", "partial_cancelled")).toBe(true);
    expect(canTransitionPaymentStatus("failed", "paid")).toBe(false);
    expect(canTransitionPaymentStatus("cancelled", "paid")).toBe(false);
  });
});

describe("주문 초안 금액·스냅샷", () => {
  it("소계·배송비·합계를 서버 계산한다(3만원 미만 배송비 3000)", () => {
    const draft = buildOrderDraft([line({ unitPrice: 20700, quantity: 1 })], POLICY);
    expect(draft.subtotal).toBe(20700);
    expect(draft.shippingFee).toBe(3000);
    expect(draft.grandTotal).toBe(23700);
    expect(draft.couponDiscount).toBe(0);
    expect(draft.pointUsed).toBe(0);
  });

  it("3만원 이상은 무료배송", () => {
    const draft = buildOrderDraft([line({ unitPrice: 20700, quantity: 2 })], POLICY);
    expect(draft.subtotal).toBe(41400);
    expect(draft.shippingFee).toBe(0);
    expect(draft.grandTotal).toBe(41400);
  });

  it("추가상품 금액을 라인·합계에 포함", () => {
    const draft = buildOrderDraft(
      [
        line({
          unitPrice: 11700,
          quantity: 1,
          addons: [
            { addonId: 10, addonName: "보냉 보틀백", addonPrice: 3000, addonQuantity: 1 },
            { addonId: 11, addonName: "메시지 카드", addonPrice: 1000, addonQuantity: 2 },
          ],
        }),
      ],
      POLICY,
    );
    expect(draft.items[0].lineTotal).toBe(11700 + 3000 + 2000);
    expect(draft.items[0].addons[1].lineTotal).toBe(2000);
    expect(draft.subtotal).toBe(16700);
  });

  it("주문 불가 라인이 포함되면 BlockedOrderLineError", () => {
    expect(() =>
      buildOrderDraft([line(), line({ variantId: 9, orderable: false })], POLICY),
    ).toThrow(BlockedOrderLineError);
  });

  it("빈 라인은 거부", () => {
    expect(() => buildOrderDraft([], POLICY)).toThrow(BlockedOrderLineError);
  });

  it("스냅샷은 상품명·공방·옵션을 복사한다", () => {
    const draft = buildOrderDraft([line()], POLICY);
    expect(draft.items[0]).toMatchObject({
      productName: "통밀 오트 쿠키 세트",
      makerName: "볕든 공방",
      variantName: "24개입 / 기본 포장",
      unitPrice: 20700,
    });
  });
});

describe("금액 위변조 방어", () => {
  it("일치하면 통과, 불일치하면 OrderAmountMismatchError", () => {
    expect(() => assertPaidAmountMatches(23700, 23700)).not.toThrow();
    expect(() => assertPaidAmountMatches(23700, 100)).toThrow(OrderAmountMismatchError);
  });
});

describe("PII 마스킹", () => {
  it("이름", () => {
    expect(maskOrdererName("홍정성")).toBe("홍*성");
    expect(maskOrdererName("김보람")).toBe("김*람");
    expect(maskOrdererName("남궁민수")).toBe("남**수");
    expect(maskOrdererName("김보")).toBe("김*");
    expect(maskOrdererName("이")).toBe("이");
  });
  it("전화", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });
});

describe("스키마 enum 동기화(드리프트 방지)", () => {
  it("도메인 상태 목록이 DB orderStatus enum과 정확히 같은 집합", () => {
    expect([...ORDER_STATUSES].sort()).toEqual([...orderStatus.enumValues].sort());
  });
  it("도메인 결제상태 목록이 DB paymentStatus enum과 정확히 같은 집합", () => {
    expect([...PAYMENT_STATUSES].sort()).toEqual([...paymentStatus.enumValues].sort());
  });
  it("비종료 상태는 모두 나가는 전이가 있고, 종료 상태는 없다", () => {
    for (const status of ORDER_STATUSES) {
      const hasOutgoing =
        allowedTargets(status, "system").length +
          allowedTargets(status, "customer").length +
          allowedTargets(status, "admin").length >
        0;
      expect(hasOutgoing).toBe(!isTerminalStatus(status));
    }
  });
});
