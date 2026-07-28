import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";

import {
  claim,
  claimItem,
  claimStatusHistory,
  orderItem,
  orderItemAddon,
  orders,
} from "@/db/schema";
import {
  assertClaimableQuantity,
  assertOrderClaimable,
  assertReasonAllowsType,
  allowedFeeMethods,
  calcClaimAmounts,
  parseClaimReasonMeta,
  type ClaimAmountLine,
  type ClaimFeeMethod,
  type ClaimType,
} from "@/domain/claim";

import { getActiveCommonCodesWithMeta } from "./common-code.service";
import type { DatabaseClient, QueryClient } from "./db-client";
import { allocateClaimNo } from "./order-number.service";
import { serializeActor, type TransitionActor } from "./order-status.service";
import { loadShippingPolicy } from "./shipping-policy.service";

/**
 * 클레임 신청(고객) — 취소·교환·반품 접수.
 *
 * 설계 확정본: 설계_클레임도메인(claim-domain-design)_20260728.md
 * 판정은 전부 domain/claim이 하고, 여기서는 DB에서 사실을 모아 넘기고 결과를 저장한다(RULE-14).
 *
 * 이 시점에는 **돈도 재고도 건드리지 않는다** — 접수일 뿐이다.
 * 환불·복원은 관리자 처리(C3·C4)에서 일어난다.
 */

export class ClaimOrderNotFoundError extends Error {
  constructor() {
    super("주문을 찾을 수 없습니다.");
    this.name = "ClaimOrderNotFoundError";
  }
}

export class ClaimOrderAccessDeniedError extends Error {
  constructor() {
    super("이 주문에 접근할 수 없습니다.");
    this.name = "ClaimOrderAccessDeniedError";
  }
}

export class ClaimReasonUnknownError extends Error {
  constructor(readonly reasonCode: string) {
    super("알 수 없는 클레임 사유입니다. 사유를 다시 선택해 주세요.");
    this.name = "ClaimReasonUnknownError";
  }
}

export class ClaimItemNotInOrderError extends Error {
  constructor(readonly orderItemId: number) {
    super("주문에 없는 상품이 포함되어 있습니다.");
    this.name = "ClaimItemNotInOrderError";
  }
}

export class ClaimTargetEmptyError extends Error {
  constructor() {
    super("클레임할 상품을 선택해 주세요.");
    this.name = "ClaimTargetEmptyError";
  }
}

export type RequestClaimInput = {
  orderNo: string;
  claimType: ClaimType;
  reasonCode: string;
  detail?: string | null;
  photos?: string[] | null;
  /**
   * 대상 품목. 취소는 전체 주문 단위(설계 §2)라 생략하며, 생략 시 주문 전 품목 전량이 대상이다.
   * 교환·반품은 라인·수량 단위 부분 신청(D5).
   */
  targets?: { orderItemId: number; quantity: number }[];
  /** 소유 증명 — 회원은 세션, 비회원은 주문 생성 때 발급한 게스트 토큰 */
  customerId: number | null;
  guestToken: string | null;
  now?: Date;
};

export type RequestClaimResult = {
  claimId: number;
  claimNo: string;
  claimType: ClaimType;
  goodsAmount: number;
  shippingFee: number;
  refundAmount: number;
  feeMethod: ClaimFeeMethod | null;
};

/** 사유 코드 → 정책(귀책·허용 유형). 알 수 없거나 meta가 깨진 사유는 거부한다 */
async function loadReasonPolicy(client: QueryClient, reasonCode: string) {
  const reasons = await getActiveCommonCodesWithMeta(client, "claim_reason");
  const matched = reasons.find((reason) => reason.code === reasonCode);
  if (!matched) throw new ClaimReasonUnknownError(reasonCode);

  const meta = parseClaimReasonMeta(matched.meta);
  if (!meta) throw new ClaimReasonUnknownError(reasonCode);
  return { name: matched.name, meta };
}

/**
 * 같은 order_item에 이미 접수된 클레임 수량 — 반려(rejected)는 제외한다.
 * 진행 중·완료 건은 이미 그 수량을 점유하고 있으므로 다시 신청할 수 없다.
 */
async function loadActiveClaimedQuantities(
  client: QueryClient,
  orderItemIds: number[],
): Promise<Map<number, number>> {
  const claimed = new Map<number, number>();
  if (orderItemIds.length === 0) return claimed;

  const rows = await client
    .select({ orderItemId: claimItem.orderItemId, quantity: claimItem.quantity })
    .from(claimItem)
    .innerJoin(claim, eq(claimItem.claimId, claim.id))
    .where(
      and(inArray(claimItem.orderItemId, orderItemIds), ne(claim.status, "rejected")),
    );

  for (const row of rows) {
    claimed.set(row.orderItemId, (claimed.get(row.orderItemId) ?? 0) + row.quantity);
  }
  return claimed;
}

/**
 * 클레임을 접수한다.
 *
 * 주문 행을 FOR UPDATE로 잠가 같은 주문에 대한 동시 신청을 직렬화한다 —
 * 잠그지 않으면 두 요청이 같은 잔여 수량을 보고 각각 통과해 주문 수량을 초과한다.
 */
