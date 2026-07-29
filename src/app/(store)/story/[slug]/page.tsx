// 핸드오프 규격: PaRaSOL 이야기.dc.html L156~201(상세 뷰) —
// 히어로 16/7 풀블리드 · 본문 최대폭 680px · 목록 돌아가기 · 분류 · h1 clamp(24,3.6cqw,34) ·
// 저자·날짜·읽는시간 메타줄(하단 border) · 본문 16px/1.9 · 관련 제품 카드 · 다른 이야기 3건
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업의 '이야기 목록' 버튼(상태 되돌리기)은 Link로 — 상세가 독립 URL이라 뒤로가기가 아니라 이동이다.
//  - 본문은 HTML이 아니라 블록 배열을 React로 그린다. 관리자 입력을 그대로 innerHTML에 넣으면
//    그 순간 XSS가 된다(상품 설명에서 descriptionHtml을 버린 것과 같은 이유).
//  - 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img (상품카드와 동일)

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ImagePlaceholder } from "@/components/store/image-placeholder";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { formatDateDot } from "@/lib/format-date";
import { getStoryDetail } from "@/server/services/article.service";

type StoryDetailPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: StoryDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getStoryDetail(db, slug);
  if (!story) return { title: "이야기" };
  return {
    title: story.title,
    // 첫 문단이 요약을 겸한다 — summary 컬럼은 목록 카드용이라 여기서 다시 읽지 않는다
    description:
      story.blocks.find((block) => block.blockKind === "paragraph")?.text.slice(0, 120) ??
      undefined,
  };
}

export default async function StoryDetailPage({ params }: StoryDetailPageProps) {
  const { slug } = await params;
  const story = await getStoryDetail(db, slug);
  if (!story) notFound();

  return (
    <article>
      {/* 히어로는 글의 분위기를 여는 장식이다 — 제목이 바로 아래 나오므로 alt는 비운다 */}
      <div className="relative aspect-[16/7] border-b border-border bg-muted">
        {story.coverImagePath ? (
          <img
            src={story.coverImagePath}
            alt=""
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <ImagePlaceholder className="absolute inset-0 h-full" />
        )}
      </div>

      <div className="mx-auto w-full max-w-[680px] px-4 pt-7 pb-14 md:px-10">
        <Link
          href="/story"
          className="mb-[18px] inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-[15px]"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          이야기 목록
        </Link>

        {story.categoryName && (
          <div className="mb-3 text-xs font-extrabold text-primary">
            {story.categoryName}
          </div>
        )}

        <h1 className="m-0 mb-3.5 font-heading text-[clamp(24px,3.6vw,34px)] leading-[1.25] font-extrabold tracking-[-0.01em] text-balance">
          {story.title}
        </h1>

        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-border pb-5 text-[13px] text-muted-foreground">
          {story.authorName && (
            <>
              <span>{story.authorName}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <time dateTime={story.publishedAt.toISOString()}>
            {formatDateDot(story.publishedAt)}
          </time>
          <span aria-hidden="true">·</span>
          <span>{story.readMinutes}분 분량</span>
        </div>

        <div className="text-base leading-[1.9] text-foreground">
          {story.blocks.map((block, blockIndex) => {
            // 블록은 순서가 곧 정체성이라 인덱스를 key로 쓴다(재정렬 없는 정적 렌더)
            switch (block.blockKind) {
              case "subheading":
                return (
                  <h2
                    key={blockIndex}
                    className="mt-8 mb-3.5 font-heading text-xl font-extrabold"
                  >
                    {block.text}
                  </h2>
                );
              case "quote":
                return (
                  <blockquote
                    key={blockIndex}
                    className="my-7 border-l-[3px] border-primary py-1 pl-5 font-heading text-[clamp(18px,2.4vw,22px)] leading-[1.5] font-extrabold text-foreground"
                  >
                    {block.text}
                  </blockquote>
                );
              case "image":
                return (
                  <figure key={blockIndex} className="my-7">
                    <div className="relative aspect-[3/2] overflow-hidden rounded-[var(--radius)] border border-border bg-muted">
                      {/* 캡션이 곧 대체텍스트 — 도메인 파서가 캡션 없는 이미지를 만들지 않는다 */}
                      <img
                        src={block.imagePath}
                        alt={block.caption}
                        className="absolute inset-0 size-full object-cover"
                      />
                    </div>
                    <figcaption className="mt-2 text-center text-xs text-muted-foreground">
                      {block.caption}
                    </figcaption>
                  </figure>
                );
              case "paragraph":
                return (
                  <p key={blockIndex} className="m-0 mb-[22px] text-pretty">
                    {block.text}
                  </p>
                );
            }
          })}
        </div>

        {story.relatedProduct && (
          <div className="mt-9 flex items-center gap-3.5 rounded-[var(--radius)] border border-border bg-card p-[18px]">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-[calc(var(--radius)-5px)] border border-border bg-muted">
              {story.relatedProduct.thumbnailPath ? (
                <img
                  src={story.relatedProduct.thumbnailPath}
                  alt={story.relatedProduct.thumbnailAlt ?? ""}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <ImagePlaceholder className="absolute inset-0 h-full" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">이 이야기의 제품</div>
              <div className="text-[15px] font-bold">{story.relatedProduct.name}</div>
            </div>
            <Button asChild variant="primary" size="sm-44">
              {/* 링크 이름만 '보러가기'면 목록에서 어느 상품인지 알 수 없다 — 상품명을 붙여 읽어준다 */}
              <Link
                href={`/products/${story.relatedProduct.slug}`}
                aria-label={`${story.relatedProduct.name} 보러가기`}
              >
                보러가기
              </Link>
            </Button>
          </div>
        )}

        {story.otherStories.length > 0 && (
          <div className="mt-10">
            <h2 className="m-0 mb-4 font-heading text-lg font-extrabold">다른 이야기</h2>
            <ul className="m-0 flex list-none flex-col p-0">
              {story.otherStories.map((otherStory) => (
                <li key={otherStory.slug} className="border-b border-border">
                  <Link
                    href={`/story/${otherStory.slug}`}
                    className="flex items-center gap-3.5 px-1.5 py-3 transition-colors hover:bg-muted"
                  >
                    <div className="relative h-[52px] w-16 shrink-0 overflow-hidden rounded-[calc(var(--radius)-6px)] border border-border bg-muted">
                      <ImagePlaceholder className="absolute inset-0 h-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {otherStory.categoryName && (
                        <div className="text-xs font-bold text-primary">
                          {otherStory.categoryName}
                        </div>
                      )}
                      <div className="text-sm leading-[1.4] font-bold">
                        {otherStory.title}
                      </div>
                    </div>
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4 shrink-0 text-muted-foreground"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}
