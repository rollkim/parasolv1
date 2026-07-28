import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  ClaimFeeUnsettledError,
  ClaimQuantityExceededError,
  ClaimReasonNotAllowedError,
  ClaimWindowExpiredError,
  IllegalClaimTransitionError,
  ManualRefundReferenceRequiredError,
  OrderNotClaimableError,
} from "@/domain/claim";
import { BlockedOrderLineError, OrderAmountMismatchError } from "@/domain/order";
import { AdminClaimNotFoundError } from "@/server/services/admin-claim.service";
import {
  AdminOrderNotFoundError,
  InvoiceRequiresPreparingError,
} from "@/server/services/admin-order.service";
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

import { toOrderTRPCError } from "./order-error";

/**
 * 매핑에서 빠진 도메인 오류는 그대로 통과해 500이 된다 — 사용자에게는 '서버 오류'로 보이고
 * 클라이언트가 재시도까지 한다. 새 오류를 만들 때 매핑을 잊는 것이 실제로 두 번 일어났으므로
 * (OrderAccessDenied·TermsNotAgreed) 전 오류가 매핑되는지를 테스트가 지킨다.
 */
const DOMAIN_ERRORS: { name: string; error: Error }[] = [
  { name: "CartNotFoundError", error: new CartNotFoundError() },
  { name: "TermsNotAgreedError", error: new TermsNotAgreedError([1]) },
  { name: "BlockedOrderLineError", error: new BlockedOrderLineError([1]) },
  { name: "OrderAmountMismatchError", error: new OrderAmountMismatchError(1000, 900) },
  { name: "StockShortageError", error: new StockShortageError([]) },
  { name: "StockShortageCompensatedError", error: new StockShortageCompensatedError([]) },
  { name: "OrderAccessDeniedError", error: new OrderAccessDeniedError() },
  { name: "OrderNotFoundError", error: new OrderNotFoundError("20260101-0001") },
  { name: "OrderNotPayableError", error: new OrderNotPayableError("20260101-0001", "cancelled") },
  { name: "PaymentStateConflictError", error: new PaymentStateConflictError("20260101-0001", "충돌") },
  {
    name: "PaymentCompensationFailedError",
    error: new PaymentCompensationFailedError("20260101-0001", "key", new Error("cause")),
  },
  { name: "PaymentRejectedError", error: new PaymentRejectedError("CODE", "거절") },
  { name: "PaymentGatewayError", error: new PaymentGatewayError("CODE", "통신 실패") },
  // 클레임 — 신규 오류를 만들고 매핑을 잊으면 조용히 500이 된다(이미 두 번 겪었다)
  { name: "OrderNotClaimableError", error: new OrderNotClaimableError("cancel", "shipping") },
  { name: "ClaimWindowExpiredError", error: new ClaimWindowExpiredError() },
  { name: "ClaimReasonNotAllowedError", error: new ClaimReasonNotAllowedError("change_mind", "exchange") },
  { name: "ClaimQuantityExceededError", error: new ClaimQuantityExceededError(3, 2, 2) },
  { name: "ClaimReasonUnknownError", error: new ClaimReasonUnknownError("nope") },
  { name: "ClaimTargetEmptyError", error: new ClaimTargetEmptyError() },
  { name: "ClaimItemNotInOrderError", error: new ClaimItemNotInOrderError(1) },
  { name: "ClaimOrderNotFoundError", error: new ClaimOrderNotFoundError() },
  { name: "ClaimOrderAccessDeniedError", error: new ClaimOrderAccessDeniedError() },
  // 관리자 처리(C6) — 여기 오류는 전부 운영자 화면에 그대로 뜬다
  { name: "IllegalClaimTransitionError", error: new IllegalClaimTransitionError("return", "done", "requested") },
  { name: "ClaimFeeUnsettledError", error: new ClaimFeeUnsettledError() },
  { name: "ManualRefundReferenceRequiredError", error: new ManualRefundReferenceRequiredError() },
  { name: "ClaimTypeMismatchError", error: new ClaimTypeMismatchError("exchange", "cancel") },
  { name: "ClaimFeeAlreadySettledError", error: new ClaimFeeAlreadySettledError() },
  { name: "ClaimProcessNotFoundError", error: new ClaimProcessNotFoundError(1) },
  { name: "ClaimRefundNotFoundError", error: new ClaimRefundNotFoundError(1) },
  { name: "ClaimNotRefundableError", error: new ClaimNotRefundableError("exchange", "requested") },
  { name: "ClaimPaymentMissingError", error: new ClaimPaymentMissingError(1) },
  { name: "ClaimRefundExceedsBalanceError", error: new ClaimRefundExceedsBalanceError(5000, 1000) },
  { name: "AdminClaimNotFoundError", error: new AdminClaimNotFoundError("RT-20260101-0001") },
  { name: "AdminOrderNotFoundError", error: new AdminOrderNotFoundError("20260101-0001") },
  { name: "InvoiceRequiresPreparingError", error: new InvoiceRequiresPreparingError() },
  { name: "AdminProductNotFoundError", error: new AdminProductNotFoundError(1) },
  { name: "DuplicateProductSlugError", error: new DuplicateProductSlugError("oat-cookie") },
  { name: "DuplicateVariantSkuError", error: new DuplicateVariantSkuError("CK-1001") },
  { name: "ProductVariantRequiredError", error: new ProductVariantRequiredError() },
];

describe("주문 오류 → tRPC 오류 매핑", () => {
  it.each(DOMAIN_ERRORS)("$name은 TRPCError로 번역된다", ({ error }) => {
    expect(toOrderTRPCError(error)).toBeInstanceOf(TRPCError);
  });

  it.each(DOMAIN_ERRORS)("$name의 문구는 한글 완성 문장이다", ({ error }) => {
    const mapped = toOrderTRPCError(error) as TRPCError;
    // 영문 코드·스택이 그대로 노출되면 안 된다(README UX 6)
    expect(mapped.message).toMatch(/[가-힣]/);
    expect(mapped.message).not.toMatch(/Error:|at \w+\./);
  });

  it("조회 실패는 미존재·권한없음을 구분하지 않는다", () => {
    const denied = toOrderTRPCError(new OrderAccessDeniedError()) as TRPCError;
    expect(denied.code).toBe("NOT_FOUND");
  });

  it("금액 위변조 응답은 서버 계산 금액을 노출하지 않는다", () => {
    const mismatch = toOrderTRPCError(new OrderAmountMismatchError(23700, 100)) as TRPCError;
    expect(mismatch.message).not.toContain("23700");
  });

  it("이미 TRPCError면 그대로 둔다", () => {
    const original = new TRPCError({ code: "UNAUTHORIZED", message: "로그인이 필요합니다." });
    expect(toOrderTRPCError(original)).toBe(original);
  });

  it("알 수 없는 오류는 삼키지 않는다 — 500으로 남겨 진단 가능하게", () => {
    const unknown = new Error("예상치 못한 실패");
    expect(toOrderTRPCError(unknown)).toBe(unknown);
  });
});
