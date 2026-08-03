/**
 * 주문 도메인 순수 규칙 — DB·부작용·프레임워크 무관.
 * 상태 전이표·금액 재계산·마스킹의 단일 진실원. 트랜잭션 서비스가 이 규칙 위에 올라간다.
 *
 * 레이어(RULE-14): 이 모듈은 무엇에도 의존하지 않는다(domain/cart 순수 계산만 재사용).
 * DB 타입(CartView 등)을 임포트하지 않는다 — 서비스가 CartLine을 아래 OrderDraftLine로 매핑해 넘긴다.
 */

import {
  calcCartSummary,
  calcShippingFeeForAddress,
  type CartLineForSummary,
  type ShippingPolicy,
} from "./cart";

// 값은 schema.ts의 orderStatus / paymentStatus enum과 일치해야 한다(order.enum-sync.test가 강제).
export type OrderStatus =
  | "pending"
  | "paid"
  | "preparing"
  | "shipping"
  | "delivered"
  | "confirmed"
  | "cancelled";

export type PaymentStatus =
  | "ready"
  | "paid"
  | "partial_cancelled"
  | "cancelled"
  | "failed";

/** 도메인이 아는 상태의 표준 목록 — schema enum과 일치해야 한다(테스트가 집합 비교로 강제) */
export const ORDER_STATUSES: readonly OrderStatus[] = [
  "pending",
  "paid",
  "preparing",
  "shipping",
  "delivered",
  "confirmed",
  "cancelled",
];
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "ready",
  "paid",
  "partial_cancelled",
  "cancelled",
  "failed",
];

/** 전이를 일으킬 수 있는 주체 — actor 규약 "admin:{id}"/"customer:{id}"/"system"의 역할 부분 */
export type TransitionActorRole = "system" | "customer" | "admin";

/** 전이에 수반되는 부작용 — 서비스가 이 목록을 보고 실제 작업(차감·환불 등)을 수행한다 */
export type OrderSideEffect =
  | "deduct_stock"
  | "restore_stock"
  | "refund"
  | "consume_cart"
  | "set_delivered_at"
  | "set_confirmed_at";

type TransitionRule = {
  from: OrderStatus;
  to: OrderStatus;
  actors: readonly TransitionActorRole[];
  sideEffects: readonly OrderSideEffect[];
};

/**
 * 허용 전이표 — 여기 없는 (from,to)는 불법. 설계 §3.1 확정본.
 * pending→cancelled은 부작용 없음(pending은 재고 무점유 — confirm-차감 모델).
 */
const TRANSITIONS: readonly TransitionRule[] = [
  { from: "pending", to: "paid", actors: ["system"], sideEffects: ["deduct_stock", "consume_cart"] },
  { from: "pending", to: "cancelled", actors: ["system", "customer"], sideEffects: [] },
  { from: "paid", to: "preparing", actors: ["admin"], sideEffects: [] },
  { from: "paid", to: "cancelled", actors: ["customer", "admin"], sideEffects: ["refund", "restore_stock"] },
  { from: "preparing", to: "shipping", actors: ["admin"], sideEffects: [] },
  { from: "preparing", to: "cancelled", actors: ["customer", "admin"], sideEffects: ["refund", "restore_stock"] },
  { from: "shipping", to: "delivered", actors: ["system", "admin"], sideEffects: ["set_delivered_at"] },
  { from: "delivered", to: "confirmed", actors: ["customer", "system"], sideEffects: ["set_confirmed_at"] },
];

const TERMINAL_STATUSES: readonly OrderStatus[] = ["confirmed", "cancelled"];

function findRule(from: OrderStatus, to: OrderStatus): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === from && rule.to === to);
}

export class IllegalOrderTransitionError extends Error {
  constructor(
    readonly fromStatus: OrderStatus,
    readonly toStatus: OrderStatus,
    readonly actorRole: TransitionActorRole,
  ) {
    super(`허용되지 않은 주문 상태 전이: ${fromStatus} → ${toStatus} (${actorRole})`);
    this.name = "IllegalOrderTransitionError";
  }
}

/** (from,to)가 해당 actor에게 허용되는가 */
export function canTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActorRole,
): boolean {
  const rule = findRule(from, to);
  return rule !== undefined && rule.actors.includes(actor);
}

