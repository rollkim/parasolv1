import type { Metadata } from "next";

import { AdminDisplayView } from "@/components/admin/admin-display-view";

/** 관리자 배너·진열 관리 — 핸드오프 '관리자 배너진열.dc.html' */
export const metadata: Metadata = { title: "배너·진열 관리" };
export const dynamic = "force-dynamic";

export default function AdminBannersPage() {
  return <AdminDisplayView />;
}
