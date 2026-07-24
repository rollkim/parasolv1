/**
 * 카트 도메인 규칙 — DB·화면에 무관한 순수 계산.
 * 합계는 반드시 서버(이 모듈)에서 계산한다(RULE-11) — 클라이언트 계산은 신뢰하지 않는다.
 */

export type ShippingPolicy = {
  /** 기본 배송비(원) */
  baseFee: number;
  /** 무료배송 기준 금액(원) — 상품 합계가 이 이상이면 배송비 0 */
  freeThreshold: number;
};

/** 배송비 — 무료배송 기준 충족 시 0, 아니면 기본 배송비 */
export function calcShippingFee(subtotal: number, policy: ShippingPolicy): number {
  return subtotal >= policy.freeThreshold ? 0 : policy.baseFee;
}

export type CartAddonForSummary = {
  addonPrice: number;
  addonQuantity: number;
};

export type CartLineForSummary = {
  unitPrice: number;
  quantity: number;
  addons: CartAddonForSummary[];
  /** 품절·판매중지 라인은 주문할 수 없으므로 결제 예상 금액에서 제외한다 */
  orderable: boolean;
};

/** 라인 금액 = 단가 × 수량 + 추가상품 합 */
export function calcCartLineTotal(
  line: Pick<CartLineForSummary, "unitPrice" | "quantity" | "addons">,
): number {
  const addonTotal = line.addons.reduce(
    (sum, addon) => sum + addon.addonPrice * addon.addonQuantity,
    0,
  );
  return line.unitPrice * line.quantity + addonTotal;
}

export type CartSummary = {
  subtotal: number;
  shippingFee: number;
  grandTotal: number;
  /** 무료배송까지 남은 금액(원) — 0이면 무료배송 적용. 프로모션 바 표시용 */
  freeShippingRemaining: number;
};

export function calcCartSummary(
  lines: CartLineForSummary[],
  policy: ShippingPolicy,
): CartSummary {
  const subtotal = lines
    .filter((line) => line.orderable)
    .reduce((sum, line) => sum + calcCartLineTotal(line), 0);

  // 주문 가능 라인이 없으면 배송 자체가 없다 — 빈 카트에 배송비를 표시하지 않는다
  const shippingFee = subtotal === 0 ? 0 : calcShippingFee(subtotal, policy);

  return {
    subtotal,
    shippingFee,
    grandTotal: subtotal + shippingFee,
    freeShippingRemaining: Math.max(0, policy.freeThreshold - subtotal),
  };
}
