/**
 * 클레임(취소·교환·반품) 도메인 순수 규칙 — DB·부작용·프레임워크 무관.
 * 전이표·클레임 가능 조건·금액 계산·배송비 수취·표시 라벨의 단일 진실원.
 *
 * 설계 확정본: 설계_클레임도메인(claim-domain-design)_20260728.md
 * 레이어(RULE-14): 이 모듈은 무엇에도 의존하지 않는다(order-number의 ClaimType만 재사용).
 */

import type { ClaimType } from "./order-number";

export type { ClaimType };

// 값은 schema.ts의 claimStatus/claimFault enum과 일치해야 한다(claim.enum-sync 테스트가 강제).
export type ClaimStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "collecting"
  | "inspecting"
  | "done";

export type ClaimFault = "buyer" | "seller";

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "requested",
  "approved",
  "rejected",
  "collecting",
  "inspecting",
  "done",
];
export const CLAIM_TYPES: readonly ClaimType[] = ["cancel", "exchange", "return"];
export const CLAIM_FAULTS: readonly ClaimFault[] = ["buyer", "seller"];

// =============================================================
// 상태 전이표 — 유형별로 흐름이 다르다 (설계 §3)
// =============================================================

/** 전이에 수반되는 부작용 — 서비스가 이 목록을 보고 실제 작업을 수행한다 */
export type ClaimSideEffect =
  | "refund"
  | "restore_stock"
  | "transition_order_cancelled"
  | "request_pickup"
  | "ship_replacement"
  | "deduct_replacement_stock";

type ClaimTransitionRule = {
  claimType: ClaimType;
  from: ClaimStatus;
  to: ClaimStatus;
  sideEffects: readonly ClaimSideEffect[];
};

/**
 * 허용 전이표 — 여기 없는 (유형,from,to)는 불법. 전이 주체는 전부 관리자다
 * (고객은 신청(생성)만 하고 이후 개입 지점이 없다 — 신청 철회는 1차 범위 밖).
 *
 * `approved`는 어느 행에도 없다(설계 D6-결정): 승인과 회수요청이 같은 행위라
 * 중간 상태를 두면 아무도 머물지 않는 칸이 생긴다. enum에서 지우지는 않되 전이표가 사용을 막는다.
 */
const CLAIM_TRANSITIONS: readonly ClaimTransitionRule[] = [
  // 취소 — 승인이 곧 환불이므로 requested에서 바로 종결된다
  { claimType: "cancel", from: "requested", to: "done", sideEffects: ["refund", "restore_stock", "transition_order_cancelled"] },
  { claimType: "cancel", from: "requested", to: "rejected", sideEffects: [] },

  // 반품 — 회수·검수를 거쳐야 환불(검수 전 복원 금지 — 파손품이 판매 재고로 올라간다)
  { claimType: "return", from: "requested", to: "collecting", sideEffects: ["request_pickup"] },
  { claimType: "return", from: "requested", to: "rejected", sideEffects: [] },
  { claimType: "return", from: "collecting", to: "inspecting", sideEffects: [] },
  { claimType: "return", from: "inspecting", to: "done", sideEffects: ["refund", "restore_stock"] },
  { claimType: "return", from: "inspecting", to: "rejected", sideEffects: [] },

  // 교환 — 환불 대신 교환품 발송. 회수품 복원 + 교환품 차감이 같은 시점(검수 합격)에 일어난다
  { claimType: "exchange", from: "requested", to: "collecting", sideEffects: ["request_pickup"] },
  { claimType: "exchange", from: "requested", to: "rejected", sideEffects: [] },
  { claimType: "exchange", from: "collecting", to: "inspecting", sideEffects: [] },
  { claimType: "exchange", from: "inspecting", to: "done", sideEffects: ["ship_replacement", "restore_stock", "deduct_replacement_stock"] },
  { claimType: "exchange", from: "inspecting", to: "rejected", sideEffects: [] },
];

const CLAIM_TERMINAL_STATUSES: readonly ClaimStatus[] = ["done", "rejected"];

function findClaimRule(
  claimType: ClaimType,
  from: ClaimStatus,
  to: ClaimStatus,
): ClaimTransitionRule | undefined {
  return CLAIM_TRANSITIONS.find(
    (rule) => rule.claimType === claimType && rule.from === from && rule.to === to,
  );
}

