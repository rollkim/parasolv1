import "server-only";

/**
 * PG(결제 게이트웨이) 어댑터 경계 — 결제 서비스는 이 인터페이스만 안다.
 *
 * 토스 실키 연동 시 toss-payment-gateway.ts가 이 인터페이스를 구현하고
 * 배선(어떤 구현을 주입할지)만 바뀐다 — payment.service 코드는 그대로다(RULE-14).
 * 시크릿 키는 그 구현 파일이 서버 env에서만 읽는다(RULE-11: 클라이언트 번들 금지).
 *
 * ── 실 어댑터 구현 시 반드시 지킬 것 (토스 공식 LLM 레퍼런스 기준) ──
 *  1. 인증 헤더: `Basic base64(SECRET_KEY + ":")` — **시크릿 뒤 콜론 1개**가 필수다.
 *     콜론 누락이 가장 흔한 실수이며, BOM이 섞이면 결과가 `77u/`로 시작한다.
 *  2. 멱등키: POST에 `Idempotency-Key: {UUID v4}` 헤더를 붙인다(15일 유효).
 *     같은 키는 첫 응답을 그대로 돌려주므로 중복 승인·중복 취소를 막는다. GET은 무시된다.
 *  3. 승인: `POST /v1/payments/confirm` — body `{ paymentKey, orderId, amount }`.
 *     amount는 **서버가 저장한 금액**이다(successUrl 쿼리 값이 아니다).
 *  4. 취소: `POST /v1/payments/{paymentKey}/cancel` — body `{ cancelReason }`,
 *     부분 취소는 `cancelAmount` 추가. 가상계좌 환불은 `refundReceiveAccount` 필요.
 *  5. 조회: `GET /v1/payments/{paymentKey}` — confirm 실패를 곧바로 결제 실패로 단정하지 않고
 *     이 API로 실제 상태를 확인한 뒤 분기한다(이미 승인된 건일 수 있다).
 *  6. 필드를 지어내지 않는다 — 문서에 없는 필드는 만들지 않는다(타 PG 명칭 유추 금지).
 */

export type GatewayConfirmInput = {
  paymentKey: string;
  /** 토스 orderId 자리에는 우리 order_no("YYYYMMDD-####")를 그대로 쓴다 */
  orderNo: string;
  /** 서버가 저장한 grand_total — 클라이언트가 보낸 금액이 아니라 이 값으로 승인한다 */
  amount: number;
};

export type GatewayApproval = {
  /** 결제 수단 표시명(카드·가상계좌…) — 알 수 없으면 null */
  paymentMethodLabel: string | null;
  approvedAt: Date | null;
  /** PG 원본 응답 — payment.raw에 그대로 보관(정산·CS 대사용) */
  raw: unknown;
};

export type GatewayCancelInput = {
  paymentKey: string;
  cancelReason: string;
  /**
   * 부분 취소 금액 — 생략하면 전액 취소(토스 API와 같은 규약).
   * 클레임 환불이 부분 반품을 다루므로 필요하다. 한 결제에 부분취소를 여러 번 할 수 있어
   * 잔액 검증은 호출자(payment_cancellation 합계)가 한다.
   */
  cancelAmount?: number;
  /**
   * 가상계좌 결제에만 필요하다(토스 문서 확인). 카드·계좌이체는 원 결제수단으로
   * 자동환불되므로 생략한다 — 억지로 채우면 토스가 오히려 거절한다.
   * bank는 토스 은행 코드(도메인 bank-code.ts 참고).
   */
  refundReceiveAccount?: { bank: string; accountNumber: string; holderName: string };
};

export type GatewayCancelResult = { raw: unknown };

export interface PaymentGateway {
  /**
   * 결제 승인. 실패는 두 종류를 구분해 던진다:
   *   - 확정 거절(카드 한도·잔액 부족 등 "캡처 안 됨"이 확실) → PaymentRejectedError
   *   - 모호 실패(타임아웃·네트워크 오류 등 캡처 여부 불명) → PaymentGatewayError
   * 이 구분은 돈 문제다 — 결제 서비스는 확정 거절일 때만 결제키 선점을 풀어
   * 재시도를 연다. 모호 실패에 선점을 풀면 캡처됐을 수 있는 돈의 표식이 지워지고
   * 새 키로 이중 캡처가 열린다.
   * 실 토스 어댑터 주의: 같은 paymentKey 재승인이 ALREADY_PROCESSED_PAYMENT로
   * 거절되면 곧바로 성공으로 매핑하지 말고, 결제 조회 API로 실제 상태를 확인해
   * DONE(승인 완료)일 때만 성공으로 매핑한다 — "이미 취소된 결제"까지 승인 성공으로
   * 둔갑시키면 안 된다(멱등은 유지하되 상태 검증 필수).
   */
  confirm(input: GatewayConfirmInput): Promise<GatewayApproval>;
  /**
   * 전액 취소 — 재고 부족 자동 보상·클레임 환불이 공용한다.
   * 멱등이어야 한다: 이미 취소된 결제의 취소 요청은 성공으로 매핑한다.
   * 중복 보상 흐름이 같은 키를 두 번 취소할 수 있기 때문이다.
   */
  cancel(input: GatewayCancelInput): Promise<GatewayCancelResult>;
}

export class PaymentGatewayError extends Error {
  constructor(
    /** PG가 준 실패 코드(토스 응답의 code 필드 대응) */
    readonly gatewayCode: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentGatewayError";
  }
}

/**
 * 승인 확정 거절 — 돈이 캡처되지 않았음이 '확실한' 실패에만 쓴다.
 * 타임아웃·네트워크 오류처럼 캡처 여부를 알 수 없는 실패에 이 타입을 쓰면
 * 결제키 선점이 풀려 이중 캡처 차단이 무너진다 — 그런 경우는 부모
 * PaymentGatewayError로 던진다.
 */
export class PaymentRejectedError extends PaymentGatewayError {
  constructor(gatewayCode: string, message: string) {
    super(gatewayCode, message);
    this.name = "PaymentRejectedError";
  }
}
