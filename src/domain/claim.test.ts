import { describe, expect, it } from "vitest";

import { claimFault, claimStatus, claimType } from "@/db/schema";

import {
  allowedFeeMethods,
  assertClaimTransition,
  availableClaimActions,
  availableClaimTypes,
  assertClaimableQuantity,
  assertExchangeFeeSettled,
  assertManualRefundReference,
  assertOrderClaimable,
  assertReasonAllowsType,
  calcClaimAmounts,
  calcClaimShippingFee,
  canClaimTransition,
  CLAIM_FAULTS,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  CLAIM_WINDOW_DAYS,
  ClaimFeeUnsettledError,
  ClaimQuantityExceededError,
  ClaimReasonNotAllowedError,
  ClaimWindowExpiredError,
  claimSideEffectsFor,
  claimStatusLabel,
  claimTimelineFor,
  claimTypeLabel,
  IllegalClaimTransitionError,
  isClaimFeeSettled,
  isClaimTerminalStatus,
  ManualRefundReferenceRequiredError,
  OrderNotClaimableError,
  parseClaimReasonMeta,
  requiresTransitionMemo,
  type ClaimStatus,
  type ClaimType,
} from "./claim";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("상태 전이표", () => {
  it("취소: requested→done(환불·복원·주문취소) / requested→rejected만 합법", () => {
    expect(canClaimTransition("cancel", "requested", "done")).toBe(true);
    expect(canClaimTransition("cancel", "requested", "rejected")).toBe(true);
    expect(canClaimTransition("cancel", "requested", "collecting")).toBe(false);
    expect(claimSideEffectsFor("cancel", "requested", "done")).toEqual([
      "refund",
      "restore_stock",
      "transition_order_cancelled",
    ]);
  });

  it("반품: requested→collecting→inspecting→done, 각 단계 반려 가능", () => {
    expect(canClaimTransition("return", "requested", "collecting")).toBe(true);
    expect(canClaimTransition("return", "collecting", "inspecting")).toBe(true);
    expect(canClaimTransition("return", "inspecting", "done")).toBe(true);
    expect(canClaimTransition("return", "inspecting", "rejected")).toBe(true);
    // 반품은 requested에서 바로 done으로 못 간다 — 회수·검수 없이 환불되면 안 된다
    expect(canClaimTransition("return", "requested", "done")).toBe(false);
    expect(claimSideEffectsFor("return", "inspecting", "done")).toEqual([
      "refund",
      "restore_stock",
    ]);
  });

  it("교환: 검수 합격 시 재발송 + 회수품 복원 + 교환품 차감", () => {
    expect(claimSideEffectsFor("exchange", "inspecting", "done")).toEqual([
      "ship_replacement",
      "restore_stock",
      "deduct_replacement_stock",
    ]);
    expect(canClaimTransition("exchange", "requested", "done")).toBe(false);
  });

  it("approved는 어느 유형에서도 진입 불가(전이표가 사용을 막는다)", () => {
    for (const type of CLAIM_TYPES) {
      for (const from of CLAIM_STATUSES) {
        expect(canClaimTransition(type, from, "approved")).toBe(false);
      }
    }
  });

  it("종결 상태(done·rejected)에서 나가는 전이가 없다", () => {
    for (const type of CLAIM_TYPES) {
      for (const to of CLAIM_STATUSES) {
        expect(canClaimTransition(type, "done", to)).toBe(false);
        expect(canClaimTransition(type, "rejected", to)).toBe(false);
      }
    }
    expect(isClaimTerminalStatus("done")).toBe(true);
    expect(isClaimTerminalStatus("rejected")).toBe(true);
    expect(isClaimTerminalStatus("collecting")).toBe(false);
  });

  it("불법 전이는 assert가 던진다 / 반려는 사유 메모 필수", () => {
    expect(() => assertClaimTransition("cancel", "requested", "inspecting")).toThrow(
      IllegalClaimTransitionError,
    );
    expect(requiresTransitionMemo("rejected")).toBe(true);
    expect(requiresTransitionMemo("done")).toBe(false);
  });
});

