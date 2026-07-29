import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminBoardView, type BoardTab } from "@/components/admin/admin-board-view";

/**
 * 관리자 게시판 관리 — 핸드오프 '관리자 게시판.dc.html'.
 * 탭이 URL 세그먼트라 사이드바가 하위 메뉴로 직접 링크하고 새로고침해도 같은 탭이 열린다.
 */
export const metadata: Metadata = { title: "게시판 관리" };
export const dynamic = "force-dynamic";

const BOARD_TABS: BoardTab[] = ["notice", "faq", "qna", "bulk"];

export default async function AdminBoardsPage({
  params,
}: {
  params: Promise<{ boardTab: string }>;
}) {
  const { boardTab } = await params;
  if (!BOARD_TABS.includes(boardTab as BoardTab)) notFound();

  return <AdminBoardView activeTab={boardTab as BoardTab} />;
}
