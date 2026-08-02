import type { Metadata } from "next";

import { AdminPointPolicyView } from "@/components/admin/admin-point-policy-view";

/** 적립금 정책 — 적립률·소멸 기한·사용 규칙·보너스. 지금까지 수동 SQL 외에는 바꿀 방법이 없었다 */
export const metadata: Metadata = { title: "적립금 정책" };
export const dynamic = "force-dynamic";

export default function AdminPointsPage() {
  return <AdminPointPolicyView />;
}