describe("클레임 가능 조건", () => {
  const now = new Date("2026-07-28T12:00:00+09:00");

  it("취소는 paid·preparing에서만", () => {
    for (const orderStatus of ["paid", "preparing"] as const) {
      expect(() =>
        assertOrderClaimable({ claimType: "cancel", orderStatus, deliveredAt: null, now }),
      ).not.toThrow();
    }
    for (const orderStatus of ["pending", "shipping", "delivered", "confirmed", "cancelled"] as const) {
      expect(() =>
        assertOrderClaimable({ claimType: "cancel", orderStatus, deliveredAt: null, now }),
      ).toThrow(OrderNotClaimableError);
    }
  });

  it("반품·교환은 delivered + 7일 이내 — 경계일 포함, 하루 지나면 만료", () => {
    const deliveredAt = new Date(now.getTime() - CLAIM_WINDOW_DAYS * DAY_MS); // 정확히 7일 전
    expect(() =>
      assertOrderClaimable({ claimType: "return", orderStatus: "delivered", deliveredAt, now }),
    ).not.toThrow();

    const expired = new Date(now.getTime() - (CLAIM_WINDOW_DAYS * DAY_MS + 1));
    expect(() =>
      assertOrderClaimable({ claimType: "return", orderStatus: "delivered", deliveredAt: expired, now }),
    ).toThrow(ClaimWindowExpiredError);
  });

  it("배송 중에는 어느 클레임도 불가", () => {
    expect(() =>
      assertOrderClaimable({ claimType: "return", orderStatus: "shipping", deliveredAt: null, now }),
    ).toThrow(OrderNotClaimableError);
    expect(() =>
      assertOrderClaimable({ claimType: "exchange", orderStatus: "shipping", deliveredAt: null, now }),
    ).toThrow(OrderNotClaimableError);
  });

  it("delivered인데 delivered_at이 없으면(데이터 이상) 무기한 반품을 막기 위해 거부", () => {
    expect(() =>
      assertOrderClaimable({ claimType: "return", orderStatus: "delivered", deliveredAt: null, now }),
    ).toThrow(ClaimWindowExpiredError);
  });

  it("구매확정 후에는 반품·교환 불가", () => {
    expect(() =>
      assertOrderClaimable({
        claimType: "return",
        orderStatus: "confirmed",
        deliveredAt: new Date(now.getTime() - DAY_MS),
        now,
      }),
    ).toThrow(OrderNotClaimableError);
  });
});

describe("availableClaimTypes — 화면 버튼 노출용 목적지", () => {
  const now = new Date("2026-07-28T12:00:00+09:00");

  it("이미 접수된(반려 아닌) 취소 건이 있으면 취소를 목록에서 뺀다", () => {
    // 실제 버그: 취소 접수 후에도 주문 상태는 여전히 paid/preparing이라, 이 플래그가
    // 없으면 버튼이 계속 떠서 다시 눌렀을 때 서버가 수량 초과로 거절했다
    expect(
      availableClaimTypes({
        orderStatus: "paid",
        deliveredAt: null,
        now,
        hasActiveCancelClaim: true,
      }),
    ).not.toContain("cancel");
  });

  it("취소 건이 없으면(또는 전부 반려) paid·preparing에서 취소가 뜬다", () => {
    for (const orderStatus of ["paid", "preparing"] as const) {
      expect(
        availableClaimTypes({ orderStatus, deliveredAt: null, now, hasActiveCancelClaim: false }),
      ).toContain("cancel");
    }
  });

  it("취소 접수 여부는 교환·반품에는 영향을 주지 않는다 — 그쪽은 품목별 잔여수량으로 폼이 따로 처리한다", () => {
    const deliveredAt = new Date(now.getTime() - DAY_MS);
    const withActiveCancel = availableClaimTypes({
      orderStatus: "delivered",
      deliveredAt,
      now,
      hasActiveCancelClaim: true,
    });
    expect(withActiveCancel).toContain("exchange");
    expect(withActiveCancel).toContain("return");
  });
});

