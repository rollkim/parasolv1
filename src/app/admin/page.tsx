import type { Metadata } from "next";

import { AdminDashboardView } from "@/components/admin/admin-dashboard-view";

/** 관리자 대시보드 — 핸드오프 '관리자 대시보드.dc.html' */
export const metadata: Metadata = { title: "대시보드" };
export const dynamic = "force-dynamic";

export default function AdminDashboardPage() {
  return <AdminDashboardView />;
}
