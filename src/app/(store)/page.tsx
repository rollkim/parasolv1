import { Fragment } from "react";
import Link from "next/link";

import { HeroBannerSlider } from "@/components/store/hero-banner";
import { ImagePlaceholder } from "@/components/store/image-placeholder";
import { StoreProductCard } from "@/components/store/product-card";
import { StripBanner } from "@/components/store/strip-banner";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { getHomeDisplay, type HomeSection } from "@/server/services/display.service";

/**
 * 스토어프론트 홈(메인) — 핸드오프 규격: 메인.dc.html L198~410.
 * 섹션 순서: 히어로 → 신뢰 스트립 → 진열 섹션들(첫 섹션 뒤에 띠배너) → 만든 사람들.
 * 배너·진열은 display.service에서 오고(관리자가 코드 수정 없이 구성 — 스펙서 §7),
 * 렌더 전략은 (store)/layout.tsx의 force-dynamic을 상속한다.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - 목업의 #pmstore(container-type:inline-size)를 이 페이지 래퍼의 @container로 재현 —
 *    cqw·@min-[...] 단위가 1280px 상한 컨테이너 기준으로 목업과 동일하게 동작한다
 *    (EmptyState가 세운 선례. 헤더·푸터는 뷰포트 md: 환산을 이미 택했으나 두 방식은
 *    래퍼 폭 ≈ 뷰포트 폭이라 1280px 미만에서 사실상 같은 지점에서 꺾인다).
 *  - 히어로·띠배너 0건이면 해당 섹션 자체를 렌더하지 않는다(목업 미규정 — 빈 껍데기 금지).
 *    카드 0건인 진열 섹션도 같은 이유로 건너뛴다. 띠배너 위치는 목업(큐레이션 뒤)을 따르되
 *    진열 섹션이 하나도 없으면 신뢰 스트립 뒤로 보낸다.
 *  - 베스트 섹션만 순위 뱃지(1~4위)를 강제한다 — 목업 renderVals와 동일(큐레이션 rank는 null).
 *  - 모바일 하단 바로가기 nav(+76px 스페이서)는 전 화면 공통 셸 요소라 이 페이지가 아니라
 *    (store) 셸에서 도입해야 한다 — 이번 범위에서 제외(배정 파일 제한).
 */

/** 목업 data-r=pad — 좌우 16px, 768px 이상 40px. 전 섹션이 공유한다 */
const SECTION_PAD_CLASS = "px-4 @min-[768px]:px-10";

/** 진열 종류별 '전체보기' 목적지 — getProductListPage의 sort 키와 맞춘다 */
const SECTION_MORE_HREF_BY_KIND: Record<string, string> = {
  new: "/products?sort=latest",
  best: "/products?sort=popular",
};

/*
 * 신뢰 스트립 — 목업 L240~258.
 * TODO(리스킨): '3만원 이상 무료배송' 임계값 등은 업체별 정책 문구라 site_setting(배송 정책)
 * 연동 시 데이터로 교체한다. 지금은 설정 스키마가 business_info뿐이라 상수로 보류(서비스 수정 금지 범위).
 */
const TRUST_STRIP_ITEMS = [
  {
    itemLabel: "3만원 이상 무료배송",
    itemIcon: (
      <>
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
        <circle cx="7" cy="18" r="1.6" />
        <circle cx="17.5" cy="18" r="1.6" />
      </>
    ),
  },
  {
    itemLabel: "정성 안심포장",
    itemIcon: (
      <>
        <path d="M3 8 12 4l9 4-9 4Z" />
        <path d="M3 8v8l9 4 9-4V8" />
      </>
    ),
  },
  {
    itemLabel: "보호작업장 직접 생산",
    itemIcon: (
      <>
        <path d="M12 3s7 2 7 8-3.5 8-7 10c-3.5-2-7-4-7-10 0-6 7-8 7-8Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  {
    itemLabel: "안전한 간편결제",
    itemIcon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </>
    ),
  },
];

