import "server-only";

import {
  PaymentGatewayError,
  PaymentRejectedError,
  type GatewayApproval,
  type GatewayCancelResult,
  type PaymentGateway,
} from "./payment-gateway";

/**
 * 토스페이먼츠 실 어댑터 — 인터페이스 계약(payment-gateway.ts)의 유일한 실물 구현.
 *
 * payment.service는 이 파일을 모른다(RULE-14). 스텁과 이 구현은 교체 가능하며,
 * 배선은 payments/index.ts가 한다.
 *
 * 문서: docs.tosspayments.com — LLM Quick Reference 기준.
 * 문서에 없는 필드는 만들지 않는다(타 PG 명칭 유추 금지).
 */

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

/** 외부 호출이 영원히 매달리지 않게 한다 — 트랜잭션 밖이라도 요청 스레드는 붙잡힌다 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 인증 헤더 — `Basic base64(SECRET_KEY + ":")`.
 * **시크릿 뒤 콜론 1개**가 필수다(비밀번호 자리가 비어 있다는 뜻). 문서가 "가장 흔한 실수"로 명시.
 * Buffer는 BOM을 붙이지 않으므로 `77u/` 문제도 생기지 않는다.
 */
export function buildAuthorizationHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

type TossErrorBody = { code?: string; message?: string };

/**
 * 확정 거절로 볼 실패 코드 — "캡처되지 않았음이 확실한" 것만 넣는다.
 * 여기 없는 실패는 전부 모호 실패로 다뤄 결제키 선점을 유지한다(돈의 흔적 보존).
 * 판단이 서지 않으면 모호 쪽에 두는 것이 안전하다 — 이중 캡처보다 수동 확인이 낫다.
 */
export const DEFINITIVE_REJECT_CODES = new Set([
  "REJECT_CARD_COMPANY", // 카드사 승인 거절
  "INVALID_CARD_EXPIRATION",
  "INVALID_STOPPED_CARD",
  "EXCEED_MAX_DAILY_PAYMENT_COUNT",
  "EXCEED_MAX_ONE_DAY_AMOUNT",
  "EXCEED_MAX_AMOUNT",
  "NOT_SUPPORTED_INSTALLMENT_PLAN_CARD_OR_MERCHANT",
  "INVALID_CARD_INSTALLMENT_PLAN",
  "NOT_AVAILABLE_BANK",
  "INVALID_PASSWORD",
  "INCORRECT_BASIC_AUTH_FORMAT",
  "UNAUTHORIZED_KEY",
  "INVALID_REQUEST",
  "NOT_FOUND_PAYMENT",
  "NOT_FOUND_PAYMENT_SESSION",
  "ALREADY_CANCELED_PAYMENT",
  "INVALID_REJECT_CARD",
]);

type TossFetchResult = { ok: true; body: unknown } | { ok: false; error: PaymentGatewayError };

/**
 * 토스 API 호출 공통부.
 *
 * 실패를 두 갈래로 나누는 것이 이 함수의 핵심이다:
 *   · 응답을 받았고 코드가 확정 거절 목록에 있으면 → PaymentRejectedError
 *   · 그 외(네트워크 오류·타임아웃·5xx·모르는 코드) → PaymentGatewayError(모호)
 * 타임아웃을 확정 거절로 처리하면 이미 빠져나간 돈의 표식이 지워진다.
 */
