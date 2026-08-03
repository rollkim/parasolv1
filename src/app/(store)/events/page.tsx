import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { listStorePromotions } from "@/server/services/promotion.service";

/**
 * 기획전 목록 — 진행 중 + 예정, 종료 임박순.
 * 서버 렌더(SEO) — 기획전은 검색·공유로 유입되는 페이지다.
 */
export const metadata: Metadata = { title: "기획전" };
export const dynamic = "force-dynamic";

function formatPeriod(startsAt: Date | null, endsAt: Date | null): string {
  const fmt = (value: Date) =>
    new Date(value).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
  if (startsAt && endsAt) return `${fmt(startsAt)} ~ ${fmt(endsAt)}`;
  if (endsAt) return `${fmt(endsAt)}까지`;
  if (startsAt) return `${fmt(startsAt)}부터`;
  return "상시 진행";
}

export default async function EventsPage() {
  const promotions = await listStorePromotions(db);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 font-heading text-2xl font-extrabold">기획전</h1>

      {promotions.length === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          title="진행 중인 기획전이 없어요"
          description="새 기획전이 열리면 이곳에서 만나실 수 있어요."
          actions={[{ label: "전체 상품 보기", href: "/products" }]}
        />
      ) : (
        <ul className="m-0 mt-5 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
          {promotions.map((promotionCard) => (
            <li key={promotionCard.promotionId}>
              <Link
                href={`/events/${promotionCard.slug}`}
                className="block overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="relative aspect-[21/9] bg-muted">
                  {promotionCard.heroImagePath ? (
                    // 이미지 최적화(next/image)는 후속 — 상품 카드와 같은 방침
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${promotionCard.heroImagePath}`}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : null}
                  {/* 예정은 글자로 알린다 — 색만으로 구분하지 않는다(KWCAG) */}
                  {promotionCard.phase === "upcoming" ? (
                    <span className="absolute top-2.5 left-2.5 rounded-[5px] bg-foreground px-2 py-0.5 text-[12px] font-bold text-background">
                      오픈 예정
                    </span>
                  ) : null}
                </div>
                <div className="p-4">
                  <b className="block font-heading text-lg font-extrabold">
                    {promotionCard.title}
                  </b>
                  {promotionCard.description ? (
                    <p className="m-0 mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                      {promotionCard.description}
                    </p>
                  ) : null}
                  <p className="m-0 mt-2 text-[12px] font-semibold text-muted-foreground">
                    {formatPeriod(promotionCard.startsAt, promotionCard.endsAt)} · 상품{" "}
                    {promotionCard.productCount}개
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