export class IllegalClaimTransitionError extends Error {
  constructor(
    readonly claimType: ClaimType,
    readonly fromStatus: ClaimStatus,
    readonly toStatus: ClaimStatus,
  ) {
    super(`허용되지 않은 클레임 상태 전이: [${claimType}] ${fromStatus} → ${toStatus}`);
    this.name = "IllegalClaimTransitionError";
  }
}

export function canClaimTransition(
  claimType: ClaimType,
  from: ClaimStatus,
  to: ClaimStatus,
): boolean {
  return findClaimRule(claimType, from, to) !== undefined;
}

export function assertClaimTransition(
  claimType: ClaimType,
  from: ClaimStatus,
  to: ClaimStatus,
): void {
  if (!canClaimTransition(claimType, from, to)) {
    throw new IllegalClaimTransitionError(claimType, from, to);
  }
}

export function isClaimTerminalStatus(status: ClaimStatus): boolean {
  return CLAIM_TERMINAL_STATUSES.includes(status);
}

/** 전이의 부작용 목록 — 불법 전이면 빈 배열(assertClaimTransition으로 먼저 막는 것을 전제) */
export function claimSideEffectsFor(
  claimType: ClaimType,
  from: ClaimStatus,
  to: ClaimStatus,
): ClaimSideEffect[] {
  return [...(findClaimRule(claimType, from, to)?.sideEffects ?? [])];
}

/** 반려는 고객에게 안내되므로 사유가 필수다(설계 D8 — claim_status_history.memo에 저장) */
export function requiresTransitionMemo(to: ClaimStatus): boolean {
  return to === "rejected";
}

// =============================================================
// 클레임 가능 조건 (설계 §2 · D7)
// =============================================================

/** 반품·교환 신청 기한 — 배송완료 시각 기준. 전자상거래법 청약철회 기간·FAQ 문구와 정합 */
export const CLAIM_WINDOW_DAYS = 7;
const CLAIM_WINDOW_MS = CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * 자동 구매확정 기한 — 배송완료 시각 기준. 클레임 기한 **다음 날**이다.
 *
 * 확정 배치가 여기 사는 이유는 이 값의 근거가 클레임 기한이기 때문이다. 따로 8을 적어두면
 * 클레임 기한을 바꿀 때 한쪽만 바뀌어, 클레임 기간 중에 자동확정이 나거나(확정된 주문에
 * 반품 신청이 들어오는 경합) 확정이 며칠씩 늦어 적립이 밀린다. 파생시켜 두면 갈라질 수 없다.
 */
export const AUTO_CONFIRM_DAYS = CLAIM_WINDOW_DAYS + 1;

/** 주문 상태 — order 도메인과 결합하지 않기 위해 문자열 리터럴만 공유한다 */
export type ClaimableOrderStatus =
  | "pending"
  | "paid"
  | "preparing"
  | "shipping"
  | "delivered"
  | "confirmed"
  | "cancelled";

export class OrderNotClaimableError extends Error {
  constructor(
    readonly claimType: ClaimType,
    readonly orderStatus: ClaimableOrderStatus,
  ) {
    super(
      claimType === "cancel"
        ? "취소할 수 없는 주문 상태입니다. 배송이 시작된 주문은 반품으로 신청해 주세요."
        : "반품·교환은 배송 완료 후 신청할 수 있어요.",
    );
    this.name = "OrderNotClaimableError";
  }
}

export class ClaimWindowExpiredError extends Error {
  constructor() {
    super(`반품·교환 신청 기간(배송완료 후 ${CLAIM_WINDOW_DAYS}일)이 지났습니다. 고객센터로 문의해 주세요.`);
    this.name = "ClaimWindowExpiredError";
  }
}

/**
 * 이 주문에 이 유형의 클레임을 신청할 수 있는가.
 * 취소: paid·preparing(배송 전). 반품·교환: delivered + 7일 이내.
 * shipping 중에는 어느 것도 불가 — 취소하기엔 출고됐고, 반품하기엔 아직 못 받았다.
 */
