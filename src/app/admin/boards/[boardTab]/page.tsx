import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminBoardView, type BoardTab } from "@/components/admin/admin-board-view";

/**
 * 관리자 게시판 관리 — 운영자가 **쓰는** 글(공지사항 · FAQ).
 * 고객이 쓰고 운영자가 답하는 문의는 /admin/inquiries에 있다.
 *
 * 탭이 URL 세그먼트라 사이드바가 하위 메뉴로 직접 링크하고 새로고침해도 같은 탭이 열린다.
 */
export const metadata: Metadata = { title: "게시판 관리" };
export const dynamic = "force-dynamic";

const BOARD_TABS: BoardTab[] = ["notice", "faq"];

export default async function AdminBoardsPage({
  params,
}: {
  params: Promise<{ boardTab: string }>;
}) {
  const { boardTab } = await params;
  if (!BOARD_TABS.includes(boardTab as BoardTab)) notFound();

  return <AdminBoardView activeTab={boardTab as BoardTab} />;
}
