import type { Metadata } from "next";

import { CheckoutView } from "@/components/store/checkout-view";

/**
 * 체크아웃 페이지 — 핸드오프 '체크아웃.dc.html'.
 * 카트·회원 정보는 세션에 묶인 실시간 데이터라 서버 셸은 제목·주문 단계만 렌더하고,
 * 주문서 조회·입력·주문 생성은 클라이언트 컴포넌트(CheckoutView)가 tRPC로 수행한다.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - 목업의 축약 헤더(로고+타이틀)는 렌더하지 않는다 — 공통 셸(StoreHeader)이 (store) 레이아웃에서
 *    부착된다. 장바구니 페이지와 같은 규약.
 */
export const metadata: Metadata = { title: "주문/결제" };

export default function CheckoutPage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-[18px] pb-10 md:px-10">
      <h1 className="m-0 font-heading text-[clamp(20px,2.6vw,24px)] font-extrabold">
        주문/결제
      </h1>

      {/* 주문 단계 표시 — 02만 활성(primary + aria-current), 구분선은 장식 */}
      <nav
        aria-label="주문 진행 단계"
        className="mt-2 flex flex-wrap items-center gap-2 border-b border-border pb-[14px] text-[13px]"
      >
        <span className="text-muted-foreground">01 장바구니</span>
        <span aria-hidden="true" className="text-border">
          ———
        </span>
        <span aria-current="step" className="font-extrabold text-primary">
          02 주문/결제
        </span>
        <span aria-hidden="true" className="text-border">
          ———
        </span>
        <span className="text-muted-foreground">03 주문완료</span>
      </nav>

      <CheckoutView />
    </div>
  );
}