async function callTossApi(
  secretKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
): Promise<TossFetchResult> {
  const headers: Record<string, string> = {
    Authorization: buildAuthorizationHeader(secretKey),
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  /**
   * 멱등키는 POST에만 의미가 있다(GET은 무시된다). 같은 키는 첫 응답을 그대로 돌려주므로
   * 재시도가 중복 승인·중복 취소로 번지지 않는다(15일 유효).
   *
   * 문서는 UUID v4를 권하지만 **결정적 키**를 쓴다 — 무작위 UUID를 매 호출 새로 만들면
   * 재시도마다 다른 키가 되어 멱등이 성립하지 않는다. 같은 작업(같은 결제의 승인)은
   * 같은 키여야 한다. 콜백·웹훅이 동시에 도착해도 토스가 첫 응답을 돌려준다.
   */
  if (init.method === "POST" && init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${TOSS_API_BASE}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (networkError) {
    // 응답을 못 받았다 = 캡처 여부 불명. 반드시 모호 실패다
    return {
      ok: false,
      error: new PaymentGatewayError(
        "NETWORK_ERROR",
        `토스 API 통신에 실패했습니다: ${String(networkError)}`,
      ),
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) return { ok: true, body };

  const errorBody = (body ?? {}) as TossErrorBody;
  const gatewayCode = errorBody.code ?? `HTTP_${response.status}`;
  const message = errorBody.message ?? "결제 처리 중 오류가 발생했습니다.";

  // 5xx는 서버 문제라 캡처 여부를 알 수 없다 — 코드와 무관하게 모호로 둔다
  const definitive = response.status < 500 && DEFINITIVE_REJECT_CODES.has(gatewayCode);
  return {
    ok: false,
    error: definitive
      ? new PaymentRejectedError(gatewayCode, message)
      : new PaymentGatewayError(gatewayCode, message),
  };
}

type TossPaymentBody = {
  status?: string;
  method?: string;
  approvedAt?: string;
  totalAmount?: number;
};

function toApproval(body: unknown): GatewayApproval {
  const payment = (body ?? {}) as TossPaymentBody;
  return {
    paymentMethodLabel: payment.method ?? null,
    approvedAt: payment.approvedAt ? new Date(payment.approvedAt) : null,
    raw: body,
  };
}

export function createTossPaymentGateway(secretKey: string): PaymentGateway {
  return {
    async confirm(input) {
      const result = await callTossApi(secretKey, "/payments/confirm", {
        method: "POST",
        // amount는 서버가 저장한 금액이다 — successUrl 쿼리 값이 아니다(문서 §2.2).
        // 호출자(payment.service)가 이미 그 값을 넘긴다.
        body: {
          paymentKey: input.paymentKey,
          orderId: input.orderNo,
          amount: input.amount,
        },
        // 같은 결제의 재승인은 같은 키로 — 콜백·웹훅 중복 도착이 중복 캡처가 되지 않게 한다
        idempotencyKey: `confirm-${input.paymentKey}`,
      });

      if (result.ok) return toApproval(result.body);

      /**
       * 이미 처리된 결제 — 곧바로 성공으로 매핑하면 "이미 취소된 결제"까지 승인으로 둔갑한다.
       * 조회 API로 실제 상태를 확인해 DONE일 때만 성공으로 본다(문서 §8 · 계약 5).
       */
      if (result.error.gatewayCode === "ALREADY_PROCESSED_PAYMENT") {
        const queried = await callTossApi(secretKey, `/payments/${input.paymentKey}`, {
          method: "GET",
        });
        if (queried.ok && (queried.body as TossPaymentBody)?.status === "DONE") {
          return toApproval(queried.body);
        }
        // 조회 실패나 DONE이 아니면 상태를 단정할 수 없다 — 모호로 남겨 표식을 지키게 한다
        throw new PaymentGatewayError(
          "ALREADY_PROCESSED_UNVERIFIED",
          "이미 처리된 결제이나 상태를 확인하지 못했습니다.",
        );
      }

      throw result.error;
    },

    async cancel(input) {
      const result = await callTossApi(
        secretKey,
        `/payments/${input.paymentKey}/cancel`,
        {
          method: "POST",
          body: {
            cancelReason: input.cancelReason,
            // 생략하면 전액 취소(토스 규약). 부분 취소만 금액을 싣는다
            ...(input.cancelAmount === undefined ? {} : { cancelAmount: input.cancelAmount }),
            // 가상계좌 결제(입금 완료 후) 취소에만 필요 — 카드·계좌이체에 실으면 토스가 거절한다
            ...(input.refundReceiveAccount === undefined
              ? {}
              : { refundReceiveAccount: input.refundReceiveAccount }),
          },
          // 부분 취소는 같은 결제에 여러 번 일어나므로 금액까지 키에 넣어야 서로 다른 취소가 된다
          idempotencyKey: `cancel-${input.paymentKey}-${input.cancelAmount ?? "full"}`,
        },
      );

      if (result.ok) {
        const cancelResult: GatewayCancelResult = { raw: result.body };
        return cancelResult;
      }

      // 이미 취소된 결제의 재취소는 성공으로 본다 — 취소는 멱등이어야 한다(계약 명시).
      // 중복 보상 흐름이 같은 키를 두 번 취소할 수 있기 때문이다.
      if (result.error.gatewayCode === "ALREADY_CANCELED_PAYMENT") {
        return { raw: { alreadyCanceled: true, code: result.error.gatewayCode } };
      }

      throw result.error;
    },
  };
}
