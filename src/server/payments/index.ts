import "server-only";

import type { PaymentGateway } from "./payment-gateway";
import { createStubPaymentGateway } from "./stub-payment-gateway";

/**
 * 게이트웨이 주입 지점 — 호출부(tRPC 라우터·웹훅 라우트)는 여기서만 게이트웨이를 받는다.
 *
 * 스텁을 직접 임포트하면 개발용 가짜 승인기가 프로덕션 경로에 박힌다. 실 토스 어댑터가
 * 생기면 이 함수 한 곳만 바꾸면 된다(RULE-14 — 교체 지점을 한 곳으로).
 */

let stubGatewaySingleton: PaymentGateway | null = null;

export function getPaymentGateway(): PaymentGateway {
  const tossSecretKey = process.env.TOSS_SECRET_KEY;

  if (!tossSecretKey) {
    // 키 미발급 상태 — 스텁으로 전 흐름을 돌린다. 운영에서는 절대 이 경로가 아니어야 한다.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "TOSS_SECRET_KEY가 없습니다. 운영 환경에서는 실제 결제 게이트웨이 설정이 필요합니다.",
      );
    }
    stubGatewaySingleton ??= createStubPaymentGateway().gateway;
    return stubGatewaySingleton;
  }

  // TODO(토스 키 발급 후): createTossPaymentGateway(tossSecretKey) 반환.
  // 어댑터 계약 3종은 payment-gateway.ts 주석 참조(ALREADY_PROCESSED 상태검증 ·
  // 확정거절/모호실패 분리 · cancel 멱등).
  throw new Error("토스 게이트웨이 어댑터가 아직 구현되지 않았습니다.");
}
