import { AdminPageTitle } from "@/components/admin/admin-page-title";
import { AdminShell } from "@/components/admin/admin-shell";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/db";
import { readAdminSessionUserId } from "@/server/auth/admin-session";
import { getAdminSessionProfile } from "@/server/services/admin-auth.service";
import { getBusinessInfo } from "@/server/services/site-setting.service";

/**
 * 관리자 공통 레이아웃.
 * 스토어프론트와 형제 라우트 그룹이라 헤더·푸터가 섞이지 않는다.
 *
 * 관리자는 공통 푸터 대신 셸 하단 미니 표기로 대체한다(스펙서 §3).
 * 관리자는 항상 요청 시 렌더(스펙서: 관리자 CSR) — 빌드 시 DB 접근도 함께 차단된다.
 *
 * **셸은 로그인한 뒤에만 붙인다.** 로그인 화면이 셸 안에 들어가면 로그인하지 않은 사람에게
 * 메뉴 구조(주문·상품·정산 등 운영 범위)가 그대로 노출된다. Next의 레이아웃은 중첩만 되고
 * 자식이 부모를 벗을 수 없으므로, 세션 유무로 이 레이아웃이 직접 분기한다.
 * 경로 가드(비로그인 → /admin/login 이동)는 middleware가 담당한다.
 */
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const adminUserId = await readAdminSessionUserId();
  if (adminUserId === null) {
    // 로그인 화면 — 셸 없이 children만. 다른 관리자 경로는 middleware가 이미 여기로 보냈다.
    return <ToastProvider>{children}</ToastProvider>;
  }

  const [businessInfo, adminProfile] = await Promise.all([
    getBusinessInfo(db),
    getAdminSessionProfile(db, adminUserId),
  ]);

  // 세션은 유효하지만 계정이 비활성됐다면 로그인 화면으로 되돌린다(셸을 붙이지 않는다)
  if (!adminProfile) {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <AdminShell
        siteName={businessInfo.brandName}
        pageTitle={<AdminPageTitle fallbackTitle="관리자" />}
        businessInfo={businessInfo}
        adminAccount={{ displayName: adminProfile.name, href: "/admin" }}
      >
        {children}
      </AdminShell>
    </ToastProvider>
  );
}
