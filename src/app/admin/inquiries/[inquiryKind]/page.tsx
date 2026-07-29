import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  AdminInquiryView,
  type InquiryKind,
} from "@/components/admin/admin-board-view";

/**
 * 관리자 문의 관리(CS) — 고객이 쓰고 운영자가 답하는 것.
 *
 * 상품 문의와 1:1 문의는 같은 테이블(post)에 살지만 답변하는 맥락이 다르다:
 * 상품 문의는 **어느 상품인지** 모르면 답을 쓸 수 없고, 1:1 문의는 유형(배송·환불)이 갈래다.
 * 그래서 한 목록에 섞지 않는다. 게시판(공지·FAQ)과도 나눴다 — 그쪽은 운영자가 쓰는 글이다.
 */
export const metadata: Metadata = { title: "문의 관리" };
export const dynamic = "force-dynamic";

const INQUIRY_KINDS: InquiryKind[] = ["product", "direct", "bulk"];

export default async function AdminInquiriesPage({
  params,
}: {
  params: Promise<{ inquiryKind: string }>;
}) {
  const { inquiryKind } = await params;
  if (!INQUIRY_KINDS.includes(inquiryKind as InquiryKind)) notFound();

  return <AdminInquiryView activeKind={inquiryKind as InquiryKind} />;
}
