import type { Metadata } from "next";

import { OrderLookupView } from "@/components/store/order-lookup-view";

/**
 * 비회원 주문조회 페이지 — 핸드오프 '비회원주문조회.dc.html'.
 * 주문번호 + 주문자 연락처 2요소로 조회하며, 조회·마스킹은 서버가 수행한다(RULE-14).
 * 푸터의 '비회원 주문조회' 링크가 이 경로를 가리킨다.
 */
export const metadata: Metadata = { title: "비회원 주문조회" };

export default function OrderLookupPage() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[18px] pb-10 md:px-10">
      <h1 className="m-0 text-center font-heading text-[clamp(20px,2.6vw,24px)] font-extrabold">
        비회원 주문조회
      </h1>

      <OrderLookupView />
    </div>
  );
}
