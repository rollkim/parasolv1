import type { Metadata } from "next";

import { AdminCategoryView } from "@/components/admin/admin-category-view";

/** 관리자 카테고리 관리 — 핸드오프 '관리자 카테고리.dc.html' (대분류·중분류 2단계) */
export const metadata: Metadata = { title: "카테고리 관리" };
export const dynamic = "force-dynamic";

export default function AdminCategoriesPage() {
  return <AdminCategoryView />;
}
