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
  searchParams,
}: {
  params: Promise<{ inquiryKind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { inquiryKind } = await params;
  if (!INQUIRY_KINDS.includes(inquiryKind as InquiryKind)) notFound();

  // ?post=<id> — 대시보드 '최근 문의'가 특정 문의로 바로 보낸다.
  // 잘못된 값이면 그냥 목록을 연다(없는 문의로 오류 화면을 띄울 이유가 없다)
  const { post } = await searchParams;
  const parsedPostId = Number.parseInt((Array.isArray(post) ? post[0] : post) ?? "", 10);
  const openPostId =
    Number.isNaN(parsedPostId) || parsedPostId < 1 ? null : parsedPostId;

  return (
    <AdminInquiryView
      activeKind={inquiryKind as InquiryKind}
      openPostId={openPostId}
    />
  );
}
