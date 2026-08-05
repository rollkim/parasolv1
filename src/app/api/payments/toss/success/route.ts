import { NextResponse } from "next/server";

import { db } from "@/db";
import { getPaymentGateway } from "@/server/payments";
import { confirmPayment } from "@/server/services/payment.service";
import { CART_COOKIE_NAME } from "@/server/trpc/context";
import { readCookieValueFromHeader } from "@/server/auth/session";
import { resolvePublicOrigin } from "@/server/http/request-origin";

/**
 * 토스 successUrl 콜백 — 결제 인증에 성공한 브라우저가 여기로 리다이렉트된다.
 *
 * 라우트 핸들러로 두는 이유: 승인은 서버가 해야 하고(시크릿 키), 결과에 따라 곧바로
 * 다른 화면으로 보내야 한다. 클라이언트에서 tRPC로 부르면 "확인 중" 화면이 한 번 더 끼고
 * 새로고침·뒤로가기에서 중복 호출이 늘어난다.
 *
 * **쿼리의 amount를 그대로 승인에 쓰지 않는다** — confirmPayment가 서버 저장 금액과
 * 대조한 뒤 서버 값으로 토스를 호출한다(문서 §2.2 · 위변조 차단).
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const paymentKey = requestUrl.searchParams.get("paymentKey");
  const orderNo = requestUrl.searchParams.get("orderId");
  const amountText = requestUrl.searchParams.get("amount");

  // 프록시 뒤에서는 request.url이 http://127.0.0.1:3100 이라 그대로 쓰면
  // HTTPS로 결제한 사용자를 http로 되돌려 보낸다
  const publicOrigin = resolvePublicOrigin(request);
  const checkoutUrl = new URL("/checkout", publicOrigin);

  if (!paymentKey || !orderNo) {
    checkoutUrl.searchParams.set("payError", "INVALID_CALLBACK");
    return NextResponse.redirect(checkoutUrl);
  }

  const cookieHeader = request.headers.get("cookie");
  const cartToken = cookieHeader
    ? readCookieValueFromHeader(cookieHeader, CART_COOKIE_NAME)
    : null;

  try {
    const confirmed = await confirmPayment(db, getPaymentGateway(), {
      orderNo,
      paymentKey,
      // 대조용으로만 쓰인다 — 숫자가 아니면 0으로 두어 금액 불일치로 걸리게 한다
      amount: Number(amountText ?? 0),
      cartToken,
    });

    const completeUrl = new URL("/order/complete", publicOrigin);
    completeUrl.searchParams.set("orderNo", confirmed.orderNo);
    return NextResponse.redirect(completeUrl);
  } catch (confirmError) {
    // 실패 사유는 체크아웃 화면이 사용자 문구로 옮긴다. 원인은 서버 로그에만 남긴다
    console.error("[toss-success] 결제 확정 실패", { orderNo, paymentKey, confirmError });
    checkoutUrl.searchParams.set("payError", "CONFIRM_FAILED");
    checkoutUrl.searchParams.set("orderNo", orderNo);
    return NextResponse.redirect(checkoutUrl);
  }
}
