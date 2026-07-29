import { cookies } from "next/headers";

import { LogoutButton } from "@/components/store/logout-button";
import { StoreFooter } from "@/components/store/store-footer";
import {
  STORE_ROUTE,
  StoreHeader,
  type StoreNavLink,
} from "@/components/store/store-header";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getCartItemCount } from "@/server/services/cart.service";
import { getStoreNavCategories } from "@/server/services/category.service";
import { getCustomerSessionProfile } from "@/server/services/customer.service";
import { getBusinessInfo } from "@/server/services/site-setting.service";
import { loadThemeSetting } from "@/server/services/theme.service";
import { CART_COOKIE_NAME } from "@/server/trpc/context";

/**
 * 스토어프론트 공통 레이아웃.
 * 헤더·푸터를 여기 한 번만 부착해 전 화면에 강제한다 —
 * 공통 푸터는 전자상거래 표시 의무라 화면별 선택 사항이 아니다(RULE-11).
 *
 * 업체 정보·카테고리는 여기서 1회 조회해 내려준다. 컴포넌트가 db를 직접
 * 임포트하면 레이어 경계가 무너지므로(RULE-14) 데이터는 항상 이 지점에서 주입한다.
 *
 * 렌더링 전략: 요청 시 렌더(force-dynamic)를 명시한다.
 * 선언이 없으면 빌드가 이 레이아웃을 정적으로 구우려고 빌드 시점에 DB를 읽는데,
 * CI(GitHub Actions)에는 DB 터널이 없어 빌드가 깨지고, 구워진 화면은 설정 변경을
 * 반영하지 못한다. 스펙서의 SSG·ISR 최적화는 런칭 준비(마감주) 때 캐시 계층과 함께 도입한다.
 */
export const dynamic = "force-dynamic";

export default async function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 헤더 카트 뱃지 — 쿠키의 비회원 카트 토큰으로 라인 수를 센다.
  // 담기·삭제 후에는 클라이언트가 router.refresh()로 이 레이아웃을 다시 렌더해 뱃지를 갱신한다.
  const cookieStore = await cookies();
  const cartToken = cookieStore.get(CART_COOKIE_NAME)?.value ?? null;

  // 헤더 유틸바의 로그인 상태 — 쿠키 해석만으로 끝내지 않고 프로필까지 확인해
  // 탈퇴·비활성 계정(쿠키는 유효)을 비로그인으로 취급한다(auth.sessionInfo와 동일 기준).
  const sessionCustomerId = await readSessionCustomerId();

  const [businessInfo, navCategories, cartItemCount, sessionProfile, themeSetting] =
    await Promise.all([
      getBusinessInfo(db),
      getStoreNavCategories(db),
      getCartItemCount(db, cartToken),
      sessionCustomerId !== null
        ? getCustomerSessionProfile(db, sessionCustomerId)
        : null,
      loadThemeSetting(db),
    ]);

  // 로그아웃은 링크가 아니라 동작이라 utilLinks가 아닌 트레일링 슬롯(LogoutButton)으로 배선한다
  const utilLinks: StoreNavLink[] = [
    { label: "고객센터", href: STORE_ROUTE.support },
    { label: "자주 묻는 질문", href: STORE_ROUTE.faq },
    ...(sessionProfile
      ? [{ label: "마이페이지", href: STORE_ROUTE.mypage }]
      : [
          { label: "로그인", href: STORE_ROUTE.login },
          { label: "회원가입", href: STORE_ROUTE.signup },
        ]),
  ];

  return (
    <ToastProvider>
      {/* 색 프리셋을 여기 한 번만 건다 — globals.css의 [data-theme]이 토큰을 갈아끼운다.
          컴포넌트가 각자 색을 고르지 않으므로(RULE-11) 이 한 줄이 전 화면을 바꾼다.
          관리자와 따로 정한다: 관리자는 오래 보는 업무 화면이라 브랜드 색이 강하면 눈이 피로하다 */}
      <div data-theme={themeSetting.storefront} className="flex min-h-full flex-col">
        <StoreHeader
          siteName={businessInfo.brandName}
          categories={navCategories}
          cartCount={cartItemCount}
          utilLinks={utilLinks}
          utilTrailing={sessionProfile ? <LogoutButton /> : undefined}
        />
        {/* id는 헤더의 '본문 바로가기' 앵커 목적지 — 함께 바뀌어야 한다 */}
        <main id="store-main" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <StoreFooter businessInfo={businessInfo} />
      </div>
    </ToastProvider>
  );
}
