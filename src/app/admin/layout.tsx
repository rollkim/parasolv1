import { AdminPageTitle } from "@/components/admin/admin-page-title";
import { AdminShell } from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/db";
import { getBusinessInfo } from "@/server/services/site-setting.service";

/**
 * 관리자 공통 레이아웃.
 * 스토어프론트와 형제 라우트 그룹이라 헤더·푸터가 섞이지 않는다.
 *
 * 관리자는 공통 푸터 대신 셸 하단 미니 표기로 대체한다(스펙서 §3).
 * 인증 가드는 5주차(관리자)에서 이 레이아웃에 붙인다 — 지금은 셸만 세운다.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const businessInfo = await getBusinessInfo(db);

  return (
    <ToastProvider>
      <AdminShell
        siteName={businessInfo.brandName}
        pageTitle={<AdminPageTitle fallbackTitle="관리자" />}
        businessInfo={businessInfo}
      >
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
