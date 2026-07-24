import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthView } from "@/components/store/auth-view";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getCustomerSessionProfile } from "@/server/services/customer.service";
import { getBusinessInfo } from "@/server/services/site-setting.service";

/**
 * 로그인·회원가입 페이지 — 핸드오프 'PaRaSOL 로그인.dc.html'.
 * 서버 셸은 세션 확인·리다이렉트·siteName 주입만 하고,
 * 탭·폼·위저드는 클라이언트 컴포넌트(AuthView)가 tRPC로 수행한다.
 *
 * 회원가입 진입은 별도 라우트가 아니라 ?tab=signup — 헤더 '회원가입' 링크가 이 형태로 연결된다.
 */
export const metadata: Metadata = { title: "로그인" };

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // 이미 로그인된 '활성' 회원에게 로그인 화면은 무의미하다 — 홈으로.
  // 쿠키는 유효하지만 탈퇴·비활성인 계정은 재로그인이 필요하므로 리다이렉트하지 않는다.
  const sessionCustomerId = await readSessionCustomerId();
  if (sessionCustomerId !== null) {
    const sessionProfile = await getCustomerSessionProfile(db, sessionCustomerId);
    if (sessionProfile) redirect("/");
  }

  const { tab } = await searchParams;
  const initialAuthTab =
    (Array.isArray(tab) ? tab[0] : tab) === "signup" ? "signup" : "login";

  const businessInfo = await getBusinessInfo(db);

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 pt-8 pb-14 md:pt-12">
      <h1 className="sr-only">로그인 · 회원가입</h1>
      {/* key: 같은 라우트에서 ?tab만 바뀌어도(헤더 링크) 탭 상태가 따라가도록 remount */}
      <AuthView
        key={initialAuthTab}
        siteName={businessInfo.brandName}
        initialAuthTab={initialAuthTab}
      />
    </div>
  );
}
