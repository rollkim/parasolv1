import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminProductFormView } from "@/components/admin/admin-product-form-view";

/** 상품 수정 — 등록과 같은 폼. 없는 id는 폼이 오류로 안내한다 */
export const metadata: Metadata = { title: "상품 수정" };
export const dynamic = "force-dynamic";

export default async function AdminProductEditPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  if (!/^\d+$/.test(productId)) notFound();

  return <AdminProductFormView productId={Number(productId)} />;
}