export function assertOrderClaimable(input: {
  claimType: ClaimType;
  orderStatus: ClaimableOrderStatus;
  deliveredAt: Date | null;
  now: Date;
}): void {
  const { claimType, orderStatus, deliveredAt, now } = input;

  if (claimType === "cancel") {
    if (orderStatus !== "paid" && orderStatus !== "preparing") {
      throw new OrderNotClaimableError(claimType, orderStatus);
    }
    return;
  }

  if (orderStatus !== "delivered") {
    throw new OrderNotClaimableError(claimType, orderStatus);
  }
  // delivered인데 delivered_at이 없으면 데이터 이상 — 기한 판정 불가이므로 막지 않고 허용하면
  // 무기한 반품이 된다. 보수적으로 거부한다(운영이 delivered_at을 채운 뒤 처리).
  if (deliveredAt === null) {
    throw new ClaimWindowExpiredError();
  }
  if (now.getTime() - deliveredAt.getTime() > CLAIM_WINDOW_MS) {
    throw new ClaimWindowExpiredError();
  }
}

/**
 * 지금 신청할 수 있는 클레임 유형 — 화면의 버튼 노출 판정용.
 *
 * assertOrderClaimable과 **같은 규칙**을 쓴다(내부에서 호출). 화면이 자체 조건을 두면
 * 서버와 어긋나 "버튼은 보이는데 눌렀더니 거부"가 된다. 서버가 목록으로 내려주고
 * 화면은 그대로 그린다.
 */
export function availableClaimTypes(input: {
  orderStatus: ClaimableOrderStatus;
  deliveredAt: Date | null;
  now: Date;
}): ClaimType[] {
  return CLAIM_TYPES.filter((claimType) => {
    try {
      assertOrderClaimable({ ...input, claimType });
      return true;
    } catch {
      return false;
    }
  });
}

// =============================================================
// 수량 불변식 (설계 §4 불변식 3 · D5)
// =============================================================

export class ClaimQuantityExceededError extends Error {
  constructor(
    readonly orderedQuantity: number,
    readonly activeClaimedQuantity: number,
    readonly requestedQuantity: number,
  ) {
    super("신청 수량이 주문 수량을 초과합니다. 이미 접수된 클레임을 확인해 주세요.");
    this.name = "ClaimQuantityExceededError";
  }
}

/**
 * 같은 order_item에 대한 누적 클레임 수량 ≤ 주문 수량.
 * activeClaimedQuantity = rejected를 제외한 기존 클레임(진행 중 + 완료)의 수량 합 —
 * 완료(done)도 이미 반품된 것이므로 다시 신청할 수 없다.
 */
export function assertClaimableQuantity(input: {
  orderedQuantity: number;
  activeClaimedQuantity: number;
  requestedQuantity: number;
}): void {
  const { orderedQuantity, activeClaimedQuantity, requestedQuantity } = input;
  if (
    !Number.isInteger(requestedQuantity) ||
    requestedQuantity < 1 ||
    activeClaimedQuantity + requestedQuantity > orderedQuantity
  ) {
    throw new ClaimQuantityExceededError(orderedQuantity, activeClaimedQuantity, requestedQuantity);
  }
}

// =============================================================
// 사유 → 귀책·허용 유형 (common_code(claim_reason).meta가 원천)
// =============================================================

export type ClaimReasonMeta = {
  fault: ClaimFault;
  claimTypes: ClaimType[];
};

/** 시드 meta(JSONB)를 검증해 꺼낸다 — 형태가 어긋나면 null(서비스가 해당 사유를 거부) */
export function parseClaimReasonMeta(rawMeta: unknown): ClaimReasonMeta | null {
  if (rawMeta === null || typeof rawMeta !== "object") return null;
  const candidate = rawMeta as { fault?: unknown; claimTypes?: unknown };
  if (candidate.fault !== "buyer" && candidate.fault !== "seller") return null;
  if (!Array.isArray(candidate.claimTypes)) return null;
  const claimTypes = candidate.claimTypes.filter(
    (value): value is ClaimType =>
      value === "cancel" || value === "exchange" || value === "return",
  );
  if (claimTypes.length === 0) return null;
  return { fault: candidate.fault, claimTypes };
}

export class ClaimReasonNotAllowedError extends Error {
  constructor(readonly reasonCode: string, readonly claimType: ClaimType) {
    super("이 사유로는 해당 유형의 클레임을 신청할 수 없습니다. 사유를 다시 선택해 주세요.");
    this.name = "ClaimReasonNotAllowedError";
  }
}

