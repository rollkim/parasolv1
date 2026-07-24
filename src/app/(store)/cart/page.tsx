import type { Metadata } from "next";

import { CartView } from "@/components/store/cart-view";

/**
 * 장바구니 페이지 — 핸드오프 '장바구니.dc.html'.
 * 카트 내용은 세션 쿠키에 묶인 실시간 데이터라 서버 셸은 정적 골격(제목·주문 단계)만 렌더하고,
 * 조회·수량 변경·삭제는 클라이언트 컴포넌트(CartView)가 tRPC로 수행한다.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - 목업의 축약 헤더(로고행+카트 뱃지)는 렌더하지 않는다 — 공통 셸(StoreHeader)이 (store) 레이아웃에서
 *    부착되며 뱃지도 셸 몫이다. 페이지는 h1과 주문 단계 표시만 소유한다.
 */
export const metadata: Metadata = { title: "장바구니" };

export default function CartPage() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-[18px] pb-10 md:px-10">
      <h1 className="m-0 font-heading text-[clamp(20px,2.6vw,24px)] font-extrabold">
        장바구니
      </h1>

      {/* 주문 단계 표시 — 01만 활성(primary + aria-current), 구분선은 장식(목업 실측 '———') */}
      <nav
        aria-label="주문 진행 단계"
        className="mt-2 flex flex-wrap items-center gap-2 border-b border-border pb-[14px] text-[13px]"
      >
        <span aria-current="step" className="font-extrabold text-primary">
          01 장바구니
        </span>
        <span aria-hidden="true" className="text-border">
          ———
        </span>
        <span className="text-muted-foreground">02 주문/결제</span>
        <span aria-hidden="true" className="text-border">
          ———
        </span>
        <span className="text-muted-foreground">03 주문완료</span>
      </nav>

      <CartView />
    </div>
  );
}