describe("수량 불변식", () => {
  it("누적 클레임 + 신청 수량 ≤ 주문 수량", () => {
    expect(() =>
      assertClaimableQuantity({ orderedQuantity: 3, activeClaimedQuantity: 1, requestedQuantity: 2 }),
    ).not.toThrow();
    expect(() =>
      assertClaimableQuantity({ orderedQuantity: 3, activeClaimedQuantity: 2, requestedQuantity: 2 }),
    ).toThrow(ClaimQuantityExceededError);
  });

  it("0·음수·비정수 수량 거부", () => {
    for (const requestedQuantity of [0, -1, 1.5]) {
      expect(() =>
        assertClaimableQuantity({ orderedQuantity: 3, activeClaimedQuantity: 0, requestedQuantity }),
      ).toThrow(ClaimQuantityExceededError);
    }
  });
});

describe("사유 → 귀책·허용 유형 (시드 meta 파싱)", () => {
  it("정상 meta를 파싱한다", () => {
    expect(
      parseClaimReasonMeta({ fault: "buyer", claimTypes: ["cancel", "return"] }),
    ).toEqual({ fault: "buyer", claimTypes: ["cancel", "return"] });
  });

  it("형태가 어긋나면 null — 서비스가 해당 사유를 거부한다", () => {
    expect(parseClaimReasonMeta(null)).toBeNull();
    expect(parseClaimReasonMeta({ fault: "unknown", claimTypes: ["cancel"] })).toBeNull();
    expect(parseClaimReasonMeta({ fault: "buyer" })).toBeNull();
    expect(parseClaimReasonMeta({ fault: "buyer", claimTypes: [] })).toBeNull();
    expect(parseClaimReasonMeta({ fault: "buyer", claimTypes: ["invalid"] })).toBeNull();
  });

  it("사유가 허용하지 않는 유형이면 거부 — change_mind는 교환 불가(시드 정책)", () => {
    const changeMind = { fault: "buyer" as const, claimTypes: ["cancel", "return"] as ClaimType[] };
    expect(() => assertReasonAllowsType("change_mind", changeMind, "return")).not.toThrow();
    expect(() => assertReasonAllowsType("change_mind", changeMind, "exchange")).toThrow(
      ClaimReasonNotAllowedError,
    );
  });
});

