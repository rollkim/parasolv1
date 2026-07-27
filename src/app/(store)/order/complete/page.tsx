import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderCompleteView } from "@/components/store/order-complete-view";

/**
 * 주문완료 페이지 — 핸드오프 '주문완료.dc.html'.
 * 주문번호만 쿼리로 받고, 본인 확인은 세션(회원) 또는 주문 생성 때 발급한 쿠키(비회원)가 한다 —
 * 조회 토큰을 URL에 실으면 Referer·브라우저 기록·공유 링크로 새어 남의 주문이 열린다.
 */
export const metadata: Metadata = { title: "주문완료" };

export default async function OrderCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ orderNo?: string }>;
}) {
  const { orderNo } = await searchParams;
  // 형식이 어긋나면 조회를 시도하지 않는다 — 주문번호 대입 탐색의 입구를 좁힌다
  if (!orderNo || !/^\d{8}-\d{4,}$/.test(orderNo)) notFound();

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[18px] pb-10 md:px-10">
      <h1 className="m-0 font-heading text-[clamp(20px,2.6vw,24px)] font-extrabold">
        주문완료
      </h1>

      {/* 주문 단계 표시 — 03만 활성(primary + aria-current), 구분선은 장식 */}
      <nav
        aria-label="주문 진행 단계"
        className="mt-2 flex flex-wrap items-center gap-2 border-b border-border pb-[14px] text-[13px]"
      >
        <span className="text-muted-foreground">01 장바구니</span>
        <span aria-hidden="true" className="text-border">
          ———
        </span>
        <span className="text-muted-foreground">02 주문/결제</span>
        <span aria-hidden="true" className="text-border">
          ———
        </span>
        <span aria-current="step" className="font-extrabold text-primary">
          03 주문완료
        </span>
      </nav>

      <OrderCompleteView orderNo={orderNo} />
    </div>
  );
}
