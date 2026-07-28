import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminOrderDetailView } from "@/components/admin/admin-order-detail-view";

/** 관리자 주문 상세 — 송장 등록·상태 변경. 취소·환불은 클레임 화면이 맡는다 */
export const metadata: Metadata = { title: "주문 상세" };
export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNo: string }>;
}) {
  const { orderNo } = await params;
  if (!/^\d{8}-\d{4,}$/.test(orderNo)) notFound();

  return <AdminOrderDetailView orderNo={orderNo} />;
}
