import type { Metadata } from "next";

import { AdminClaimListView } from "@/components/admin/admin-claim-list-view";

/** 관리자 클레임 목록 — 핸드오프 '관리자 클레임.dc.html' */
export const metadata: Metadata = { title: "취소·교환·반품" };
export const dynamic = "force-dynamic";

export default function AdminClaimsPage() {
  return <AdminClaimListView />;
}
