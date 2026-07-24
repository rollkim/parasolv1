import { StoreFooter } from "@/components/store/store-footer";
import { StoreHeader } from "@/components/store/store-header";
import { ToastProvider } from "@/components/ui/toast";
import { db } from "@/db";
import { getStoreNavCategories } from "@/server/services/category.service";
import { getBusinessInfo } from "@/server/services/site-setting.service";

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
  const [businessInfo, navCategories] = await Promise.all([
    getBusinessInfo(db),
    getStoreNavCategories(db),
  ]);

  return (
    <ToastProvider>
      <div className="flex min-h-full flex-col">
        <StoreHeader
          siteName={businessInfo.brandName}
          categories={navCategories}
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
