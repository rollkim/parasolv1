import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminLoginView } from "@/components/admin/admin-login-view";
import { db } from "@/db";
import { getBusinessInfo } from "@/server/services/site-setting.service";

/**
 * 관리자 로그인 — 셸(사이드바·상단바) 없이 단독으로 렌더된다.
 * 상위 admin/layout.tsx가 세션이 없을 때 셸을 붙이지 않으므로 여기서 따로 할 일이 없다.
 * 비로그인 상태로 다른 /admin 경로에 오면 middleware가 이 화면으로 보낸다.
 */
export const metadata: Metadata = { title: "관리자 로그인" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  // 브랜드명은 리스킨 전제라 site_setting에서 온다(RULE-11)
  const businessInfo = await getBusinessInfo(db);

  return (
    // useSearchParams(복귀 경로)를 쓰므로 Suspense 경계가 필요하다
    <Suspense fallback={null}>
      <AdminLoginView siteName={businessInfo.brandName} />
    </Suspense>
  );
}
