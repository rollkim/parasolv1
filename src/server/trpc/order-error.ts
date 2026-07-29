import "server-only";

import { TRPCError } from "@trpc/server";

import {
  ClaimFeeUnsettledError,
  ClaimQuantityExceededError,
  ClaimReasonNotAllowedError,
  ClaimWindowExpiredError,
  IllegalClaimTransitionError,
  ManualRefundReferenceRequiredError,
  OrderNotClaimableError,
} from "@/domain/claim";
import {
  BlockedOrderLineError,
  OrderAmountMismatchError,
} from "@/domain/order";
import { AdminClaimNotFoundError } from "@/server/services/admin-claim.service";
import { AdminOrderNotFoundError, InvoiceRequiresPreparingError } from "@/server/services/admin-order.service";
import {
  AdminCustomerNotFoundError,
  CustomerAlreadyWithdrawnError,
} from "@/server/services/admin-customer.service";
import {
  AdminBoardNotFoundError,
  AdminPostNotFoundError,
} from "@/server/services/admin-board.service";
import {
  AdminBannerNotFoundError,
  AdminDisplaySectionNotFoundError,
  BannerAltRequiredError,
  BannerPeriodInvalidError,
} from "@/server/services/admin-display.service";
import { AdminReviewNotFoundError } from "@/server/services/admin-review.service";
import { ShippingPolicyInvalidError } from "@/server/services/admin-setting.service";
import {
  AdminCategoryNotFoundError,
  CategoryDepthExceededError,
  CategoryHasChildrenError,
  DuplicateCategorySlugError,
} from "@/server/services/admin-category.service";
import {
  AdminProductNotFoundError,
  DuplicateProductSlugError,
  DuplicateVariantSkuError,
  ProductVariantRequiredError,
} from "@/server/services/admin-product.service";
import {
  ClaimFeeAlreadySettledError,
  ClaimProcessNotFoundError,
  ClaimTypeMismatchError,
} from "@/server/services/claim-process.service";
import {
  ClaimNotRefundableError,
  ClaimPaymentMissingError,
  ClaimRefundExceedsBalanceError,
  ClaimRefundNotFoundError,
} from "@/server/services/claim-refund.service";
import {
  ClaimItemNotInOrderError,
  ClaimOrderAccessDeniedError,
  ClaimOrderNotFoundError,
  ClaimReasonUnknownError,
  ClaimTargetEmptyError,
} from "@/server/services/claim.service";
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

  // ── 클레임 ──
  if (error instanceof OrderNotClaimableError || error instanceof ClaimWindowExpiredError) {
    // 도메인 메시지가 이미 원인+다음 행동을 담고 있다(배송 전/후 안내·기한 안내)
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  if (error instanceof ClaimReasonNotAllowedError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  if (error instanceof ClaimQuantityExceededError) {
    return new TRPCError({
      code: "CONFLICT",
      message: "신청 수량이 남은 수량을 초과합니다. 이미 접수된 클레임을 확인해 주세요.",
      cause: error,
    });
  }

  if (error instanceof ClaimReasonUnknownError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "선택한 사유를 처리할 수 없습니다. 사유를 다시 선택해 주세요.",
      cause: error,
    });
  }

  if (error instanceof ClaimTargetEmptyError || error instanceof ClaimItemNotInOrderError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "신청할 상품을 다시 선택해 주세요.",
      cause: error,
    });
  }

  if (
    error instanceof ClaimOrderNotFoundError ||
    error instanceof ClaimOrderAccessDeniedError
  ) {
    // 주문 조회와 같은 이유로 원인을 구분하지 않는다
    return new TRPCError({
      code: "NOT_FOUND",
      message: "입력하신 정보와 일치하는 주문이 없어요. 주문번호와 연락처를 다시 확인해 주세요.",
      cause: error,
    });
  }

  // ── 관리자 클레임 처리 (C6) ──
  // 관리자 화면은 서버가 내려준 행동만 그리므로 여기 걸리면 동시 처리(다른 관리자가 먼저 처리)다
  if (error instanceof IllegalClaimTransitionError) {
    return new TRPCError({
      code: "CONFLICT",
      message: "이미 처리된 클레임입니다. 화면을 새로고침해 현재 상태를 확인해 주세요.",
      cause: error,
    });
  }

  if (error instanceof ClaimTypeMismatchError || error instanceof ClaimNotRefundableError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  // 배송비를 못 받은 채 교환품이 나가는 것을 막는 게이트 — 문구가 다음 행동을 담고 있다
  if (error instanceof ClaimFeeUnsettledError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  if (error instanceof ClaimFeeAlreadySettledError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  // 수동 환불은 시스템이 검증할 수 없다 — 근거 없이 완료 처리되면 대사가 불가능해진다
  if (error instanceof ManualRefundReferenceRequiredError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  if (error instanceof ClaimPaymentMissingError || error instanceof ClaimRefundExceedsBalanceError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  if (
    error instanceof ClaimProcessNotFoundError ||
    error instanceof ClaimRefundNotFoundError ||
    error instanceof AdminClaimNotFoundError
  ) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "클레임을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.",
      cause: error,
    });
  }

  // ── 관리자 주문 ──
  if (error instanceof AdminOrderNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "주문을 찾을 수 없습니다. 주문번호를 다시 확인해 주세요.",
      cause: error,
    });
  }

  if (error instanceof InvoiceRequiresPreparingError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  // ── 관리자 상품 ──
  if (error instanceof AdminProductNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "상품을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.",
      cause: error,
    });
  }

  // 어느 항목을 고쳐야 하는지가 문구에 들어 있다 — 저장 실패는 원인을 감출 이유가 없다
  if (error instanceof DuplicateProductSlugError || error instanceof DuplicateVariantSkuError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  if (error instanceof ProductVariantRequiredError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  // ── 관리자 카테고리 ──
  if (error instanceof AdminCategoryNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "카테고리를 찾을 수 없습니다. 화면을 새로고침해 주세요.",
      cause: error,
    });
  }

  if (error instanceof DuplicateCategorySlugError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  // 3단계를 막는 문구가 곧 규칙 설명이다 — 왜 안 되는지 화면에서 바로 읽힌다
  if (error instanceof CategoryDepthExceededError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  if (error instanceof CategoryHasChildrenError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  // ── 관리자 회원 ──
  if (error instanceof AdminCustomerNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "회원을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.",
      cause: error,
    });
  }

  if (error instanceof CustomerAlreadyWithdrawnError) {
    return new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }

  // ── 관리자 게시판 ──
  if (error instanceof AdminPostNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "글을 찾을 수 없습니다. 목록을 새로고침해 주세요.",
      cause: error,
    });
  }

  // 시드가 만들어야 할 게시판이 없는 상태 — 운영자가 고칠 수 없으므로 원인을 그대로 알린다
  if (error instanceof AdminBoardNotFoundError) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "게시판 설정이 없습니다. 관리자에게 시드 데이터 확인을 요청해 주세요.",
      cause: error,
    });
  }

  // ── 관리자 배너·진열 ──
  if (
    error instanceof AdminBannerNotFoundError ||
    error instanceof AdminDisplaySectionNotFoundError
  ) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "대상을 찾을 수 없습니다. 화면을 새로고침해 주세요.",
      cause: error,
    });
  }

  // 접근성·기간 규칙 — 문구가 그대로 무엇을 고쳐야 하는지 알려준다
  if (error instanceof BannerAltRequiredError || error instanceof BannerPeriodInvalidError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  // ── 관리자 설정 ──
  // 주문 금액이 이 값에서 나오므로 문구가 무엇을 고쳐야 하는지 그대로 알려준다
  if (error instanceof ShippingPolicyInvalidError) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }

  // ── 관리자 리뷰 ──
  if (error instanceof AdminReviewNotFoundError) {
    return new TRPCError({
      code: "NOT_FOUND",
      message: "리뷰를 찾을 수 없습니다. 목록을 새로고침해 주세요.",
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
