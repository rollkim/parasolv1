import type { Metadata } from "next";

import { AdminProductFormView } from "@/components/admin/admin-product-form-view";

/** 상품 등록 — 수정 화면과 같은 폼을 쓴다(productId만 다르다) */
export const metadata: Metadata = { title: "상품 등록" };
export const dynamic = "force-dynamic";

export default function AdminProductNewPage() {
  return <AdminProductFormView productId={null} />;
}
