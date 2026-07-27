import "server-only";

import { TRPCError } from "@trpc/server";

import {
  BlockedOrderLineError,
  OrderAmountMismatchError,
} from "@/domain/order";
import {
  PaymentGatewayError,
  PaymentRejectedError,
} from "@/server/payments/payment-gateway";
import { StockShortageError } from "@/server/services/inventory.service";
import { OrderAccessDeniedError } from "@/server/services/order-query.service";
import { CartNotFoundError, TermsNotAgreedError } from "@/server/services/order.service";
import {
  OrderNotFoundError,
  OrderNotPayableError,
  PaymentCompensationFailedError,
  PaymentStateConflictError,
  StockShortageCompensatedError,
} from "@/server/services/payment.service";

/**
 * 주문·결제 도메인 오류 → tRPC 오류 번역.
 *
 * 주문/결제 서비스는 tRPC를 모른다(RULE-14) — tRPC·웹훅 라우트·배치 세 곳에서 호출되기
 * 때문이다. 그래서 서비스는 도메인 오류를 던지고, HTTP 경계인 여기서만 코드·문구로 옮긴다.
 * (카트·회원 서비스는 tRPC 전용이라 TRPCError를 직접 던지는 기존 방식을 유지한다.)
 *
 * 문구 규칙: 원인 + 다음 행동을 함께 준다(접근성 규칙). 실패 원인을 감춰야 하는 것은
 * 금액 위변조뿐 — 공격자에게 서버 계산값을 알려주지 않는다.
 */

/** 알 수 없는 오류는 그대로 통과시켜 500으로 남긴다 — 삼키면 진단이 사라진다 */
export function toOrderTRPCError(error: unknown): unknown {
  if (error instanceof TRPCError) return error;

  if (error instanceof CartNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "장바구니를 찾을 수 없습니다. 상품을 다시 담아 주세요.",
      cause: error,
    });
  }

  if (error instanceof TermsNotAgreedError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "필수 약관에 모두 동의해야 주문할 수 있습니다.",
      cause: error,
    });
  }

  if (error instanceof BlockedOrderLineError) {
    return new TRPCError({
      code: "CONFLICT",
      message: "주문할 수 없는 상품이 있습니다. 장바구니에서 품절·판매중지 상품을 확인해 주세요.",
      cause: error,
    });
  }

  if (error instanceof OrderAmountMismatchError) {
    // 서버가 계산한 금액은 노출하지 않는다 — 위변조 탐지 우회 힌트가 된다
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "결제 금액이 주문 정보와 일치하지 않습니다. 장바구니부터 다시 시도해 주세요.",
      cause: error,
    });
  }

  // 승인 전 재고 부족(주문 생성 단계) — 돈이 오가지 않은 상태
  if (error instanceof StockShortageError) {
    return new TRPCError({
      code: "CONFLICT",
      message: "재고가 부족한 상품이 있습니다. 장바구니에서 수량을 조정해 주세요.",
      cause: error,
    });
  }

  // 승인 후 재고 부족 → 자동 환불 완료. "돈은 돌아갔다"를 반드시 알린다
  if (error instanceof StockShortageCompensatedError) {
    return new TRPCError({
      code: "CONFLICT",
      message:
        "재고가 부족하여 결제가 자동으로 취소되었습니다. 결제하신 금액은 전액 환불되며, 카드사에 따라 영업일 기준 3~5일이 걸릴 수 있습니다.",
      cause: error,
    });
  }

  if (error instanceof OrderNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "주문을 찾을 수 없습니다. 주문번호를 다시 확인해 주세요.",
      cause: error,
    });
  }

  // 미존재와 권한 없음을 구분해 알리지 않는다 — 구분되면 주문번호 대입으로 존재 여부를 캐낼 수 있다
  if (error instanceof OrderAccessDeniedError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "입력하신 정보와 일치하는 주문이 없어요. 주문번호와 연락처를 다시 확인해 주세요.",
      cause: error,
    });
  }

  if (error instanceof OrderNotPayableError) {
    const detail =
      error.orderStatus === "cancelled"
        ? "이미 취소된 주문입니다."
        : "이미 결제가 완료된 주문입니다.";
    return new TRPCError({
      code: "CONFLICT",
      message: `${detail} 주문 내역에서 상태를 확인해 주세요.`,
      cause: error,
    });
  }

  if (error instanceof PaymentStateConflictError) {
    return new TRPCError({
      code: "CONFLICT",
      message: "다른 결제 시도가 진행 중입니다. 잠시 후 주문 내역에서 결제 상태를 확인해 주세요.",
      cause: error,
    });
  }

  // ★환불까지 실패 — 고객 돈이 묶여 있다. 운영 알림이 붙을 지점(Phase 6)
  if (error instanceof PaymentCompensationFailedError) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "결제 처리 중 문제가 발생했습니다. 결제하신 내역은 고객센터에서 확인 후 처리해 드립니다. 주문번호를 알려주세요.",
      cause: error,
    });
  }

  // 확정 거절 — 고객이 다른 수단으로 즉시 재시도할 수 있다
  if (error instanceof PaymentRejectedError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "결제가 승인되지 않았습니다. 카드 정보를 확인하시거나 다른 결제수단으로 시도해 주세요.",
      cause: error,
    });
  }

  // 모호 실패(타임아웃 등) — 결제됐을 수 있으므로 "다시 시도"를 권하지 않는다
  if (error instanceof PaymentGatewayError) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "결제 결과를 확인하지 못했습니다. 중복 결제를 막기 위해 잠시 후 주문 내역에서 상태를 먼저 확인해 주세요.",
      cause: error,
    });
  }

  return error;
}

/** 주문·결제 서비스 호출을 감싸 도메인 오류를 tRPC 오류로 바꾼다 */
export async function withOrderErrorMapping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toOrderTRPCError(error);
  }
}
