import type { Metadata } from "next";

import { AdminReviewListView } from "@/components/admin/admin-review-list-view";

/** 관리자 리뷰 관리 — 핸드오프 '관리자 리뷰관리.dc.html' */
export const metadata: Metadata = { title: "리뷰 관리" };
export const dynamic = "force-dynamic";

export default function AdminReviewsPage() {
  return <AdminReviewListView />;
}
