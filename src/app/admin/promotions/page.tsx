import type { Metadata } from "next";

import { AdminPromotionView } from "@/components/admin/admin-promotion-view";

/** 기획전 관리 — 목록·등록/수정·상품 구성·쿠폰 연결·중지 */
export const metadata: Metadata = { title: "기획전" };
export const dynamic = "force-dynamic";

export default function AdminPromotionsPage() {
  return <AdminPromotionView />;
}
