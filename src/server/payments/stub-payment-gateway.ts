import "server-only";

import {
  PaymentGatewayError,
  PaymentRejectedError,
  type GatewayApproval,
  type GatewayCancelResult,
  type PaymentGateway,
} from "./payment-gateway";

/**
 * 토스 키 발급 전, 결제 전 흐름을 돌리기 위한 가짜 승인기(개발·통합검증용).
 *
 * 규약 — paymentKey 접두어로 실패를 재현한다:
 *   "FAIL-…"       → confirm 확정 거절 (카드 한도 초과 — 캡처 안 됨 확실, 키 선점 해제됨)
 *   "TIMEOUT-…"    → confirm 모호 실패 (통신 오류 — 캡처 여부 불명, 키 선점 유지돼야 함)
 *   "CANCELFAIL-…" → cancel 실패 (보상 실패 = 수동 개입 필요 경로 검증)
 * calls에 외부 호출이 순서대로 남아 "밖에 무엇을 요청했는지"를 검증할 수 있다.
 */

export type StubGatewayCall =
  | { kind: "confirm"; paymentKey: string; orderNo: string; amount: number }
  | { kind: "cancel"; paymentKey: string; cancelReason: string };

export function createStubPaymentGateway(): {
  gateway: PaymentGateway;
  calls: StubGatewayCall[];
} {
  const calls: StubGatewayCall[] = [];

  const gateway: PaymentGateway = {
    async confirm(input) {
      calls.push({ kind: "confirm", ...input });
      if (input.paymentKey.startsWith("FAIL-")) {
        throw new PaymentRejectedError("STUB_CONFIRM_REJECTED", "스텁 승인 확정 거절");
      }
      if (input.paymentKey.startsWith("TIMEOUT-")) {
        throw new PaymentGatewayError("STUB_CONFIRM_TIMEOUT", "스텁 통신 모호 실패(캡처 여부 불명)");
      }
      const approval: GatewayApproval = {
        paymentMethodLabel: "카드",
        approvedAt: new Date(),
        raw: { stub: true, confirmed: input },
      };
      return approval;
    },
    async cancel(input) {
      calls.push({ kind: "cancel", ...input });
      if (input.paymentKey.startsWith("CANCELFAIL-")) {
        throw new PaymentGatewayError("STUB_CANCEL_FAILED", "스텁 취소 실패");
      }
      const cancelResult: GatewayCancelResult = {
        raw: { stub: true, cancelled: input },
      };
      return cancelResult;
    },
  };

  return { gateway, calls };
}
