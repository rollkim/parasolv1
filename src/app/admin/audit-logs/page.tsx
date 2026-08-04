import type { Metadata } from "next";

import { AdminAuditView } from "@/components/admin/admin-audit-view";

/** 운영 기록 — 주문·클레임·재고·환불 원장의 읽기 전용 창. 그동안 죽은 메뉴였다 */
export const metadata: Metadata = { title: "운영 기록" };
export const dynamic = "force-dynamic";

export default function AdminAuditLogsPage() {
  return <AdminAuditView />;
}