/** 사유가 이 클레임 유형에 허용되는가 — 화면·서버가 같은 판정을 쓴다(정책은 시드에 있다) */
export function assertReasonAllowsType(
  reasonCode: string,
  reasonMeta: ClaimReasonMeta,
  claimType: ClaimType,
): void {
  if (!reasonMeta.claimTypes.includes(claimType)) {
    throw new ClaimReasonNotAllowedError(reasonCode, claimType);
  }
}

// =============================================================
// 금액 계산 (설계 §4 · D2 — 상수 금지, 기본 배송비 × 배수)
// =============================================================

/** 클레임 배송비 배수 — 취소 0 · 반품 편도 1 · 교환 왕복 2 (D2: 6,000 = baseFee 3,000 × 2) */
export function claimShippingFeeMultiplier(claimType: ClaimType): number {
  return claimType === "cancel" ? 0 : claimType === "return" ? 1 : 2;
}

/** 판매자 귀책이면 0 — 귀책이 배송비 부담 주체를 결정한다(시드 claim_reason.meta.fault) */
export function calcClaimShippingFee(input: {
  claimType: ClaimType;
  fault: ClaimFault;
  baseFee: number;
}): number {
  if (input.fault === "seller") return 0;
  return input.baseFee * claimShippingFeeMultiplier(input.claimType);
}

export type ClaimAmountLine = {
  unitPrice: number;
  claimQuantity: number;
  orderedQuantity: number;
  /** 이 라인의 추가상품 합계 — 라인 **전량** 클레임일 때만 환불·복원에 포함(D11) */
  addonTotal: number;
};

export type ClaimAmounts = {
  /** 클레임 대상 상품금액(추가상품 포함 규칙 적용 후) */
  goodsAmount: number;
  /** 고객 부담 클레임 배송비 */
  shippingFee: number;
  /** 환불액 — 교환은 0(배송비는 별도 수취) */
  refundAmount: number;
};

/**
 * 클레임 금액 3종을 계산한다. 전부 원 단위 정수(RULE-11).
 *
 * - 취소: 상품 전액 + 주문 배송비 − **쿠폰·적립금 사용분**. 취소는 전 품목 전량이므로
 *   환불액이 곧 실결제액(grand_total)이다 — 쿠폰·적립금을 빼지 않으면 카드 결제액보다
 *   큰 환불을 시도해 잔액 불변식에 막힌다(돈이 안 나가는 게 아니라 **환불 자체가 실패**한다).
 *   쿠폰·적립금 원본은 주문 취소 초크포인트가 복원하므로 여기서는 금액만 맞춘다.
 * - 반품: 상품금액 − 클레임 배송비. 음수면 0으로 절단하고 차액은 청구하지 않는다(불변식 2).
 *   쿠폰·적립금 몫은 여기서 빼지 않는다 — 부분 반품의 비례 차감은 환불 실행 시점에
 *   원장(과거 클레임 누적)을 보고 정한다(claim-refund가 수행).
 * - 교환: 환불 0 — 배송비는 fee_method로 별도 수취
 * - 추가상품은 라인 전량 클레임일 때만 포함(D11) — 부분 수량 비례 배분은 재고 복원
 *   수량이 소수가 되어 불가능하다
 */
export function calcClaimAmounts(input: {
  claimType: ClaimType;
  fault: ClaimFault;
  baseFee: number;
  /** 원 주문의 배송비(orders.shipping_fee) — 취소 환불에만 포함 */
  orderShippingFee: number;
  /** 주문의 쿠폰 할인(orders.coupon_discount) — 취소 환불액에서 빠진다 */
  orderCouponDiscount: number;
  /** 주문의 적립금 사용액(orders.point_used) — 취소 환불액에서 빠진다(원본은 초크포인트가 복원) */
  orderPointUsed: number;
  lines: ClaimAmountLine[];
}): ClaimAmounts {
  for (const line of input.lines) {
    assertClaimableQuantity({
      orderedQuantity: line.orderedQuantity,
      activeClaimedQuantity: 0,
      requestedQuantity: line.claimQuantity,
    });
  }

  const goodsAmount = input.lines.reduce((sum, line) => {
    const fullLine = line.claimQuantity === line.orderedQuantity;
    return sum + line.unitPrice * line.claimQuantity + (fullLine ? line.addonTotal : 0);
  }, 0);

  const shippingFee = calcClaimShippingFee(input);

  const refundAmount =
    input.claimType === "cancel"
      ? Math.max(
          0,
          goodsAmount +
            input.orderShippingFee -
            input.orderCouponDiscount -
            input.orderPointUsed,
        )
      : input.claimType === "return"
        ? Math.max(0, goodsAmount - shippingFee)
        : 0;

  return { goodsAmount, shippingFee, refundAmount };
}