export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActorRole,
): void {
  if (!canTransition(from, to, actor)) {
    throw new IllegalOrderTransitionError(from, to, actor);
  }
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 전이의 부작용 목록 — 불법 전이면 빈 배열(assertTransition으로 먼저 막는 것을 전제) */
export function sideEffectsFor(from: OrderStatus, to: OrderStatus): OrderSideEffect[] {
  return [...(findRule(from, to)?.sideEffects ?? [])];
}

/** 이 상태에서 actor가 갈 수 있는 목적지들 — 관리자/마이페이지 버튼 노출용 */
export function allowedTargets(
  from: OrderStatus,
  actor: TransitionActorRole,
): OrderStatus[] {
  return TRANSITIONS.filter(
    (rule) => rule.from === from && rule.actors.includes(actor),
  ).map((rule) => rule.to);
}

// ── 결제 상태 전이 (설계 §3.2) ──
const PAYMENT_TRANSITIONS: readonly [PaymentStatus, PaymentStatus][] = [
  ["ready", "paid"],
  ["ready", "failed"],
  ["ready", "cancelled"],
  ["paid", "partial_cancelled"],
  ["paid", "cancelled"],
];

export function canTransitionPaymentStatus(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  return PAYMENT_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

// =============================================================
// 금액 재계산 · 주문 스냅샷 (설계 §2 단계1)
// =============================================================

export type OrderDraftAddon = {
  addonId: number;
  addonName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type OrderItemSnapshot = {
  variantId: number;
  productId: number;
  productName: string;
  makerName: string | null;
  variantName: string | null;
  /** 주문 시점 정가 — 없으면 할인 없음. 상품 정가가 바뀌어도 주문은 불변(RULE-11) */
  listPrice: number | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  /** 주문 시점 대표 이미지 — 상품이 삭제돼도 주문 화면이 유지된다 */
  thumbnailPath: string | null;
  thumbnailAlt: string | null;
  addons: OrderDraftAddon[];
};

export type OrderDraft = {
  /** 정가 합계(추가상품 제외) — 화면의 '총 상품금액' */
  listTotal: number;
  /** 상품 할인(정가 - 판매가) */
  productDiscount: number;
  /** 판매가 상품 합계(추가상품 제외) */
  goodsTotal: number;
  /** 추가상품 합계 */
  addonTotal: number;
  subtotal: number;
  shippingFee: number;
  /** 쿠폰 할인 — 상품금액에서만 뺀다(배송비 제외) */
  couponDiscount: number;
  /** 적립금 사용액 — 결제할 금액을 그만큼 줄인다 */
  pointUsed: number;
  grandTotal: number;
  items: OrderItemSnapshot[];
};

/** 서비스가 CartLine에서 매핑해 넘기는 도메인 입력 — 스냅샷에 필요한 필드만 */
export type OrderDraftLine = {
  variantId: number;
  productId: number;
  productName: string;
  makerName: string | null;
  variantName: string | null;
  /** 정가(할인 전) — 주문에 복사된다 */
  listPrice: number | null;
  unitPrice: number;
  quantity: number;
  /** 대표 이미지 — 주문에 복사된다 */
  thumbnailPath: string | null;
  thumbnailAlt: string | null;
  addons: { addonId: number; addonName: string; addonPrice: number; addonQuantity: number }[];
  /** 품절·판매중지 등으로 주문 불가한 라인 */
  orderable: boolean;
};

export class BlockedOrderLineError extends Error {
  constructor(readonly blockedVariantIds: number[]) {
    super("주문할 수 없는 상품이 포함되어 있습니다. 장바구니에서 확인해 주세요.");
    this.name = "BlockedOrderLineError";
  }
}

export function partitionOrderableLines<T extends { orderable: boolean }>(
  lines: T[],
): { orderable: T[]; blocked: T[] } {
  const orderable: T[] = [];
  const blocked: T[] = [];
  for (const line of lines) (line.orderable ? orderable : blocked).push(line);
  return { orderable, blocked };
}

function addonLineTotal(addon: OrderDraftLine["addons"][number]): number {
  return addon.addonPrice * addon.addonQuantity;
}

/**
 * 카트 라인에서 주문 초안(금액·스냅샷)을 만든다. 합계는 서버 계산(RULE-11).
 * 주문 불가 라인이 하나라도 포함되면 throw — 부분 진행 금지(설계 D6).
 */
/**
 * 주문 금액 조정값 — 배송지·쿠폰·적립금.
 *
 * **위치 인자로 두지 않는다.** `buildOrderDraft(lines, policy, zip, 5000, 2000)`에서
 * 어느 쪽이 쿠폰이고 어느 쪽이 적립금인지 호출부만 봐서는 알 수 없고, 뒤바뀌어도
 * 타입이 같아 컴파일을 통과한다 — 금액이 걸린 자리에서 가장 비싼 실수다.
 */
export type OrderDraftAdjustments = {
  /** 배송지 우편번호 — 도서·산간 추가비 판정에 쓴다. 없으면 추가비 없음 */
  shippingZipcode?: string | null;
  /**
   * 쿠폰 할인액. 적용 대상·최소금액·기간 판정은 서비스가 이미 끝낸 값이 온다.
   * **상품 금액에서만 빼고 배송비에는 적용하지 않는다** — 정률 쿠폰이 배송비까지 깎으면
   * 무료배송 기준을 넘겼는지 판정이 흔들린다(설계 결정 ②).
   */
  couponDiscount?: number;
  /**
   * 적립금 사용액. 정책 검증(최소액·단위·잔액)은 서비스가 이미 끝낸 값이 온다 —
   * 도메인은 결제할 금액을 넘지 않는지만 마지막으로 확인한다.
   */
  pointUsed?: number;
};

export function buildOrderDraft(
  lines: OrderDraftLine[],
  policy: ShippingPolicy,
  adjustments: OrderDraftAdjustments = {},
): OrderDraft {
  const { shippingZipcode } = adjustments;
  const couponDiscount = adjustments.couponDiscount ?? 0;
  const pointUsed = adjustments.pointUsed ?? 0;
  if (lines.length === 0) {
    throw new BlockedOrderLineError([]);
  }
  const { blocked } = partitionOrderableLines(lines);
  if (blocked.length > 0) {
    throw new BlockedOrderLineError(blocked.map((line) => line.variantId));
  }

  const summaryLines: CartLineForSummary[] = lines.map((line) => ({
    unitPrice: line.unitPrice,
    listPrice: line.listPrice,
    quantity: line.quantity,
    addons: line.addons.map((addon) => ({
      addonPrice: addon.addonPrice,
      addonQuantity: addon.addonQuantity,
    })),
    orderable: true,
  }));
  const summary = calcCartSummary(summaryLines, policy);
  // 도서·산간 추가비는 주소가 있어야 정해진다 — 카트 요약은 주소를 모르므로 여기서 더한다.
  // 화면(체크아웃)도 같은 함수를 쓰므로 보인 금액과 결제액이 갈리지 않는다.
  const shippingFee = calcShippingFeeForAddress(summary.goodsTotal, policy, shippingZipcode);

  const items: OrderItemSnapshot[] = lines.map((line) => ({
    variantId: line.variantId,
    productId: line.productId,
    productName: line.productName,
    makerName: line.makerName,
    variantName: line.variantName,
    listPrice: line.listPrice,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    thumbnailPath: line.thumbnailPath,
    thumbnailAlt: line.thumbnailAlt,
    lineTotal:
      line.unitPrice * line.quantity +
      line.addons.reduce((sum, addon) => sum + addonLineTotal(addon), 0),
    addons: line.addons.map((addon) => ({
      addonId: addon.addonId,
      addonName: addon.addonName,
      unitPrice: addon.addonPrice,
      quantity: addon.addonQuantity,
      lineTotal: addonLineTotal(addon),
    })),
  }));

  // 쿠폰은 **상품 금액에서만** 뺀다. 상품 금액을 넘는 쿠폰은 서비스가 이미 걸렀지만,
  // 검증을 건너뛴 호출이 결제액을 음수로 만들기 전에 여기서 멈춘다
  if (couponDiscount < 0 || couponDiscount > summary.subtotal) {
    throw new OrderAmountMismatchError(summary.subtotal, couponDiscount);
  }

  // 적용 순서: 상품금액 − 쿠폰 + 배송비 − 적립금 (설계 결정 ②).
  // 순서를 바꾸면 같은 쿠폰·적립금 조합에서 결제액이 달라진다.
  // summary.grandTotal은 주소를 모르는 값이라 배송비를 다시 더한다
  const payableBeforePoint = summary.subtotal - couponDiscount + shippingFee;
  if (pointUsed < 0 || pointUsed > payableBeforePoint) {
    // 여기 걸리면 서비스 검증을 건너뛴 호출이다 — 결제액이 음수가 되기 전에 멈춘다
    throw new OrderAmountMismatchError(payableBeforePoint, pointUsed);
  }

  return {
    listTotal: summary.listTotal,
    productDiscount: summary.productDiscount,
    goodsTotal: summary.goodsTotal,
    addonTotal: summary.addonTotal,
    subtotal: summary.subtotal,
    shippingFee,
    couponDiscount,
    pointUsed,
    grandTotal: payableBeforePoint - pointUsed,
    items,
  };
}

export class OrderAmountMismatchError extends Error {
  constructor(readonly expected: number, readonly incoming: number) {
    super("결제 금액이 주문 금액과 일치하지 않습니다.");
    this.name = "OrderAmountMismatchError";
  }
}

/** 결제 승인 요청 금액이 서버 저장 grand_total과 정확히 같은지 — 위변조 차단 */
export function assertPaidAmountMatches(
  expectedGrandTotal: number,
  incomingAmount: number,
): void {
  if (expectedGrandTotal !== incomingAmount) {
    throw new OrderAmountMismatchError(expectedGrandTotal, incomingAmount);
  }
}

// =============================================================
// 마스킹 — 비회원 주문조회 PII 최소 노출
// =============================================================

/**
 * 이름 마스킹 — 첫 글자만 남긴다: 홍정성 → 홍**, 김보 → 김*, 이 → 이.
 * 끝 글자를 남기면 두 글자 이름에서 실명 추정 여지가 커져 비회원조회 목업 규칙을 따른다.
 */
export function maskOrdererName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return chars.join("");
  return `${chars[0]}${"*".repeat(chars.length - 1)}`;
}

/** 전화 뒷자리 유지, 가운데 마스킹: 010-1234-5678 → 010-****-5678 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return phone;
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  const middle = "*".repeat(digits.length - 7);
  return `${head}-${middle}-${tail}`;
}

/** 송장번호 앞 1자리·뒤 2자리만 노출: 612345678923 → 6*********23 (회원·비회원 동일 규칙) */
export function maskTrackingNo(trackingNo: string): string {
  const trimmed = trackingNo.trim();
  if (trimmed.length <= 3) return trimmed;
  return `${trimmed[0]}${"*".repeat(trimmed.length - 3)}${trimmed.slice(-2)}`;
}

/**
 * 배송지 상세주소(동·호수)만 가린다 — 주문번호+연락처 2요소만으로 열리는 조회 화면에서
 * 거주 호실까지 특정되지 않게 한다. 배송지 확인이라는 조회 목적은 그대로 달성된다.
 */
export function maskAddressDetail(addr2: string | null): string | null {
  if (!addr2) return addr2;
  const trimmed = addr2.trim();
  if (trimmed.length === 0) return trimmed;
  return "*".repeat([...trimmed].length);
}

// =============================================================
// 상태 표기 — 스토어프론트·관리자·알림톡이 같은 문구를 쓰도록 도메인이 소유한다
// =============================================================

/** 주문 상세·조회 화면의 상태 배지 문구 */
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "결제 대기",
  paid: "결제완료",
  preparing: "상품 준비중",
  shipping: "배송중",
  delivered: "배송완료",
  confirmed: "구매확정",
  cancelled: "주문취소",
};

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status];
}