describe("금액 계산", () => {
  const BASE_FEE = 3000;

  it("배송비: 취소 0 · 반품 편도 3,000 · 교환 왕복 6,000 · 판매자 귀책 0 (D2)", () => {
    expect(calcClaimShippingFee({ claimType: "cancel", fault: "buyer", baseFee: BASE_FEE })).toBe(0);
    expect(calcClaimShippingFee({ claimType: "return", fault: "buyer", baseFee: BASE_FEE })).toBe(3000);
    expect(calcClaimShippingFee({ claimType: "exchange", fault: "buyer", baseFee: BASE_FEE })).toBe(6000);
    expect(calcClaimShippingFee({ claimType: "return", fault: "seller", baseFee: BASE_FEE })).toBe(0);
    expect(calcClaimShippingFee({ claimType: "exchange", fault: "seller", baseFee: BASE_FEE })).toBe(0);
  });

  it("기본 배송비가 바뀌면 클레임 배송비가 따라간다(상수 금지 — 파생)", () => {
    expect(calcClaimShippingFee({ claimType: "exchange", fault: "buyer", baseFee: 4000 })).toBe(8000);
  });

  it("취소: 상품 전액 + 주문 배송비 환불", () => {
    const amounts = calcClaimAmounts({
      claimType: "cancel",
      fault: "buyer",
      baseFee: BASE_FEE,
      orderShippingFee: 3000,
      orderCouponDiscount: 0,
      orderPointUsed: 0,
      lines: [{ unitPrice: 20700, claimQuantity: 1, orderedQuantity: 1, addonTotal: 1000 }],
    });
    expect(amounts.goodsAmount).toBe(21700);
    expect(amounts.shippingFee).toBe(0);
    expect(amounts.refundAmount).toBe(24700); // 21,700 + 주문 배송비 3,000
  });

  it("취소: 쿠폰·적립금 사용분을 빼면 곧 실결제액이다", () => {
    // 상품 20,000 + 배송 3,000 − 쿠폰 5,000 − 적립금 2,000 = 카드로 낸 16,000
    // 안 빼면 카드 결제액보다 큰 환불을 시도해 잔액 불변식에 막힌다(환불 실패)
    const amounts = calcClaimAmounts({
      claimType: "cancel",
      fault: "buyer",
      baseFee: BASE_FEE,
      orderShippingFee: 3000,
      orderCouponDiscount: 5000,
      orderPointUsed: 2000,
      lines: [{ unitPrice: 20000, claimQuantity: 1, orderedQuantity: 1, addonTotal: 0 }],
    });
    expect(amounts.refundAmount).toBe(16000);
  });

  it("반품의 환불액 스냅샷은 쿠폰·적립금을 모른다 — 비례 차감은 환불 실행 시점 몫", () => {
    const amounts = calcClaimAmounts({
      claimType: "return",
      fault: "seller",
      baseFee: BASE_FEE,
      orderShippingFee: 0,
      orderCouponDiscount: 5000,
      orderPointUsed: 2000,
      lines: [{ unitPrice: 10000, claimQuantity: 1, orderedQuantity: 2, addonTotal: 0 }],
    });
    expect(amounts.refundAmount).toBe(10000);
  });

  it("반품(구매자 귀책): 상품금액 − 배송비", () => {
    const amounts = calcClaimAmounts({
      claimType: "return",
      fault: "buyer",
      baseFee: BASE_FEE,
      orderShippingFee: 0,
      orderCouponDiscount: 0,
      orderPointUsed: 0,
      lines: [{ unitPrice: 20000, claimQuantity: 1, orderedQuantity: 2, addonTotal: 0 }],
    });
    expect(amounts.refundAmount).toBe(17000);
  });

  it("반품 환불액은 0 아래로 내려가지 않는다 — 차액을 청구하지 않는다(불변식 2)", () => {
    const amounts = calcClaimAmounts({
      claimType: "return",
      fault: "buyer",
      baseFee: BASE_FEE,
      orderShippingFee: 0,
      orderCouponDiscount: 0,
      orderPointUsed: 0,
      lines: [{ unitPrice: 2000, claimQuantity: 1, orderedQuantity: 1, addonTotal: 0 }],
    });
    expect(amounts.refundAmount).toBe(0); // 2,000 − 3,000 → 0
  });

  it("교환: 환불 0, 배송비는 별도 수취", () => {
    const amounts = calcClaimAmounts({
      claimType: "exchange",
      fault: "buyer",
      baseFee: BASE_FEE,
      orderShippingFee: 0,
      orderCouponDiscount: 0,
      orderPointUsed: 0,
      lines: [{ unitPrice: 20000, claimQuantity: 1, orderedQuantity: 1, addonTotal: 0 }],
    });
    expect(amounts.refundAmount).toBe(0);
    expect(amounts.shippingFee).toBe(6000);
  });

  it("추가상품은 라인 전량 클레임일 때만 포함(D11)", () => {
    const full = calcClaimAmounts({
      claimType: "return",
      fault: "seller",
      baseFee: BASE_FEE,
      orderShippingFee: 0,
      orderCouponDiscount: 0,
      orderPointUsed: 0,
      lines: [{ unitPrice: 10000, claimQuantity: 2, orderedQuantity: 2, addonTotal: 3000 }],
    });
    expect(full.goodsAmount).toBe(23000);

    const partial = calcClaimAmounts({
      claimType: "return",
      fault: "seller",
      baseFee: BASE_FEE,
      orderShippingFee: 0,
      orderCouponDiscount: 0,
      orderPointUsed: 0,
      lines: [{ unitPrice: 10000, claimQuantity: 1, orderedQuantity: 2, addonTotal: 3000 }],
    });
    expect(partial.goodsAmount).toBe(10000); // addon 미포함 — 복원 수량이 소수가 되므로
  });

  it("신청 수량이 주문 수량을 넘으면 계산 자체를 거부", () => {
    expect(() =>
      calcClaimAmounts({
        claimType: "return",
        fault: "buyer",
        baseFee: BASE_FEE,
        orderShippingFee: 0,
        orderCouponDiscount: 0,
        orderPointUsed: 0,
        lines: [{ unitPrice: 10000, claimQuantity: 3, orderedQuantity: 2, addonTotal: 0 }],
      }),
    ).toThrow(ClaimQuantityExceededError);
  });
});

