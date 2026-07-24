// 핸드오프 규격: PaRaSOL 공지FAQ.dc.html 공지 상세 — '목록으로'(셰브론 15px + 13px muted) ·
// 제목 블록(분류 뱃지 + 날짜 13px → h1 clamp(20,2.6cqw,26)/800 lh1.35, border-bottom) ·
// 본문 15px lh1.85 문단 · 하단 내비(44px 카드 버튼) · 본문 최대폭 820px
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - '이전 글/다음 글' 버튼 미구현 — board.service에 인접 글 조회가 없고 서비스 수정은 배정 밖.
//    '목록' 버튼만 배선한다(경계 토스트도 함께 보류).
//  - 컨테이너 쿼리(cqw)는 뷰포트 기준(vw)으로 환산(store-header 선례).
//  - 조회수 표시 없음(목업 미발견) — 열람 시 증가는 서비스가 원자적으로 처리한다.
//  - generateMetadata로 제목을 넣지 않는다 — getNoticeDetail이 조회수 증가를 겸해
//    메타데이터 조회로 한 열람이 두 번 세어지기 때문. 정적 타이틀을 쓴다.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { formatDateDot } from "@/lib/format-date";
import { getNoticeDetail } from "@/server/services/board.service";

export const metadata: Metadata = { title: "공지사항" };

type NoticeDetailPageProps = {
  params: Promise<{ postId: string }>;
};

export default async function NoticeDetailPage({
  params,
}: NoticeDetailPageProps) {
  const { postId } = await params;
  // parseInt는 "12abc"도 12로 통과시킨다 — 숫자 전체 일치만 유효한 주소로 본다
  if (!/^[0-9]+$/.test(postId)) notFound();

  const noticeDetail = await getNoticeDetail(db, Number.parseInt(postId, 10));
  // 없는 글·다른 게시판 글(비밀글 유출 방지 — 서비스가 boardId로 한정)은 404
  if (!noticeDetail) notFound();

  // 시드·관리자 작성 본문은 빈 줄(\n\n)이 문단 경계다 — 문단 <p>로 낭독 단위를 만든다
  const contentParagraphs = noticeDetail.content
    .split(/\n{2,}/)
    .filter((paragraphText) => paragraphText.trim().length > 0);

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-6 pb-14 md:px-10">
      <Link
        href="/notice"
        className="mb-2 inline-flex min-h-11 items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-primary"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        목록으로
      </Link>

      <header className="mb-5 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          {noticeDetail.categoryName && (
            <Badge badgeTone="muted" badgeSize="md" badgeShape="tag">
              {noticeDetail.categoryName}
            </Badge>
          )}
          <time
            dateTime={noticeDetail.createdAt.toISOString()}
            className="text-[13px] text-muted-foreground"
          >
            {formatDateDot(noticeDetail.createdAt)}
          </time>
        </div>
        <h1 className="m-0 mt-2.5 font-heading text-[clamp(20px,2.6vw,26px)] leading-[1.35] font-extrabold">
          {noticeDetail.title}
        </h1>
      </header>

      <div className="text-[15px] leading-[1.85]">
        {contentParagraphs.map((paragraphText, paragraphIndex) => (
          // 문단 순서가 곧 정체성 — 본문 수정 시 전체가 다시 그려지므로 index 키로 충분하다
          <p key={paragraphIndex} className="m-0 mb-4 whitespace-pre-line">
            {paragraphText}
          </p>
        ))}
      </div>

      <div className="mt-8 border-t border-border pt-4">
        <Button asChild variant="outline" size="sm-44">
          <Link href="/notice">목록</Link>
        </Button>
      </div>
    </div>
  );
}