export async function requestClaim(
  database: DatabaseClient,
  input: RequestClaimInput,
): Promise<RequestClaimResult> {
  const now = input.now ?? new Date();

  return database.transaction(async (tx) => {
    const [orderRow] = await tx
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        status: orders.status,
        customerId: orders.customerId,
        guestToken: orders.guestToken,
        deliveredAt: orders.deliveredAt,
        shippingFee: orders.shippingFee,
      })
      .from(orders)
      .where(eq(orders.orderNo, input.orderNo))
      .for("update")
      .limit(1);
    if (!orderRow) throw new ClaimOrderNotFoundError();

    const isOwner =
      orderRow.customerId !== null
        ? orderRow.customerId === input.customerId
        : orderRow.guestToken !== null && orderRow.guestToken === input.guestToken;
    if (!isOwner) throw new ClaimOrderAccessDeniedError();

    // 주문 상태·기간 조건(도메인이 판정)
    assertOrderClaimable({
      claimType: input.claimType,
      orderStatus: orderRow.status,
      deliveredAt: orderRow.deliveredAt,
      now,
    });

    const reasonPolicy = await loadReasonPolicy(tx, input.reasonCode);
    assertReasonAllowsType(input.reasonCode, reasonPolicy.meta, input.claimType);

    // 주문 품목 + 라인별 추가상품 합계(추가상품은 라인 전량 클레임일 때만 금액에 포함 — D11)
    const orderItemRows = await tx
      .select({
        orderItemId: orderItem.id,
        unitPrice: orderItem.unitPrice,
        quantity: orderItem.quantity,
      })
      .from(orderItem)
      .where(eq(orderItem.orderId, orderRow.id));

    const addonRows = await tx
      .select({
        orderItemId: orderItemAddon.orderItemId,
        lineTotal: orderItemAddon.lineTotal,
      })
      .from(orderItemAddon)
      .innerJoin(orderItem, eq(orderItemAddon.orderItemId, orderItem.id))
      .where(eq(orderItem.orderId, orderRow.id));

    const addonTotalByItem = new Map<number, number>();
    for (const addonRow of addonRows) {
      addonTotalByItem.set(
        addonRow.orderItemId,
        (addonTotalByItem.get(addonRow.orderItemId) ?? 0) + addonRow.lineTotal,
      );
    }

    // 취소는 전체 주문 단위 — 대상을 받지 않고 전 품목 전량으로 고정한다(설계 §2)
    const requestedTargets =
      input.claimType === "cancel" || !input.targets || input.targets.length === 0
        ? orderItemRows.map((row) => ({ orderItemId: row.orderItemId, quantity: row.quantity }))
        : input.targets;
    if (requestedTargets.length === 0) throw new ClaimTargetEmptyError();

    const orderItemById = new Map(orderItemRows.map((row) => [row.orderItemId, row]));
    const activeClaimed = await loadActiveClaimedQuantities(
      tx,
      requestedTargets.map((target) => target.orderItemId),
    );

    const amountLines: ClaimAmountLine[] = [];
    for (const target of requestedTargets) {
      const orderItemRow = orderItemById.get(target.orderItemId);
      if (!orderItemRow) throw new ClaimItemNotInOrderError(target.orderItemId);

      // 누적 수량 불변식 — 잠금 안에서 확인하므로 동시 신청에도 초과가 생기지 않는다
      assertClaimableQuantity({
        orderedQuantity: orderItemRow.quantity,
        activeClaimedQuantity: activeClaimed.get(target.orderItemId) ?? 0,
        requestedQuantity: target.quantity,
      });

      amountLines.push({
        unitPrice: orderItemRow.unitPrice,
        claimQuantity: target.quantity,
        orderedQuantity: orderItemRow.quantity,
        addonTotal: addonTotalByItem.get(target.orderItemId) ?? 0,
      });
    }

    const shippingPolicy = await loadShippingPolicy(tx);
    const amounts = calcClaimAmounts({
      claimType: input.claimType,
      fault: reasonPolicy.meta.fault,
      baseFee: shippingPolicy.baseFee,
      orderShippingFee: orderRow.shippingFee,
      lines: amountLines,
    });

    // 배송비 수취 방법 — 유형별 허용 목록의 첫 값(반품=차감, 교환=계좌이체). 0원이면 수취할 것이 없다
    const feeMethod =
      amounts.shippingFee > 0 ? (allowedFeeMethods(input.claimType)[0] ?? null) : null;

    const claimNo = await allocateClaimNo(tx, input.claimType);
    const actor: TransitionActor =
      input.customerId === null ? { role: "system" } : { role: "customer", id: input.customerId };

    const [claimRow] = await tx
      .insert(claim)
      .values({
        claimNo,
        orderId: orderRow.id,
        type: input.claimType,
        status: "requested",
        reasonCode: input.reasonCode,
        fault: reasonPolicy.meta.fault,
        detail: input.detail?.trim() ? input.detail.trim() : null,
        photos: input.photos && input.photos.length > 0 ? input.photos : null,
        goodsAmount: amounts.goodsAmount,
        shippingFee: amounts.shippingFee,
        refundAmount: amounts.refundAmount,
        feeMethod,
      })
      .returning({ id: claim.id });

    await tx.insert(claimItem).values(
      requestedTargets.map((target) => ({
        claimId: claimRow.id,
        orderItemId: target.orderItemId,
        quantity: target.quantity,
      })),
    );

    // 접수 이력(null→requested)은 초크포인트를 거치지 않고 직접 남긴다 —
    // applyClaimTransition은 '기존 상태에서의 변경'을 다루므로 최초 진입은 여기서 기록한다
    await tx.insert(claimStatusHistory).values({
      claimId: claimRow.id,
      fromStatus: null,
      toStatus: "requested",
      actor: serializeActor(actor),
      memo: "클레임 접수",
    });

    return {
      claimId: claimRow.id,
      claimNo,
      claimType: input.claimType,
      goodsAmount: amounts.goodsAmount,
      shippingFee: amounts.shippingFee,
      refundAmount: amounts.refundAmount,
      feeMethod,
    };
  });
}
