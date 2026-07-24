// 핸드오프 규격: PaRaSOL 공지FAQ.dc.html 공지 목록 — h1 22px/800 · 목록 상단 border 2px foreground ·
// 행(고정 뱃지 11px/800 primary + 분류 뱃지 12px/700 muted + 제목 15px/600 + 날짜 13px muted + 셰브론) ·
// 본문 최대폭 820px · 페이지네이션
// [탭 순서] 1 로고 → 2 공지탭 → 3 FAQ탭 → 4 목록 (로고·탭은 공통 헤더/라우트 분리로 대체)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업의 공지/FAQ 탭은 라우트 분리(/notice · /support/faq)로 대체 — 헤더·푸터가 각각 직접 링크한다.
//  - 페이지네이션은 목업의 정적 [1,2,3] button+state가 아니라 서버 페이징 링크(getNoticePage) —
//    목업 스스로 PER 선언만 하고 미사용(데모 한계)이라 상품목록 페이지 규격(44px·화살표·aria-current)을 준용.
//  - 행 높이·간격은 목업(padding 18px 6px)을 따르되 행 전체가 링크라 터치 타겟 44px을 자연 충족한다.
//  - 조회수·작성자는 목업에 없어 표시하지 않는다(서비스는 내려주지만 화면 규격 밖).

import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { formatDateDot } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import { getNoticePage } from "@/server/services/board.service";

export const metadata: Metadata = { title: "공지사항" };

const NOTICE_PAGE_SIZE = 10;

/** 페이지네이션 공통 규격 — 44×44 터치 타겟(상품목록 페이지와 동일) */
const PAGE_ITEM_CLASS =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-sm px-1 text-sm font-semibold";

function noticeListHref(pageNumber: number): string {
  return pageNumber > 1 ? `/notice?page=${pageNumber}` : "/notice";
}

function PageArrowIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        d={direction === "prev" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type NoticeListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NoticeListPage({
  searchParams,
}: NoticeListPageProps) {
  const { page } = await searchParams;
  const parsedPage = Number.parseInt(
    (Array.isArray(page) ? page[0] : page) ?? "",
    10,
  );
  const requestedPage =
    Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;

  // 범위 초과 page는 마지막 페이지로 클램프 — 이때만 1회 재조회(상품목록 선례)
  const firstFetch = await getNoticePage(db, {
    page: requestedPage,
    pageSize: NOTICE_PAGE_SIZE,
  });
  const noticePage =
    requestedPage > firstFetch.totalPages
      ? await getNoticePage(db, {
          page: firstFetch.totalPages,
          pageSize: NOTICE_PAGE_SIZE,
        })
      : firstFetch;

  const pageNumbers = Array.from(
    { length: noticePage.totalPages },
    (_, pageIndex) => pageIndex + 1,
  );

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 mb-[18px] font-heading text-[22px] font-extrabold">
        공지사항
      </h1>

      {noticePage.totalCount === 0 ? (
        <EmptyState
          size="panel"
          icon={<span>📢</span>}
          iconSize={40}
          title="등록된 공지사항이 없어요"
          description="새로운 소식이 등록되면 이곳에서 안내드릴게요."
        />
      ) : (
        <ul className="m-0 list-none border-t-2 border-foreground p-0">
          {noticePage.notices.map((noticeItem) => (
            <li key={noticeItem.noticeId} className="border-b border-border">
              <Link
                href={`/notice/${noticeItem.noticeId}`}
                className="flex items-center gap-2.5 px-1.5 py-[18px] transition-colors hover:bg-muted md:gap-3.5"
              >
                {/* 고정은 색(뱃지)만이 아니라 '중요' 텍스트로 전달한다(KWCAG) */}
                {noticeItem.isPinned && (
                  <Badge
                    badgeTone="secondary"
                    badgeSize="xs"
                    badgeShape="tag"
                    className="bg-primary text-primary-foreground"
                  >
                    중요
                  </Badge>
                )}
                {noticeItem.categoryName && (
                  <Badge badgeTone="muted" badgeSize="md" badgeShape="tag">
                    {noticeItem.categoryName}
                  </Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                  {noticeItem.title}
                </span>
                <time
                  dateTime={noticeItem.createdAt.toISOString()}
                  className="shrink-0 text-[13px] text-muted-foreground"
                >
                  {formatDateDot(noticeItem.createdAt)}
                </time>
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
      )}

      {noticePage.totalPages > 1 && (
        <nav
          aria-label="페이지 이동"
          className="mt-[26px] flex flex-wrap items-center justify-center gap-1.5"
        >
          {noticePage.page > 1 ? (
            <Link
              href={noticeListHref(noticePage.page - 1)}
              aria-label="이전 페이지"
              className={cn(
                PAGE_ITEM_CLASS,
                "text-foreground transition-colors hover:bg-muted",
              )}
            >
              <PageArrowIcon direction="prev" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                PAGE_ITEM_CLASS,
                "cursor-not-allowed text-foreground opacity-40",
              )}
            >
              <PageArrowIcon direction="prev" />
            </span>
          )}

          {pageNumbers.map((pageNumber) =>
            pageNumber === noticePage.page ? (
              <span
                key={pageNumber}
                aria-current="page"
                className={cn(
                  PAGE_ITEM_CLASS,
                  "bg-primary text-primary-foreground",
                )}
              >
                {pageNumber}
              </span>
            ) : (
              <Link
                key={pageNumber}
                href={noticeListHref(pageNumber)}
                aria-label={`${pageNumber}페이지`}
                className={cn(
                  PAGE_ITEM_CLASS,
                  "text-foreground transition-colors hover:bg-muted",
                )}
              >
                {pageNumber}
              </Link>
            ),
          )}

          {noticePage.page < noticePage.totalPages ? (
            <Link
              href={noticeListHref(noticePage.page + 1)}
              aria-label="다음 페이지"
              className={cn(
                PAGE_ITEM_CLASS,
                "text-foreground transition-colors hover:bg-muted",
              )}
            >
              <PageArrowIcon direction="next" />
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                PAGE_ITEM_CLASS,
                "cursor-not-allowed text-foreground opacity-40",
              )}
            >
              <PageArrowIcon direction="next" />
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
