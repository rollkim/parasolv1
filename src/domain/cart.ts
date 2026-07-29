/**
 * 카트 도메인 규칙 — DB·화면에 무관한 순수 계산.
 * 합계는 반드시 서버(이 모듈)에서 계산한다(RULE-11) — 클라이언트 계산은 신뢰하지 않는다.
 */

export type ShippingPolicy = {
  /** 기본 배송비(원) */
  baseFee: number;
  /** 무료배송 기준 금액(원) — 상품 합계가 이 이상이면 배송비 0 */
  freeThreshold: number;
  /** 도서·산간 추가 배송비(원). 없으면 0 */
  remoteSurcharge?: number;
};

/** 배송비 — 무료배송 기준 충족 시 0, 아니면 기본 배송비 */
export function calcShippingFee(subtotal: number, policy: ShippingPolicy): number {
  return subtotal >= policy.freeThreshold ? 0 : policy.baseFee;
}

/**
 * 도서·산간 우편번호 구간(5자리 신주소 기준).
 *
 * 택배사 공통으로 쓰이는 대표 구간만 둔다 — 제주 전역과 주요 도서다.
 * 이 목록을 넓히는 것은 데이터 작업이라 운영자가 정한다. 지금은 코드에 두되,
 * 목록이 자주 바뀌면 site_setting으로 옮긴다(그때도 판정 함수는 이 자리에 남는다).
 */
const REMOTE_ZIPCODE_RANGES: readonly [number, number][] = [
  [63000, 63644], // 제주특별자치도 전역
  [40200, 40240], // 울릉군(독도 포함)
  [23004, 23010], // 인천 옹진군 일부(백령·대청 등)
  [22386, 22388], // 인천 중구 도서
  [46768, 46771], // 부산 강서구 가덕도 일부
  [53031, 53033], // 경남 통영 욕지·한산 일부
  [59766, 59766], // 전남 신안 흑산
];

/**
 * 도서·산간 여부. **화면과 서버가 같은 이 함수를 쓴다** —
 * 각자 판정하면 체크아웃에 보인 금액과 실제 결제액이 갈린다.
 */
export function isRemoteAreaZipcode(zipcode: string | null | undefined): boolean {
  if (!zipcode) return false;
  const digits = zipcode.replace(/[^0-9]/g, "");
  if (digits.length !== 5) return false;
  const code = Number(digits);
  return REMOTE_ZIPCODE_RANGES.some(([from, to]) => code >= from && code <= to);
}

/**
 * 주소까지 반영한 배송비.
 *
 * 도서·산간 추가비는 **무료배송이어도 붙는다** — 택배사가 실제로 그렇게 청구하고,
 * 무료배송에 묻어 보내면 그만큼이 그대로 손실이 된다.
 */
export function calcShippingFeeForAddress(
  goodsTotal: number,
  policy: ShippingPolicy,
  zipcode: string | null | undefined,
): number {
  const baseShippingFee = calcShippingFee(goodsTotal, policy);
  const surcharge = isRemoteAreaZipcode(zipcode) ? (policy.remoteSurcharge ?? 0) : 0;
  return baseShippingFee + surcharge;
}

export type CartAddonForSummary = {
  addonPrice: number;
  addonQuantity: number;
};

export type CartLineForSummary = {
  unitPrice: number;
  /** 정가(할인 전) — 없거나 판매가 이하면 할인 없음으로 본다 */
  listPrice: number | null;
  quantity: number;
  addons: CartAddonForSummary[];
  /** 품절·판매중지 라인은 주문할 수 없으므로 결제 예상 금액에서 제외한다 */
  orderable: boolean;
};

/**
 * 할인 계산의 기준가 — 정가가 없거나 판매가보다 낮으면(데이터 이상) 판매가를 쓴다.
 * 음수 할인이 화면에 뜨는 것을 원천 차단한다.
 */
export function effectiveListPrice(unitPrice: number, listPrice: number | null): number {
  return listPrice !== null && listPrice > unitPrice ? listPrice : unitPrice;
}

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
  /** 정가 합계(추가상품 제외) — 화면의 '총 상품금액' 행 */
  listTotal: number;
  /** 상품 할인(정가 합계 - 판매가 합계) — 화면의 '상품 할인' 행. 할인 없으면 0 */
  productDiscount: number;
  /** 상품 판매가 합계(추가상품 제외) — 무료배송 판정 기준 */
  goodsTotal: number;
  /** 추가상품 합계 — 화면이 별도 행으로 표시한다 */
  addonTotal: number;
  /** 주문 금액(goodsTotal + addonTotal) — orders.subtotal에 저장되는 값 */
  subtotal: number;
  shippingFee: number;
  grandTotal: number;
  /** 무료배송까지 남은 금액(원) — 0이면 무료배송 적용. 프로모션 바 표시용 */
  freeShippingRemaining: number;
};

/**
 * 무료배송 판정은 **상품 판매가 합계만** 본다(추가상품 제외) — 체크아웃·장바구니 목업의 기준.
 * 포장 같은 부가 선택으로 배송비 문턱을 넘게 하지 않는다는 정책이다.
 */
export function calcCartSummary(
  lines: CartLineForSummary[],
  policy: ShippingPolicy,
): CartSummary {
  const orderableLines = lines.filter((line) => line.orderable);

  const goodsTotal = orderableLines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  const listTotal = orderableLines.reduce(
    (sum, line) => sum + effectiveListPrice(line.unitPrice, line.listPrice) * line.quantity,
    0,
  );
  const addonTotal = orderableLines.reduce(
    (sum, line) =>
      sum +
      line.addons.reduce((addonSum, addon) => addonSum + addon.addonPrice * addon.addonQuantity, 0),
    0,
  );
  const subtotal = goodsTotal + addonTotal;

  // 주문 가능 라인이 없으면 배송 자체가 없다 — 빈 카트에 배송비를 표시하지 않는다
  const shippingFee = subtotal === 0 ? 0 : calcShippingFee(goodsTotal, policy);

  return {
    listTotal,
    productDiscount: listTotal - goodsTotal,
    goodsTotal,
    addonTotal,
    subtotal,
    shippingFee,
    grandTotal: subtotal + shippingFee,
    freeShippingRemaining: Math.max(0, policy.freeThreshold - goodsTotal),
  };
}
