import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminCustomerDetailView } from "@/components/admin/admin-customer-detail-view";

/** 관리자 회원 상세 — 메모·계정 정지·강제 탈퇴 */
export const metadata: Metadata = { title: "회원 상세" };
export const dynamic = "force-dynamic";

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  if (!/^\d+$/.test(customerId)) notFound();

  return <AdminCustomerDetailView customerId={Number(customerId)} />;
}
