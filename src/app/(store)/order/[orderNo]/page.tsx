import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderDetailView } from "@/components/store/order-detail-view";

/**
 * 회원 주문상세 — 핸드오프 '주문상세.dc.html'.
 * 소유 확인은 세션(customerId)이 하며, 서버가 마스킹 없이 내려준다.
 * 비회원은 이 경로를 쓰지 않는다 — /order-lookup(주문번호+연락처)이 담당한다.
 */
export const metadata: Metadata = { title: "주문 상세" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;
  // 형식이 어긋나면 조회를 시도하지 않는다 — 주문번호 대입 탐색의 입구를 좁힌다
  if (!/^\d{8}-\d{4,}$/.test(orderNo)) notFound();

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-[18px] pb-10 md:px-10">
      <h1 className="m-0 font-heading text-[clamp(20px,2.6vw,24px)] font-extrabold">
        주문 상세
      </h1>
      <OrderDetailView orderNo={orderNo} />
    </div>
  );
}
