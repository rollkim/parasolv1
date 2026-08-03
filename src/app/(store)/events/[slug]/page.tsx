import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StoreProductCard } from "@/components/store/product-card";
import { PromotionCountdown } from "@/components/store/promotion-countdown";
import { PromotionCouponStrip } from "@/components/store/promotion-coupon-strip";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { loadGradeRules } from "@/server/services/grade.service";
import { getStorePromotionDetail } from "@/server/services/promotion.service";

/**
 * 기획전 상세 — 핸드오프 '기획전.dc.html'.
 * 이벤트 히어로 · 카운트다운 · 쿠폰 스트립 · 상품 그리드 · 등급 혜택.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - '타임특가' 가격은 별도 특가 컬럼이 아니라 기존 판매가·정가 체계로 그린다(설계 결정 ① —
 *    special_price는 판매 단위(variant)와 어긋나 결제 경로에 잇지 않는다). 카드의 할인율
 *    표시는 StoreProductCard가 이미 한다.
 *  - 등급 혜택 티어는 목업의 고정 3단이 아니라 customer_grade 실데이터로 그린다 —
 *    관리자가 기준을 바꾸면 이 화면이 따라온다(하드코딩 금지, RULE-11).
 *  - 종료된 기획전도 연다(phase="ended" 표시) — 공유된 링크가 404가 되면 안 된다.
 */
export const dynamic = "force-dynamic";

type EventDetailPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: EventDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const detail = await getStorePromotionDetail(db, slug);
  return detail ? { title: detail.title } : {};
}

function formatPeriod(startsAt: Date | null, endsAt: Date | null): string {
  const fmt = (value: Date) =>
    new Date(value).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  if (startsAt && endsAt) return `${fmt(startsAt)} ~ ${fmt(endsAt)}`;
  if (endsAt) return `${fmt(endsAt)}까지`;
  if (startsAt) return `${fmt(startsAt)}부터`;
  return "상시 진행";
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const { slug } = await params;
  const detail = await getStorePromotionDetail(db, slug);
  if (!detail) notFound();

  const isMember = (await readSessionCustomerId()) !== null;
  // 등급 혜택 — 실데이터. 기준 낮은 순으로 "많이 살수록 커지는 혜택" 사다리를 그린다
  const gradeRules = [...(await loadGradeRules(db))].sort(
    (a, b) => a.minRecentSpend - b.minRecentSpend,
  );

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-14 md:px-10">
      {/* ── 이벤트 히어로 */}
      <section
        aria-labelledby="event-hero-heading"
        className="relative overflow-hidden rounded-lg bg-secondary"
      >
        {detail.heroImagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/uploads/${detail.heroImagePath}`}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : null}
        {/* 이미지 위 글자 가독 — 이미지가 없으면 secondary 배경이 그대로 남는다 */}
        <div className="relative bg-[color-mix(in_oklch,var(--background)_35%,transparent)] px-5 py-10 md:px-10 md:py-14">
          <p className="m-0 text-[13px] font-bold text-primary">
            {formatPeriod(detail.startsAt, detail.endsAt)}
          </p>
          <h1
            id="event-hero-heading"
            className="m-0 mt-1.5 font-heading text-[clamp(24px,4vw,40px)] font-extrabold"
          >
            {detail.title}
          </h1>
          {detail.description ? (
            <p className="m-0 mt-2 max-w-[560px] text-sm leading-relaxed text-foreground/80">
              {detail.description}
            </p>
          ) : null}

          <div className="mt-5">
            {detail.phase === "live" && detail.endsAt ? (
              <PromotionCountdown endsAtIso={new Date(detail.endsAt).toISOString()} />
            ) : detail.phase === "upcoming" ? (
              <p className="m-0 text-sm font-bold">아직 시작 전이에요 — 곧 열립니다</p>
            ) : detail.phase === "ended" ? (
              <p className="m-0 text-sm font-bold">종료된 기획전이에요</p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── 쿠폰 스트립 — 종료된 기획전에서는 받기를 보여주지 않는다 */}
      {detail.couponStrip && detail.phase === "live" ? (
        <div className="mt-4">
          <PromotionCouponStrip
            couponId={detail.couponStrip.couponId}
            couponName={detail.couponStrip.couponName}
            discountKind={detail.couponStrip.discountKind}
            discountValue={detail.couponStrip.discountValue}
            maxDiscountAmount={detail.couponStrip.maxDiscountAmount}
            minOrderAmount={detail.couponStrip.minOrderAmount}
            isMember={isMember}
            returnPath={`/events/${detail.slug}`}
          />
        </div>
      ) : null}

      {/* ── 상품 그리드 — 관리자가 정한 순서 그대로 */}
      <section aria-labelledby="event-products-heading" className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="event-products-heading" className="m-0 font-heading text-lg font-extrabold">
            기획전 상품
          </h2>
          <span className="text-[13px] text-muted-foreground">{detail.products.length}개</span>
        </div>
        <div className="grid grid-cols-2 gap-3 min-[600px]:grid-cols-3 min-[600px]:gap-4 min-[1080px]:grid-cols-4">
          {detail.products.map((productCard) => (
            <StoreProductCard key={productCard.productId} productCard={productCard} />
          ))}
        </div>
      </section>

      {/* ── 등급 혜택 — customer_grade 실데이터. 기준을 바꾸면 이 사다리가 따라온다 */}
      {gradeRules.length > 0 ? (
        <section aria-labelledby="event-grades-heading" className="mt-10">
          <h2 id="event-grades-heading" className="m-0 mb-3 font-heading text-lg font-extrabold">
            많이 살수록 커지는 혜택
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
            {gradeRules.map((gradeRule) => (
              <li
                key={gradeRule.gradeId}
                className="rounded-[var(--radius)] border border-border bg-card p-4"
              >
                <b className="block font-heading text-base font-extrabold text-primary">
                  {gradeRule.gradeName}
                </b>
                <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                  {gradeRule.minRecentSpend > 0
                    ? `최근 90일 ${gradeRule.minRecentSpend.toLocaleString()}원 이상`
                    : "가입만 해도"}
                </p>
                <p className="m-0 mt-1.5 text-sm font-bold">
                  {gradeRule.bonusRatePerMille > 0
                    ? `구매 적립 +${(gradeRule.bonusRatePerMille / 10)
                        .toFixed(1)
                        .replace(/\.0$/, "")}% 추가`
                    : "기본 적립 혜택"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
