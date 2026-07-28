import type { Metadata } from "next";

import { AdminProductListView } from "@/components/admin/admin-product-list-view";

/** 관리자 상품 목록 — 핸드오프 '관리자 상품목록.dc.html' */
export const metadata: Metadata = { title: "상품 관리" };
export const dynamic = "force-dynamic";

export default function AdminProductsPage() {
  return <AdminProductListView />;
}