// =============================================================
// 배송비 수취 (D3-확장 · fee_method)
// =============================================================

// 값은 DB CHECK(영문 소문자)와 규약을 공유한다. card는 2차 — 타입에는 있으나 1차 선택지에서 제외.
export type ClaimFeeMethod = "deduct_refund" | "bank_transfer" | "card";

/**
 * 유형별 선택 가능한 수취 방법 (설계 D3-범위).
 * 반품 = 차감 고정(A안 — 자동이라 운영 개입 0), 교환 = 계좌이체(1차).
 * B안(반품도 선택)·card 추가는 이 목록만 열면 된다 — 스키마·전이 로직은 이미 지원한다.
 */
export function allowedFeeMethods(claimType: ClaimType): ClaimFeeMethod[] {
  if (claimType === "cancel") return [];
  if (claimType === "return") return ["deduct_refund"];
  return ["bank_transfer"];
}

/** 배송비 수취가 끝났는가 — 0원이면 수취할 것이 없으므로 완료로 본다 */
export function isClaimFeeSettled(input: {
  shippingFee: number;
  feeSettledAt: Date | null;
}): boolean {
  return input.shippingFee === 0 || input.feeSettledAt !== null;
}

export class ClaimFeeUnsettledError extends Error {
  constructor() {
    super("교환 배송비 입금이 확인되지 않았습니다. 입금 확인 후 발송할 수 있어요.");
    this.name = "ClaimFeeUnsettledError";
  }
}

/**
 * 교환품 발송 게이트(설계 §1.3) — 배송비를 못 받은 채 상품이 나가는 일을 구조로 막는다.
 * 서비스가 inspecting→done 전이 직전에 호출한다. 교환 외 유형은 게이트가 없다.
 */
export function assertExchangeFeeSettled(input: {
  claimType: ClaimType;
  shippingFee: number;
  feeSettledAt: Date | null;
}): void {
  if (input.claimType !== "exchange") return;
  if (!isClaimFeeSettled(input)) {
    throw new ClaimFeeUnsettledError();
  }
}

// =============================================================
// 환불 실행 채널 (D10) — 결정과 실행의 분리
// =============================================================

/**
 * pg_api: 토스 API 부분취소(자동) / pg_console: PG 관리자 수동 환불 후 기록 /
 * bank_transfer: 계좌 송금 환불 후 기록. 어느 채널이든 payment_cancellation 한 원장에 남는다.
 */
export type RefundChannel = "pg_api" | "pg_console" | "bank_transfer";

export const MANUAL_REFUND_CHANNELS: readonly RefundChannel[] = ["pg_console", "bank_transfer"];

export class ManualRefundReferenceRequiredError extends Error {
  constructor() {
    super("외부 환불 완료 처리는 참조 정보(취소번호·이체 메모)가 필요합니다.");
    this.name = "ManualRefundReferenceRequiredError";
  }
}

/** 수동 채널은 시스템이 검증할 수 없다 — 참조(콘솔 취소번호·이체 확인)를 강제해 감사 근거를 남긴다 */
export function assertManualRefundReference(
  channel: RefundChannel,
  reference: string | null | undefined,
): void {
  if (channel === "pg_api") return;
  if (!reference || reference.trim().length === 0) {
    throw new ManualRefundReferenceRequiredError();
  }
}

// =============================================================
// 관리자 행동 목록 — 화면이 버튼을 임의로 그리지 않게 한다
// =============================================================

/** 관리자가 클레임에 할 수 있는 행동. 각각 서비스 함수 하나에 대응한다 */
export type ClaimAction =
  | "approve"
  | "reject"
  | "markCollected"
  | "refund"
  | "completeExchange"
  | "settleFee";

