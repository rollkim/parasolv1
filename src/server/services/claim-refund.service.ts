import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { claim, orders, payment, paymentCancellation } from "@/db/schema";
import {
  assertManualRefundReference,
  type ClaimType,
  type RefundChannel,
} from "@/domain/claim";

import { applyClaimTransition } from "./claim-status.service";
import { buildClaimStockTargets } from "./claim-process.service";
import type { DatabaseClient, TransactionClient } from "./db-client";
import { restoreStock } from "./inventory.service";
import type { PaymentGateway } from "../payments/payment-gateway";
import { settleClaimCoupon, computeClaimCouponDeduction } from "./claim-coupon.service";
import { computeClaimPointSettlement, settleClaimPoints } from "./claim-point.service";
import { applyOrderTransition, serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 클레임 환불 — 취소 승인과 반품 검수완료.
 *
 * 설계 확정본 §6: **"환불하기로 결정"과 "환불이 실행됨"을 분리한다.**
 * PG API 환불이 항상 되는 게 아니다(매입취소 기간 경과·부분취소 불가 수단·PG 장애).
 * 실무는 PG 콘솔에서 수동 환불하거나 계좌로 송금한 뒤 사이트에 완료만 기록한다.
 *
 * 채널이 셋이지만 **종결 트랜잭션은 하나**다 — 게이트웨이 호출 여부만 다르고
 * 기록·전이·재고·주문은 완전히 같은 경로를 지난다. 갈라지면 반드시 어긋난다.
 */

export class ClaimRefundNotFoundError extends Error {
  constructor(readonly claimId: number) {
    super(`클레임을 찾을 수 없습니다: id=${claimId}`);
    this.name = "ClaimRefundNotFoundError";
  }
}

export class ClaimNotRefundableError extends Error {
  constructor(readonly claimType: ClaimType, readonly status: string) {
    super(
      claimType === "exchange"
        ? "교환은 환불 대상이 아닙니다. 배송비는 입금 확인으로 처리합니다."
        : "지금 환불할 수 있는 단계가 아닙니다.",
    );
    this.name = "ClaimNotRefundableError";
  }
}

export class ClaimPaymentMissingError extends Error {
  constructor(readonly claimId: number) {
    super("환불할 결제 건을 찾을 수 없습니다. 결제 상태를 확인해 주세요.");
    this.name = "ClaimPaymentMissingError";
  }
}

/** 이미 환불한 금액을 또 환불할 수 없다 — 채널이 달라도 원장 하나로 합산해 막는다 */
export class ClaimRefundExceedsBalanceError extends Error {
  constructor(readonly requested: number, readonly refundableBalance: number) {
    super("환불 가능 잔액을 초과했습니다. 이미 처리된 환불이 있는지 확인해 주세요.");
    this.name = "ClaimRefundExceedsBalanceError";
  }
}

export type RefundClaimInput = {
  claimId: number;
  actor: TransitionActor;
  /** 기본은 pg_api. API가 거절되면 관리자가 외부에서 환불한 뒤 수동 채널로 기록한다 */
  refundChannel?: RefundChannel;
  /** 수동 채널 필수 — PG 콘솔 취소번호·이체 확인 메모. 시스템이 검증할 수 없는 지점의 근거 */
  refundReference?: string | null;
  /**
   * 회수품을 판매 재고로 되돌릴 수 있는가(반품 전용). 취소는 배송 전이라 항상 복원한다.
   * 오배송처럼 판매자 귀책이어도 멀쩡한 상품은 재입고 대상이라 귀책으로 유추할 수 없다.
   */
  restockable?: boolean;
  memo?: string | null;
};

export type RefundClaimResult = {
  claimId: number;
  claimNo: string;
  refundedAmount: number;
  refundChannel: RefundChannel;
  /** 환불 후 남은 환불 가능 잔액 */
  remainingBalance: number;
  /** 반품 정산 — 카드 대신 적립금으로 돌아간 몫(취소는 0, 초크포인트가 전액 복원) */
  pointRestored: number;
  /** 반품 정산 — 쿠폰 할인이라 환불에서 차감된 몫 */
  couponDeducted: number;
  orderCancelled: boolean;
};

/** 클레임 + 원주문 + 본결제(claim_id IS NULL)를 한 번에 */
async function loadRefundContext(client: TransactionClient | DatabaseClient, claimId: number) {
  const [row] = await client
    .select({
      claimNo: claim.claimNo,
      claimType: claim.type,
      claimStatus: claim.status,
      refundAmount: claim.refundAmount,
      shippingFee: claim.shippingFee,
      feeMethod: claim.feeMethod,
      feeSettledAt: claim.feeSettledAt,
      refundBankCode: claim.refundBankCode,
      refundAccountNumber: claim.refundAccountNumber,
      refundAccountHolder: claim.refundAccountHolder,
      orderId: claim.orderId,
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      paymentId: payment.id,
      paymentKey: payment.paymentKey,
      paymentAmount: payment.amount,
    })
    .from(claim)
    .innerJoin(orders, eq(claim.orderId, orders.id))
    // 환불 가능한 결제 상태는 paid와 partial_cancelled 둘 다다 —
    // 첫 부분 환불이 상태를 partial_cancelled로 바꾸므로, paid만 찾으면 두 번째 클레임의
    // 환불에서 결제 건을 못 찾아 부분 반품이 한 번밖에 안 된다.
    .leftJoin(
      payment,
      and(
        eq(payment.orderId, claim.orderId),
        inArray(payment.status, ["paid", "partial_cancelled"]),
        isNull(payment.claimId),
      ),
    )
    .where(eq(claim.id, claimId))
    .limit(1);
  if (!row) throw new ClaimRefundNotFoundError(claimId);
  return row;
}

/** 미환불 잔액 = 결제액 − 채널 무관 취소 원장 합계 */
async function readRefundableBalance(
  client: TransactionClient | DatabaseClient,
  paymentId: number,
  paymentAmount: number,
): Promise<number> {
  const [row] = await client
    .select({ cancelled: sql<number>`coalesce(sum(${paymentCancellation.amount}), 0)::int` })
    .from(paymentCancellation)
    .where(eq(paymentCancellation.paymentId, paymentId));
  return paymentAmount - (row?.cancelled ?? 0);
}

/**
 * 환불을 실행하고 클레임을 종결한다.
 *
 * ① 사전검증(트랜잭션 밖) — 유형·상태·잔액. 외부 호출 전에 거를 수 있는 것은 전부 거른다
 * ② 환불 실행 — pg_api만 게이트웨이를 부른다. 수동 채널은 관리자가 이미 밖에서 끝냈다
 * ③ 확정 트랜잭션 — 원장 기록 + 종결 전이 + 재고 복원 + (취소면) 주문 취소
 *
 * ③이 실패하면 돈은 이미 나갔다. 되돌리지 않고 클레임을 미종결로 남긴다 —
 * '환불 원장 없음 + 클레임 미종결'이 대사 대상 표식이다(주문 도메인과 같은 판단).
 */
export async function refundClaim(
  database: DatabaseClient,
  gateway: PaymentGateway,
  input: RefundClaimInput,
): Promise<RefundClaimResult> {
  const refundChannel: RefundChannel = input.refundChannel ?? "pg_api";
  assertManualRefundReference(refundChannel, input.refundReference);

  // ── ① 사전검증
  const context = await loadRefundContext(database, input.claimId);
  const claimType = context.claimType as ClaimType;

  if (claimType === "exchange") {
    throw new ClaimNotRefundableError(claimType, context.claimStatus);
  }
  // 취소는 접수 직후 승인=환불, 반품은 검수 완료 시점에만 환불한다(설계 §3)
  const expectedStatus = claimType === "cancel" ? "requested" : "inspecting";
  if (context.claimStatus !== expectedStatus) {
    throw new ClaimNotRefundableError(claimType, context.claimStatus);
  }
  if (context.paymentId === null || context.paymentKey === null) {
    throw new ClaimPaymentMissingError(input.claimId);
  }

  /* 카드로 나갈 금액을 확정한다 — PG 호출 전에 끝나야 한다.
     반품의 환불액 스냅샷(goods − 배송비)은 상품 기준이라, 결제수단별 몫을 빼야 카드 환불액이 된다:
      - 적립금 복원 몫: 복원은 적립금으로 돌아가므로 카드로 또 주면 **이중 지급**이다
      - 쿠폰 차감 몫: 할인받았던 금액이라 아무도 돌려받지 않는다(설계 결정 ④)
     취소는 스냅샷이 이미 실결제액(쿠폰·적립금 차감 후)이라 그대로 쓴다 — 원본 복원은 초크포인트 몫.
     기록(settle)도 같은 계산을 재수행하므로 두 값이 갈리지 않는다. */
  let plannedPointRestore = 0;
  let plannedCouponDeduction = 0;
  if (claimType === "return") {
    const pointPlan = await computeClaimPointSettlement(database, {
      claimId: input.claimId,
      orderId: context.orderId,
    });
    plannedPointRestore = pointPlan.restoreAmount;
    plannedCouponDeduction = await computeClaimCouponDeduction(database, {
      claimId: input.claimId,
      orderId: context.orderId,
    });
  }
  const refundAmount = Math.max(
    0,
    context.refundAmount - plannedPointRestore - plannedCouponDeduction,
  );

  const balanceBefore = await readRefundableBalance(
    database,
    context.paymentId,
    context.paymentAmount ?? 0,
  );
  if (refundAmount > balanceBefore) {
    throw new ClaimRefundExceedsBalanceError(refundAmount, balanceBefore);
  }

  // ── ② 환불 실행 — 수동 채널은 관리자가 외부에서 이미 완료했다
  let gatewayRaw: unknown = {
    manual: true,
    refundChannel,
    reference: input.refundReference ?? null,
    actor: serializeActor(input.actor),
  };
  if (refundChannel === "pg_api" && refundAmount > 0) {
    // 가상계좌 결제는 이 값이 없으면 토스가 취소 API 자체를 거부한다(접수 시점에
    // claim.service가 필수로 받아 저장해 뒀다 — 여기서는 있으면 그대로 실어 보낼 뿐이다).
    const refundReceiveAccount =
      context.refundBankCode && context.refundAccountNumber && context.refundAccountHolder
        ? {
            bank: context.refundBankCode,
            accountNumber: context.refundAccountNumber,
            holderName: context.refundAccountHolder,
          }
        : undefined;
    const cancelResult = await gateway.cancel({
      paymentKey: context.paymentKey,
      cancelReason: input.memo?.trim() ? input.memo.trim() : `클레임 ${context.claimNo}`,
      cancelAmount: refundAmount,
      refundReceiveAccount,
    });
    gatewayRaw = cancelResult.raw;
  }

  // ── ③ 확정 트랜잭션 — 채널과 무관하게 완전히 같은 경로
  const paymentId = context.paymentId;
  const paymentKey = context.paymentKey;
  const shouldRestock = claimType === "cancel" ? true : (input.restockable ?? true);

  return database.transaction(async (tx) => {
    const finalized = await finalizeClaimRefund(tx, {
      claimId: input.claimId,
      claimNo: context.claimNo,
      claimType,
      orderId: context.orderId,
      orderStatus: context.orderStatus,
      paymentId,
      paymentKey,
      paymentAmount: context.paymentAmount ?? 0,
      refundAmount,
      refundChannel,
      gatewayRaw,
      shouldRestock,
      actor: input.actor,
      memo: input.memo ?? null,
    });

    return {
      claimId: input.claimId,
      claimNo: context.claimNo,
      refundedAmount: refundAmount,
      refundChannel,
      remainingBalance: balanceBefore - refundAmount,
      pointRestored: plannedPointRestore,
      couponDeducted: plannedCouponDeduction,
      orderCancelled: finalized.orderCancelled,
    };
  });
}

async function finalizeClaimRefund(
  tx: TransactionClient,
  args: {
    claimId: number;
    claimNo: string;
    claimType: ClaimType;
    orderId: number;
    orderStatus: string;
    paymentId: number;
    paymentKey: string;
    paymentAmount: number;
    refundAmount: number;
    refundChannel: RefundChannel;
    gatewayRaw: unknown;
    shouldRestock: boolean;
    actor: TransitionActor;
    memo: string | null;
  },
): Promise<{ orderCancelled: boolean }> {
  const actorText = serializeActor(args.actor);

  // 환불 원장 — 채널을 남겨야 정산 대사에서 "누가 어디서 환불했는지"가 드러난다
  if (args.refundAmount > 0) {
    await tx.insert(paymentCancellation).values({
      paymentId: args.paymentId,
      claimId: args.claimId,
      amount: args.refundAmount,
      refundChannel: args.refundChannel,
      reason: args.memo ?? `클레임 ${args.claimNo}`,
      raw: args.gatewayRaw,
      createdBy: actorText,
    });
  }

  // 재고 복원 — 취소는 배송 전이라 항상, 반품은 검수 판단에 따른다
  if (args.shouldRestock) {
    const targets = await buildClaimStockTargets(tx, args.claimId);
    if (targets.length > 0) {
      await restoreStock(tx, {
        targets,
        refId: args.claimNo,
        reason: args.claimType === "cancel" ? "cancel_restock" : "claim_restock",
        actor: actorText,
      });
    }
  }

  // 반품 배송비는 환불액에서 이미 차감됐다 — 이 시점이 곧 수취 완료다(설계 §1.3)
  await tx
    .update(claim)
    .set({ feeSettledAt: sql`now()` })
    .where(and(eq(claim.id, args.claimId), isNull(claim.feeSettledAt), sql`${claim.shippingFee} > 0`));

  await applyClaimTransition(tx, {
    claimId: args.claimId,
    toStatus: "done",
    actor: args.actor,
    memo: args.memo ?? (args.claimType === "cancel" ? "취소 승인 · 환불 완료" : "검수 완료 · 환불 완료"),
  });

  // 결제 상태를 잔액에 맞춘다 — 전액 환불이면 cancelled, 남으면 partial_cancelled.
  // 원장 합계로 판정하므로 여러 번의 부분 환불이 누적돼도 정확하다(도메인 전이표 §3.2와 정합).
  if (args.refundAmount > 0) {
    const balanceAfter = await readRefundableBalance(tx, args.paymentId, args.paymentAmount);
    await tx
      .update(payment)
      .set({ status: balanceAfter <= 0 ? "cancelled" : "partial_cancelled" })
      .where(eq(payment.id, args.paymentId));
  }

  // 전체 취소만 주문을 종결시킨다. 부분 반품은 주문 상태를 건드리지 않는다(클레임은 별도 축)
  if (args.claimType === "cancel") {
    // 사용 적립금 전액 복원은 이 전이 안에서 일어난다(restoreOrderPoints) — 취소는 전량이므로
    // 비례 배분이 필요 없고, 초크포인트에 두면 다른 취소 경로도 같이 덮인다
    await applyOrderTransition(tx, {
      orderId: args.orderId,
      toStatus: "cancelled",
      actor: args.actor,
      memo: `클레임 ${args.claimNo} 취소 승인`,
    });
    return { orderCancelled: true };
  }

  // 반품은 주문 상태를 안 바꾸므로 초크포인트를 지나지 않는다 — 여기서 직접 정산한다.
  // 같은 트랜잭션이라 환불이 롤백되면 적립금·쿠폰 차감 기록도 함께 되돌아간다
  await settleClaimPoints(tx, {
    claimId: args.claimId,
    claimNo: args.claimNo,
    orderId: args.orderId,
  });
  await settleClaimCoupon(tx, {
    claimId: args.claimId,
    orderId: args.orderId,
  });

  return { orderCancelled: false };
}
