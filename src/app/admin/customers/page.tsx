import type { Metadata } from "next";

import { AdminCustomerListView } from "@/components/admin/admin-customer-list-view";

/** 관리자 회원 목록 — 핸드오프 '관리자 회원관리.dc.html' */
export const metadata: Metadata = { title: "회원 관리" };
export const dynamic = "force-dynamic";

export default function AdminCustomersPage() {
  return <AdminCustomerListView />;
}