export type ClaimActionOption = {
  action: ClaimAction;
  label: string;
  /** 되돌릴 수 없고 고객에게 통보되는 행동 — 화면이 경고 색·확인 모달을 붙인다 */
  destructive: boolean;
};

/**
 * 지금 가능한 행동 목록. **전이표에서 유도**한다 — 행동 목록을 따로 적으면
 * 전이표와 어긋나서 "눌러야 거부당하는 것을 아는 버튼"이 생긴다.
 *
 * settleFee만 전이가 아니다(배송비는 상태와 별개 축) — 계좌이체 수취인데
 * 아직 입금 확인 전일 때만 나온다.
 */
export function availableClaimActions(input: {
  claimType: ClaimType;
  status: ClaimStatus;
  feeMethod: ClaimFeeMethod | null;
  shippingFee: number;
  feeSettledAt: Date | null;
}): ClaimActionOption[] {
  const { claimType, status } = input;
  const actions: ClaimActionOption[] = [];

  if (canClaimTransition(claimType, status, "done")) {
    actions.push(
      claimType === "exchange"
        ? { action: "completeExchange", label: "검수 완료 · 교환품 발송", destructive: false }
        : {
            action: "refund",
            // 취소는 승인이 곧 환불이라 '검수' 단계를 거치지 않는다
            label: claimType === "cancel" ? "승인 · 환불 진행" : "검수 완료 · 환불 진행",
            destructive: false,
          },
    );
  }
  if (canClaimTransition(claimType, status, "collecting")) {
    actions.push({ action: "approve", label: "승인 · 회수 요청", destructive: false });
  }
  if (canClaimTransition(claimType, status, "inspecting")) {
    actions.push({ action: "markCollected", label: "회수 완료 처리", destructive: false });
  }
  if (canClaimTransition(claimType, status, "rejected")) {
    actions.push({ action: "reject", label: "반려", destructive: true });
  }

  // 입금 확인은 종결 전까지 언제든 — 상태를 기다리게 하면 교환품 발송이 막힌다
  if (
    input.feeMethod === "bank_transfer" &&
    input.shippingFee > 0 &&
    !isClaimFeeSettled({ shippingFee: input.shippingFee, feeSettledAt: input.feeSettledAt }) &&
    !isClaimTerminalStatus(status)
  ) {
    actions.push({ action: "settleFee", label: "배송비 입금 확인", destructive: false });
  }

  return actions;
}

// =============================================================
// 표시 라벨·타임라인 — 스토어프론트·관리자·알림톡이 같은 표기를 쓴다
// =============================================================

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  cancel: "취소",
  return: "반품",
  exchange: "교환",
};

export function claimTypeLabel(claimType: ClaimType): string {
  return CLAIM_TYPE_LABELS[claimType];
}

// 관리자 목업 STATUS_META 문구를 정본으로 삼는다(고객 화면에는 상태 라벨이 명시돼 있지 않았다)
const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  requested: "승인 대기",
  approved: "승인됨", // 전이표가 사용을 막지만 라벨은 enum 전체를 덮는다(드리프트 방지 테스트)
  collecting: "회수 중",
  inspecting: "검수 중",
  done: "처리 완료",
  rejected: "반려",
};

export function claimStatusLabel(status: ClaimStatus): string {
  return CLAIM_STATUS_LABELS[status];
}

export type ClaimTimeline = {
  steps: readonly string[];
  /** 현재 단계 인덱스(0-base). 타임라인에 올릴 수 없는 상태(반려)는 null */
  currentStep: number | null;
  outOfTimeline: boolean;
};

/** 유형별 단계 라벨(관리자 목업 flow 정본) — 취소는 회수·검수가 없다 */
export function claimTimelineFor(claimType: ClaimType, status: ClaimStatus): ClaimTimeline {
  const steps: readonly string[] =
    claimType === "cancel"
      ? ["접수", "환불 완료"]
      : claimType === "return"
        ? ["접수", "회수", "검수", "환불"]
        : ["접수", "회수", "검수", "재발송"];

  const stepByStatus: Partial<Record<ClaimStatus, number>> =
    claimType === "cancel"
      ? { requested: 0, done: 1 }
      : { requested: 0, collecting: 1, inspecting: 2, done: 3 };

  const currentStep = stepByStatus[status] ?? null;
  return { steps, currentStep, outOfTimeline: currentStep === null };
}
