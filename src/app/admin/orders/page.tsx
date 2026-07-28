import type { Metadata } from "next";

import { AdminOrderListView } from "@/components/admin/admin-order-list-view";

/** 관리자 주문 목록 — 핸드오프 '관리자 주문관리.dc.html' */
export const metadata: Metadata = { title: "주문 관리" };
export const dynamic = "force-dynamic";

export default function AdminOrdersPage() {
  return <AdminOrderListView />;
}
