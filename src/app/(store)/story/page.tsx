// 핸드오프 규격: PaRaSOL 이야기.dc.html L110~153(목록 뷰) —
// 본문 최대폭 960px · 인트로(h1 clamp(24,3.6cqw,32) + 리드문 520px) · 대표 스토리(16/10 + 1.15fr .85fr) ·
// 카테고리 칩 가로 스크롤 · 글 그리드(4/3 썸네일 + 분류 + 제목 + 발췌 + 날짜·읽는시간)
// [탭 순서] 목업 L99의 1 로고 → 2 카테고리 → 3 대표 스토리 → 4 글 카드를 DOM 순서로 구현
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업은 '전체' 포함 5칩 고정이지만, 여기서는 글이 실제로 있는 분류만 칩으로 낸다.
//    눌러도 빈 목록이 나오는 칩은 필터가 아니라 함정이다(상품목록 칩 규칙과 동일).
//  - 목업의 카드는 button + 상태 전환이지만 여기서는 Link — 이야기마다 고유 URL이 있어야
//    공유·검색이 된다(콘텐츠 페이지의 존재 이유).
//  - 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img (상품카드와 동일)

import type { Metadata } from "next";
import Link from "next/link";

import { ImagePlaceholder } from "@/components/store/image-placeholder";
import { db } from "@/db";
import { formatDateDot } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { getStoryListPage, type StoryCard } from "@/server/services/article.service";

export const metadata: Metadata = {
  title: "이야기",
  description: "제품 뒤에 있는 작업장의 하루, 만드는 사람, 재료 이야기를 기록합니다.",
};

function storyListHref(categoryCode: string | null): string {
  return categoryCode ? `/story?category=${categoryCode}` : "/story";
}

/** 날짜 · 읽는 시간 — 목록·상세가 같은 형식을 쓴다 */
function StoryMeta({
  publishedAt,
  readMinutes,
  categoryName,
  className,
}: {
  publishedAt: Date;
  readMinutes: number;
  categoryName?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      {categoryName && (
        <>
          {categoryName}
          <span aria-hidden="true"> · </span>
        </>
      )}
      <time dateTime={publishedAt.toISOString()}>{formatDateDot(publishedAt)}</time>
      <span aria-hidden="true"> · </span>
      {readMinutes}분 분량
    </div>
  );
}

function StoryCardLink({ storyCard }: { storyCard: StoryCard }) {
  return (
    <li>
      <Link
        href={`/story/${storyCard.slug}`}
        className="group block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <div className="relative mb-3 aspect-[4/3] overflow-hidden rounded-[calc(var(--radius)-2px)] border border-border bg-muted">
          {storyCard.coverImagePath ? (
            // 목록 썸네일의 대체텍스트는 바로 아래 제목과 같은 뜻이라 장식으로 둔다(중복 낭독 방지)
            <img
              src={storyCard.coverImagePath}
              alt=""
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <ImagePlaceholder className="absolute inset-0 h-full" />
          )}
        </div>
        {storyCard.categoryName && (
          <div className="mb-1.5 text-xs font-bold text-primary">
            {storyCard.categoryName}
          </div>
        )}
        <div className="mb-1.5 font-heading text-[17px] leading-[1.35] font-extrabold text-balance">
          {storyCard.title}
        </div>
        {storyCard.summary && (
          <p className="m-0 text-[13px] leading-[1.6] text-pretty text-muted-foreground">
            {storyCard.summary}
          </p>
        )}
        <StoryMeta
          publishedAt={storyCard.publishedAt}
          readMinutes={storyCard.readMinutes}
          className="mt-2.5"
        />
      </Link>
    </li>
  );
}

type StoryListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StoryListPage({ searchParams }: StoryListPageProps) {
  const { category } = await searchParams;
  const requestedCategory = Array.isArray(category) ? category[0] : category;

  const storyList = await getStoryListPage(db, {
    categoryCode: requestedCategory ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pt-[26px] pb-14 md:px-10">
      <div className="mb-[26px]">
        <h1 className="m-0 mb-2 font-heading text-[clamp(24px,3.6vw,32px)] font-extrabold tracking-[-0.01em]">
          만든 사람들의 이야기
        </h1>
        <p className="m-0 max-w-[520px] text-[15px] leading-[1.6] text-pretty text-muted-foreground">
          제품 뒤에 있는 작업장의 하루, 만드는 사람, 재료 이야기를 담담하게 기록합니다.
        </p>
      </div>

      {storyList.featured && (
        <Link
          href={`/story/${storyList.featured.slug}`}
          className="group mb-[34px] grid items-center gap-5 rounded-sm md:grid-cols-[1.15fr_0.85fr] md:gap-7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <div className="relative aspect-[16/10] overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
            {storyList.featured.coverImagePath ? (
              <img
                src={storyList.featured.coverImagePath}
                alt=""
                className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : (
              <ImagePlaceholder className="absolute inset-0 h-full" />
            )}
          </div>
          <div>
            <div className="mb-2.5 inline-flex items-center gap-1.5 text-xs font-extrabold text-primary">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              이달의 이야기
            </div>
            <h2 className="m-0 mb-2.5 font-heading text-[clamp(20px,2.8vw,26px)] leading-[1.3] font-extrabold text-balance">
              {storyList.featured.title}
            </h2>
            {storyList.featured.summary && (
              <p className="m-0 mb-3.5 text-sm leading-[1.7] text-pretty text-muted-foreground">
                {storyList.featured.summary}
              </p>
            )}
            <StoryMeta
              publishedAt={storyList.featured.publishedAt}
              readMinutes={storyList.featured.readMinutes}
              categoryName={storyList.featured.categoryName}
            />
          </div>
        </Link>
      )}

      {/* 좁힐 분류가 둘 이상일 때만 줄이 나온다 — 서비스가 그렇게 내려준다 */}
      {storyList.categoryChips.length > 0 && (
        <div
          role="group"
          aria-label="이야기 분류"
          className="-my-1 mb-[22px] flex gap-2 overflow-x-auto py-1"
        >
          {[
            { categoryCode: null, categoryName: "전체" },
            ...storyList.categoryChips,
          ].map((chip) => (
            <Link
              key={chip.categoryCode ?? "all"}
              href={storyListHref(chip.categoryCode)}
              aria-current={
                chip.categoryCode === storyList.activeCategoryCode ? "true" : undefined
              }
              className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-card px-[15px] text-[13px] font-semibold whitespace-nowrap text-foreground transition-colors hover:bg-muted aria-[current]:border-primary aria-[current]:bg-primary aria-[current]:text-primary-foreground"
            >
              {chip.categoryName}
            </Link>
          ))}
        </div>
      )}

      {storyList.cards.length === 0 && storyList.featured === null ? (
        <p className="m-0 py-16 text-center text-sm text-muted-foreground">
          아직 등록된 이야기가 없어요. 곧 작업장의 이야기를 전해 드릴게요.
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-x-5 gap-y-8 p-0 sm:grid-cols-2 md:grid-cols-3">
          {storyList.cards.map((storyCard) => (
            <StoryCardLink key={storyCard.slug} storyCard={storyCard} />
          ))}
        </ul>
      )}
    </div>
  );
}