/** 진행 타임라인 4단계 — 목업(결제완료·상품 준비중·배송중·배송완료) */
export const ORDER_TIMELINE_STEPS = [
  "결제완료",
  "상품 준비중",
  "배송중",
  "배송완료",
] as const;

export type OrderTimeline = {
  steps: readonly string[];
  /** 현재 단계 인덱스(0-base). 타임라인에 올릴 수 없는 상태면 null */
  currentStep: number | null;
  /** 타임라인 대신 안내 블록을 그려야 하는 상태인가 — 결제 대기·주문 취소 */
  outOfTimeline: boolean;
};

/**
 * 상태 → 타임라인 위치. pending(결제 미완료)·cancelled(취소)는 4단계 어디에도 놓을 수 없어
 * 화면이 별도 안내 블록을 그리도록 outOfTimeline으로 알린다 — 임의 배치를 막는다.
 * confirmed(구매확정)는 배송완료 이후이므로 마지막 단계에 머문다.
 */
export function orderTimelineFor(status: OrderStatus): OrderTimeline {
  const stepByStatus: Partial<Record<OrderStatus, number>> = {
    paid: 0,
    preparing: 1,
    shipping: 2,
    delivered: 3,
    confirmed: 3,
  };
  const currentStep = stepByStatus[status] ?? null;
  return {
    steps: ORDER_TIMELINE_STEPS,
    currentStep,
    outOfTimeline: currentStep === null,
  };
}
