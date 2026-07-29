import type { Metadata } from "next";

import { AdminSettingView } from "@/components/admin/admin-setting-view";

/** 관리자 설정 — 핸드오프 '관리자 설정.dc.html' (사업자 정보·정책 문구·배송비·측정 ID) */
export const metadata: Metadata = { title: "설정" };
export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return <AdminSettingView />;
}
