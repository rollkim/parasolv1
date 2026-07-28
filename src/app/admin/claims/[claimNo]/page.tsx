import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminClaimDetailView } from "@/components/admin/admin-claim-detail-view";

/** 관리자 클레임 상세 — 승인·반려·회수·검수·환불. 처리는 C3·C4 서비스가 맡는다 */
export const metadata: Metadata = { title: "클레임 상세" };
export const dynamic = "force-dynamic";

export default async function AdminClaimDetailPage({
  params,
}: {
  params: Promise<{ claimNo: string }>;
}) {
  const { claimNo } = await params;
  if (!/^(CN|EX|RT)-\d{8}-\d{4,}$/.test(claimNo)) notFound();

  return <AdminClaimDetailView claimNo={claimNo} />;
}
