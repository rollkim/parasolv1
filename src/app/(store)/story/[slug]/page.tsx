// 핸드오프 규격: PaRaSOL 이야기.dc.html L156~201(상세 뷰) —
// 히어로 16/7 풀블리드 · 본문 최대폭 680px · 목록 돌아가기 · 분류 · h1 clamp(24,3.6cqw,34) ·
// 저자·날짜·읽는시간 메타줄(하단 border) · 본문 16px/1.9 · 관련 제품 카드 · 다른 이야기 3건
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업의 '이야기 목록' 버튼(상태 되돌리기)은 Link로 — 상세가 독립 URL이라 뒤로가기가 아니라 이동이다.
//  - 본문은 저장 시 서버가 살균한 HTML이다(html-sanitize.service). 씻는 자리를 저장 한 곳으로
//    못박아, 이 값을 쓰는 화면이 늘어도 잊을 자리가 없게 했다(상품 상세와 같은 규약).
//  - 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img (상품카드와 동일)

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ImagePlaceholder } from "@/components/store/image-placeholder";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { formatDateDot } from "@/lib/format-date";
import { getStoryDetail } from "@/server/services/article.service";
import { richTextToPlainText } from "@/server/services/html-sanitize.service";

type StoryDetailPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: StoryDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getStoryDetail(db, slug);
  if (!story) return { title: "이야기" };
  return {
    title: story.title,
    // 본문 첫 120자 — HTML을 그대로 넣으면 태그가 검색 결과에 노출된다
    description: richTextToPlainText(story.contentHtml).slice(0, 120) || undefined,
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

        {/* 본문은 **저장 시 서버가 이미 살균했다**(admin-story.service → html-sanitize.service).
            씻은 것만 DB에 들어가므로 여기서 다시 씻지 않는다 — 상품 상세와 같은 규약이다.
            태그별 여백·인용선은 여기서 준다(저장된 HTML에는 style이 없다, 살균이 버린다) */}
        <div
          className="text-base leading-[1.9] text-foreground [&_blockquote]:my-7 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary [&_blockquote]:py-1 [&_blockquote]:pl-5 [&_blockquote]:font-heading [&_blockquote]:text-[clamp(18px,2.4vw,22px)] [&_blockquote]:leading-[1.5] [&_blockquote]:font-extrabold [&_h2]:mt-8 [&_h2]:mb-3.5 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-extrabold [&_h3]:mt-6 [&_h3]:mb-2.5 [&_h3]:font-bold [&_img]:my-7 [&_img]:max-w-full [&_img]:rounded-[var(--radius)] [&_li]:mb-1 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-[22px] [&_p]:text-pretty [&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-primary [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: story.contentHtml }}
        />

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