describe("배송비 수취 (fee_method)", () => {
  it("유형별 선택지: 취소 없음 · 반품 차감 고정(A안) · 교환 계좌이체(1차)", () => {
    expect(allowedFeeMethods("cancel")).toEqual([]);
    expect(allowedFeeMethods("return")).toEqual(["deduct_refund"]);
    expect(allowedFeeMethods("exchange")).toEqual(["bank_transfer"]);
  });

  it("0원이면 수취할 것이 없다 — 완료로 본다", () => {
    expect(isClaimFeeSettled({ shippingFee: 0, feeSettledAt: null })).toBe(true);
    expect(isClaimFeeSettled({ shippingFee: 6000, feeSettledAt: null })).toBe(false);
    expect(isClaimFeeSettled({ shippingFee: 6000, feeSettledAt: new Date() })).toBe(true);
  });

  it("교환품 발송 게이트: 미입금이면 차단, 입금·무료·타 유형은 통과", () => {
    expect(() =>
      assertExchangeFeeSettled({ claimType: "exchange", shippingFee: 6000, feeSettledAt: null }),
    ).toThrow(ClaimFeeUnsettledError);
    expect(() =>
      assertExchangeFeeSettled({ claimType: "exchange", shippingFee: 6000, feeSettledAt: new Date() }),
    ).not.toThrow();
    expect(() =>
      assertExchangeFeeSettled({ claimType: "exchange", shippingFee: 0, feeSettledAt: null }),
    ).not.toThrow();
    expect(() =>
      assertExchangeFeeSettled({ claimType: "return", shippingFee: 3000, feeSettledAt: null }),
    ).not.toThrow();
  });
});

describe("환불 채널 (D10)", () => {
  it("수동 채널은 참조 필수 — 시스템이 검증 못 하는 지점의 감사 근거", () => {
    expect(() => assertManualRefundReference("pg_console", "toss-cancel-123")).not.toThrow();
    expect(() => assertManualRefundReference("bank_transfer", " ")).toThrow(
      ManualRefundReferenceRequiredError,
    );
    expect(() => assertManualRefundReference("pg_console", null)).toThrow(
      ManualRefundReferenceRequiredError,
    );
    expect(() => assertManualRefundReference("pg_api", null)).not.toThrow();
  });
});

describe("표시 라벨·타임라인", () => {
  it("전 상태·유형에 한글 라벨", () => {
    for (const status of CLAIM_STATUSES) {
      expect(claimStatusLabel(status).length).toBeGreaterThan(0);
    }
    expect(claimTypeLabel("cancel")).toBe("취소");
    expect(claimTypeLabel("return")).toBe("반품");
    expect(claimTypeLabel("exchange")).toBe("교환");
  });

  it("타임라인: 취소 2단계, 반품·교환 4단계, 반려는 타임라인 밖", () => {
    expect(claimTimelineFor("cancel", "requested")).toMatchObject({
      steps: ["접수", "환불 완료"],
      currentStep: 0,
    });
    expect(claimTimelineFor("cancel", "done").currentStep).toBe(1);
    expect(claimTimelineFor("return", "inspecting")).toMatchObject({
      steps: ["접수", "회수", "검수", "환불"],
      currentStep: 2,
    });
    expect(claimTimelineFor("exchange", "done")).toMatchObject({
      steps: ["접수", "회수", "검수", "재발송"],
      currentStep: 3,
    });
    expect(claimTimelineFor("return", "rejected").outOfTimeline).toBe(true);
    // 취소에는 회수·검수 상태가 정상 경로에 없다 — 들어오면 타임라인 밖
    expect(claimTimelineFor("cancel", "collecting").outOfTimeline).toBe(true);
  });
});

