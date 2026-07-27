/**
 * 주문 도메인 순수 규칙 — DB·부작용·프레임워크 무관.
 * 상태 전이표·금액 재계산·마스킹의 단일 진실원. 트랜잭션 서비스가 이 규칙 위에 올라간다.
 *
 * 레이어(RULE-14): 이 모듈은 무엇에도 의존하지 않는다(domain/cart 순수 계산만 재사용).
 * DB 타입(CartView 등)을 임포트하지 않는다 — 서비스가 CartLine을 아래 OrderDraftLine로 매핑해 넘긴다.
 */

import {
  calcCartSummary,
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
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  addons: OrderDraftAddon[];
};

export type OrderDraft = {
  subtotal: number;
  shippingFee: number;
  couponDiscount: 0; // [2차] — 1차는 항상 0
  pointUsed: 0; // [2차]
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
  unitPrice: number;
  quantity: number;
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
export function buildOrderDraft(
  lines: OrderDraftLine[],
  policy: ShippingPolicy,
): OrderDraft {
  if (lines.length === 0) {
    throw new BlockedOrderLineError([]);
  }
  const { blocked } = partitionOrderableLines(lines);
  if (blocked.length > 0) {
    throw new BlockedOrderLineError(blocked.map((line) => line.variantId));
  }

  const summaryLines: CartLineForSummary[] = lines.map((line) => ({
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    addons: line.addons.map((addon) => ({
      addonPrice: addon.addonPrice,
      addonQuantity: addon.addonQuantity,
    })),
    orderable: true,
  }));
  const summary = calcCartSummary(summaryLines, policy);

  const items: OrderItemSnapshot[] = lines.map((line) => ({
    variantId: line.variantId,
    productId: line.productId,
    productName: line.productName,
    makerName: line.makerName,
    variantName: line.variantName,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
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

  return {
    subtotal: summary.subtotal,
    shippingFee: summary.shippingFee,
    couponDiscount: 0,
    pointUsed: 0,
    grandTotal: summary.grandTotal,
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

/** 이름 가운데 마스킹: 홍정성 → 홍*성, 김보 → 김*, 이 → 이 */
export function maskOrdererName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return chars.join("");
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
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