export default async function StoreHomePage() {
  const { heroBanners, stripBanners, sections } = await getHomeDisplay(db);

  // 카드가 비어 있는 섹션은 헤더만 남는 빈 껍데기가 되므로 제외한다
  const visibleSections = sections.filter((homeSection) => homeSection.cards.length > 0);

  const stripBannerBlock =
    stripBanners.length > 0 ? (
      <section className={`${SECTION_PAD_CLASS} flex flex-col gap-3 py-2`}>
        {stripBanners.map((stripBanner) => (
          <StripBanner key={stripBanner.bannerId} stripBanner={stripBanner} />
        ))}
      </section>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-[1280px] @container">
      {/* ① 히어로 슬라이더 — 활성 배너가 없으면 섹션 자체를 그리지 않는다(다음 섹션이 자연스럽게 최상단) */}
      {heroBanners.length > 0 && (
        <section className={`${SECTION_PAD_CLASS} pt-4`}>
          <HeroBannerSlider heroBanners={heroBanners} />
        </section>
      )}

      {/* ② 신뢰 스트립 */}
      <section className={`${SECTION_PAD_CLASS} py-3.5`}>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 rounded-lg border border-border bg-card px-[18px] py-3.5">
          {TRUST_STRIP_ITEMS.map((trustItem) => (
            <div
              key={trustItem.itemLabel}
              className="flex items-center gap-2 text-[13px] font-semibold"
            >
              <svg
                width={19}
                height={19}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                className="text-primary"
                aria-hidden="true"
              >
                {trustItem.itemIcon}
              </svg>
              {trustItem.itemLabel}
            </div>
          ))}
        </div>
      </section>

      {/* ③⑤⑥ 진열 섹션 + ④ 띠배너(첫 진열 섹션 뒤 — 목업 위치) */}
      {visibleSections.map((homeSection, sectionIndex) => (
        <Fragment key={homeSection.sectionId}>
          <HomeSectionShelf homeSection={homeSection} />
          {sectionIndex === 0 && stripBannerBlock}
        </Fragment>
      ))}
      {visibleSections.length === 0 && stripBannerBlock}

      {/* ⑦ 만든 사람들 — 목업 L397~410. TODO(리스킨): 카피·링크는 브랜드 스토리 콘텐츠 확정 시 site_setting/CMS로 이관 */}
      <section className={`${SECTION_PAD_CLASS} py-[clamp(26px,5cqw,48px)]`}>
        <div className="grid gap-5 @min-[768px]:grid-cols-[1.05fr_0.95fr] @min-[768px]:items-center @min-[768px]:gap-11">
          <div className="relative aspect-[16/11] overflow-hidden rounded-lg bg-muted">
            <ImagePlaceholder className="absolute inset-0 h-full" />
          </div>
          <div className="flex flex-col gap-3.5">
            <div className="text-xs font-extrabold tracking-[0.06em] text-primary">MAKERS</div>
            <h3 className="font-heading text-[clamp(22px,3.2cqw,31px)] leading-[1.2] font-extrabold tracking-[-0.01em] whitespace-pre-line">
              {"각자의 속도로,\n매일 정성껏 만듭니다"}
            </h3>
            <p className="max-w-[52ch] text-[15px] leading-[1.75] text-muted-foreground">
              아침마다 반죽을 치대고, 오븐 앞에서 시간을 기다리는 사람들이 있습니다. 파라솔은 그
              결과물을 정직하게 전합니다 — 좋은 재료, 좋은 맛으로요.
            </p>
            <div>
              {/* TODO(라우트 미구현): 브랜드 스토리(/story) 페이지는 아직 없다 */}
              <Button asChild variant="outline" size="sm-46">
                <Link href="/story">이야기 더 보기 →</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/** 진열 섹션 1개 — 헤더(kicker·타이틀·전체보기) + 카드 그리드(2→3→4열). 베스트만 순위 뱃지 */
function HomeSectionShelf({ homeSection }: { homeSection: HomeSection }) {
  const sectionMoreHref = SECTION_MORE_HREF_BY_KIND[homeSection.sectionKind] ?? "/products";

  return (
    <section className={`${SECTION_PAD_CLASS} py-[clamp(26px,5cqw,48px)]`}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          {homeSection.kicker && (
            <div className="text-xs font-extrabold tracking-[0.06em] text-primary">
              {homeSection.kicker}
            </div>
          )}
          <h3 className="mt-[5px] font-heading text-[clamp(21px,3cqw,29px)] font-extrabold tracking-[-0.01em]">
            {homeSection.title}
          </h3>
        </div>
        <Link
          href={sectionMoreHref}
          className="text-[13px] font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-primary"
        >
          전체보기 →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 @min-[600px]:grid-cols-3 @min-[600px]:gap-4 @min-[1000px]:grid-cols-4 @min-[1000px]:gap-5">
        {homeSection.cards.map((productCard, cardIndex) => (
          <StoreProductCard
            key={productCard.productId}
            productCard={productCard}
            rankNumber={homeSection.sectionKind === "best" ? cardIndex + 1 : undefined}
          />
        ))}
      </div>
    </section>
  );
}