describe("관리자 행동 목록", () => {
  const noFee = { feeMethod: null, shippingFee: 0, feeSettledAt: null };
  const actionsOf = (input: Parameters<typeof availableClaimActions>[0]) =>
    availableClaimActions(input).map((option) => option.action);

  it("취소 접수 — 승인이 곧 환불이라 회수·검수 단계가 없다", () => {
    expect(actionsOf({ claimType: "cancel", status: "requested", ...noFee })).toEqual([
      "refund",
      "reject",
    ]);
  });

  it("반품은 승인 → 회수완료 → 환불 순으로만 열린다", () => {
    expect(actionsOf({ claimType: "return", status: "requested", ...noFee })).toEqual([
      "approve",
      "reject",
    ]);
    expect(actionsOf({ claimType: "return", status: "collecting", ...noFee })).toEqual([
      "markCollected",
    ]);
    expect(actionsOf({ claimType: "return", status: "inspecting", ...noFee })).toEqual([
      "refund",
      "reject",
    ]);
  });

  it("교환 검수 완료는 환불이 아니라 교환품 발송이다", () => {
    expect(actionsOf({ claimType: "exchange", status: "inspecting", ...noFee })).toEqual([
      "completeExchange",
      "reject",
    ]);
  });

  it("종결 상태에는 남은 행동이 없다", () => {
    expect(actionsOf({ claimType: "return", status: "done", ...noFee })).toEqual([]);
    expect(actionsOf({ claimType: "return", status: "rejected", ...noFee })).toEqual([]);
  });

  it("계좌이체 배송비는 입금 확인 전까지만 행동이 나온다", () => {
    const unsettled = {
      claimType: "exchange" as const,
      status: "collecting" as const,
      feeMethod: "bank_transfer" as const,
      shippingFee: 6000,
      feeSettledAt: null,
    };
    expect(actionsOf(unsettled)).toContain("settleFee");
    expect(actionsOf({ ...unsettled, feeSettledAt: new Date() })).not.toContain("settleFee");
    // 반품은 환불 차감이라 따로 받을 것이 없다
    expect(
      actionsOf({ ...unsettled, claimType: "return", feeMethod: "deduct_refund" }),
    ).not.toContain("settleFee");
  });

  it("행동 목록은 전이표를 벗어나지 않는다 — 눌러야 거부당하는 버튼이 없다", () => {
    const statusOf: Partial<Record<string, ClaimStatus>> = {
      approve: "collecting",
      markCollected: "inspecting",
      refund: "done",
      completeExchange: "done",
      reject: "rejected",
    };
    for (const type of CLAIM_TYPES) {
      for (const status of CLAIM_STATUSES) {
        for (const option of availableClaimActions({
          claimType: type,
          status,
          feeMethod: "bank_transfer",
          shippingFee: 6000,
          feeSettledAt: null,
        })) {
          const target = statusOf[option.action];
          if (!target) continue; // settleFee는 상태 전이가 아니다
          expect(canClaimTransition(type, status, target)).toBe(true);
        }
      }
    }
  });
});

describe("스키마 enum 동기화(드리프트 방지)", () => {
  it("도메인 목록이 DB enum과 정확히 같은 집합", () => {
    expect([...CLAIM_STATUSES].sort()).toEqual([...claimStatus.enumValues].sort());
    expect([...CLAIM_TYPES].sort()).toEqual([...claimType.enumValues].sort());
    expect([...CLAIM_FAULTS].sort()).toEqual([...claimFault.enumValues].sort());
  });

  it("전이표의 모든 from·to가 enum 값이다", () => {
    const statuses = new Set<ClaimStatus>(CLAIM_STATUSES);
    for (const type of CLAIM_TYPES) {
      for (const from of CLAIM_STATUSES) {
        for (const to of CLAIM_STATUSES) {
          if (canClaimTransition(type, from, to)) {
            expect(statuses.has(from)).toBe(true);
            expect(statuses.has(to)).toBe(true);
          }
        }
      }
    }
  });
});
