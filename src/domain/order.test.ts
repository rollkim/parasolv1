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
  maskAddressDetail,
  maskOrdererName,
  maskPhone,
  maskTrackingNo,
  OrderAmountMismatchError,
  ORDER_STATUSES,
  type OrderDraftLine,
  type OrderStatus,
  orderStatusLabel,
  orderTimelineFor,
  PAYMENT_STATUSES,
  sideEffectsFor,
} from "./order";
import type { ShippingPolicy } from "./cart";
import { formatPhone, isMobilePhone, normalizePhone } from "./phone";

const POLICY: ShippingPolicy = { baseFee: 3000, freeThreshold: 30000 };

function line(over: Partial<OrderDraftLine> = {}): OrderDraftLine {
  return {
    variantId: 1,
    productId: 1,
    productName: "통밀 오트 쿠키 세트",
    makerName: "볕든 공방",
    variantName: "24개입 / 기본 포장",
    listPrice: null,
    unitPrice: 20700,
    quantity: 1,
    thumbnailPath: null,
    thumbnailAlt: null,
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

  it("스냅샷은 상품명·공방·옵션·정가·썸네일을 복사한다", () => {
    const draft = buildOrderDraft(
      [line({ listPrice: 22800, thumbnailPath: "/img/a.webp", thumbnailAlt: "쿠키 세트" })],
      POLICY,
    );
    expect(draft.items[0]).toMatchObject({
      productName: "통밀 오트 쿠키 세트",
      makerName: "볕든 공방",
      variantName: "24개입 / 기본 포장",
      listPrice: 22800,
      unitPrice: 20700,
      thumbnailPath: "/img/a.webp",
      thumbnailAlt: "쿠키 세트",
    });
  });

  it("정가가 있으면 총 상품금액·상품 할인을 계산한다", () => {
    const draft = buildOrderDraft(
      [line({ listPrice: 22800, unitPrice: 20700, quantity: 2 })],
      POLICY,
    );
    expect(draft.listTotal).toBe(45600);
    expect(draft.goodsTotal).toBe(41400);
    expect(draft.productDiscount).toBe(4200);
  });

  it("정가가 없으면 할인 0 — 총 상품금액은 판매가 합계", () => {
    const draft = buildOrderDraft([line({ listPrice: null, unitPrice: 20700 })], POLICY);
    expect(draft.listTotal).toBe(20700);
    expect(draft.productDiscount).toBe(0);
  });

  it("정가가 판매가 이하면(데이터 이상) 음수 할인을 만들지 않는다", () => {
    const draft = buildOrderDraft([line({ listPrice: 15000, unitPrice: 20700 })], POLICY);
    expect(draft.listTotal).toBe(20700);
    expect(draft.productDiscount).toBe(0);
  });

  it("추가상품은 상품 할인·무료배송 판정에서 제외된다", () => {
    const draft = buildOrderDraft(
      [
        line({
          listPrice: 32000,
          unitPrice: 29000,
          quantity: 1,
          addons: [{ addonId: 1, addonName: "선물 포장", addonPrice: 1000, addonQuantity: 1 }],
        }),
      ],
      POLICY,
    );
    expect(draft.addonTotal).toBe(1000);
    expect(draft.productDiscount).toBe(3000);
    // 판매가 상품합계 29,000 < 30,000 → 추가상품을 더해 3만이 넘어도 배송비 부과
    expect(draft.shippingFee).toBe(3000);
    expect(draft.grandTotal).toBe(33000);
  });
});

describe("금액 위변조 방어", () => {
  it("일치하면 통과, 불일치하면 OrderAmountMismatchError", () => {
    expect(() => assertPaidAmountMatches(23700, 23700)).not.toThrow();
    expect(() => assertPaidAmountMatches(23700, 100)).toThrow(OrderAmountMismatchError);
  });
});

describe("PII 마스킹", () => {
  it("이름 — 첫 글자만 노출(비회원조회 목업 규칙)", () => {
    expect(maskOrdererName("홍정성")).toBe("홍**");
    expect(maskOrdererName("김보람")).toBe("김**");
    expect(maskOrdererName("남궁민수")).toBe("남***");
    expect(maskOrdererName("김보")).toBe("김*");
    expect(maskOrdererName("이")).toBe("이");
  });
  it("전화", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });
  it("송장번호 — 앞 1·뒤 2만 노출", () => {
    expect(maskTrackingNo("612345678923")).toBe("6*********23");
    expect(maskTrackingNo("123")).toBe("123");
  });
  it("배송지 상세주소만 마스킹", () => {
    expect(maskAddressDetail("301호")).toBe("****");
    expect(maskAddressDetail("3층 301호")).toBe("*******"); // 공백 포함 7자
    expect(maskAddressDetail(null)).toBeNull();
    expect(maskAddressDetail("")).toBe("");
  });
});

describe("상태 표기", () => {
  it("전 상태에 한글 라벨이 있다", () => {
    for (const status of ORDER_STATUSES) {
      expect(orderStatusLabel(status).length).toBeGreaterThan(0);
    }
  });
  it("타임라인 4단계 — 진행 상태는 단계, 결제대기·취소는 타임라인 밖", () => {
    expect(orderTimelineFor("paid").currentStep).toBe(0);
    expect(orderTimelineFor("shipping").currentStep).toBe(2);
    expect(orderTimelineFor("delivered").currentStep).toBe(3);
    // 구매확정은 배송완료 이후 — 마지막 단계에 머문다
    expect(orderTimelineFor("confirmed").currentStep).toBe(3);
    expect(orderTimelineFor("pending").outOfTimeline).toBe(true);
    expect(orderTimelineFor("cancelled").outOfTimeline).toBe(true);
  });
});

describe("전화번호 정규화(저장·조회 동일 규칙)", () => {
  it("숫자만 남긴다 — 하이픈 유무와 무관하게 같은 값", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
    expect(normalizePhone("01012345678")).toBe("01012345678");
  });
  it("형식 검증·표시 변환", () => {
    expect(isMobilePhone("01012345678")).toBe(true);
    expect(isMobilePhone("0212345678")).toBe(false);
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
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
