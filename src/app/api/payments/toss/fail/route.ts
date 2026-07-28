import { NextResponse } from "next/server";

/**
 * 토스 failUrl 콜백 — 결제 인증 실패·사용자 취소 시 여기로 리다이렉트된다.
 *
 * **승인 API를 부르지 않는다**(문서 규약) — 인증이 성립하지 않았으므로 승인할 것이 없다.
 * 주문은 pending으로 남아 재시도할 수 있고, 방치되면 스위퍼(Phase 6)가 정리한다.
 *
 * 일반 오류 페이지로 보내지 않는다 — 결제 맥락을 잃으면 사용자가 처음부터 다시 해야 한다.
 * 체크아웃으로 되돌려 사유를 보여주고 그 자리에서 다시 시도하게 한다.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const failureCode = requestUrl.searchParams.get("code") ?? "PAY_FAILED";
  const orderNo = requestUrl.searchParams.get("orderId");

  const checkoutUrl = new URL("/checkout", requestUrl.origin);
  checkoutUrl.searchParams.set("payError", failureCode);
  if (orderNo) checkoutUrl.searchParams.set("orderNo", orderNo);
  // 토스가 준 message는 그대로 노출하지 않는다 — 내부 사정이 섞일 수 있어
  // 화면이 코드로 사용자 문구를 고른다.
  return NextResponse.redirect(checkoutUrl);
}
