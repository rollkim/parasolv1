import { NextResponse } from "next/server";

import { db } from "@/db";
import { getPaymentGateway } from "@/server/payments";
import { confirmPayment } from "@/server/services/payment.service";

/**
 * 토스 결제 웹훅 — successUrl 콜백이 유실됐을 때의 안전망.
 *
 * 고객이 결제 후 브라우저를 닫거나 네트워크가 끊기면 successUrl이 호출되지 않는다.
 * 그때 돈만 빠져나가고 주문이 pending으로 남는 것을 막는 것이 이 경로의 존재 이유다.
 * confirmPayment가 멱등이라 콜백과 웹훅이 둘 다 도착해도 안전하다.
 *
 * 응답 규약: 토스는 2xx가 아니면 재시도한다. **재시도가 의미 있는 실패에만 5xx**를 준다 —
 * 잘못된 서명·이미 취소된 주문처럼 몇 번을 다시 보내도 같은 결과인 요청에 5xx를 주면
 * 무한 재시도를 부른다.
 */

/** 결제 승인 완료 이벤트 — 이 상태일 때만 확정을 시도한다 */
const PAYMENT_DONE_STATUS = "DONE";

type TossWebhookBody = {
  eventType?: string;
  data?: {
    orderId?: string;
    paymentKey?: string;
    status?: string;
    totalAmount?: number;
  };
};

/**
 * 발신자 확인 — 토스 개발자센터에 등록한 시크릿과 대조한다.
 * 시크릿이 설정돼 있는데 헤더가 없거나 다르면 처리하지 않는다(위조 요청 차단).
 */
function isAuthenticWebhook(request: Request): boolean {
  const expectedSecret = process.env.TOSS_WEBHOOK_SECRET;
  if (!expectedSecret) {
    // 미설정 = 아직 연동 전. 운영에서는 반드시 설정해야 한다.
    return process.env.NODE_ENV !== "production";
  }
  return request.headers.get("x-toss-webhook-secret") === expectedSecret;
}

export async function POST(request: Request) {
  if (!isAuthenticWebhook(request)) {
    // 재시도해도 통과할 수 없다 — 401로 끝낸다
    return NextResponse.json({ received: false }, { status: 401 });
  }

  let body: TossWebhookBody;
  try {
    body = (await request.json()) as TossWebhookBody;
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  const orderNo = body.data?.orderId;
  const paymentKey = body.data?.paymentKey;
  const amount = body.data?.totalAmount;

  // 승인 완료 외의 이벤트(취소·가상계좌 발급 등)는 이 경로가 다루지 않는다.
  // 수신 자체는 성공으로 응답해 토스의 재시도를 멈춘다.
  if (body.data?.status !== PAYMENT_DONE_STATUS || !orderNo || !paymentKey) {
    return NextResponse.json({ received: true, handled: false });
  }

  try {
    const result = await confirmPayment(db, getPaymentGateway(), {
      orderNo,
      paymentKey,
      amount: amount ?? 0,
      // 웹훅에는 브라우저 쿠키가 없어 어느 장바구니인지 알 수 없다.
      // 카트 비우기는 successUrl 경로가 처리하고, 실패해도 재주문을 막지 않는다.
      cartToken: null,
    });
    return NextResponse.json({ received: true, handled: true, orderNo: result.orderNo });
  } catch (error) {
    // 여기서 5xx를 주면 토스가 재시도한다. 재시도로 해결될 수 있는 것은
    // 일시적 장애뿐이므로, 원인을 남기고 5xx로 재시도를 유도한다.
    // (금액 불일치·이미 취소된 주문 등은 재시도해도 같은 결과지만, 이 경로에서
    //  조용히 성공 처리하면 돈이 묶인 사실이 묻힌다 — 재시도 로그로 드러나게 둔다.)
    console.error("[toss-webhook] 결제 확정 실패", { orderNo, paymentKey, error });
    return NextResponse.json({ received: true, handled: false }, { status: 500 });
  }
}
