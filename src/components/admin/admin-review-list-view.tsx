"use client"

// 핸드오프 규격: 관리자 리뷰관리.dc.html — 별점/포토 필터 + 검색 + 리뷰 카드(신고 배너·
// 답글·숨김·신고 반려).
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **신고 배너에 실제 신고 사유를 보여준다.** 목업은 "광고/스팸 신고" 한 줄 요약인데,
//    반려할지 숨길지는 사유를 봐야 판단할 수 있다.
//  - **숨김 처리가 상품 별점에 즉시 반영된다**는 것을 문구로 밝힌다. 별점 1점짜리 스팸을
//    숨겼는데 평점이 그대로면 운영자는 숨김이 동작하지 않았다고 생각한다.
//  - 포토 필터는 두지 않았다 — 사진 유무는 카드에 이미 표시되고, 리뷰 수가 적을 때
//    필터가 하나 더 있으면 오히려 찾기 어렵다.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type ReviewTab = "all" | "reported" | "hidden" | "unanswered"

const REVIEW_TABS: { tab: ReviewTab; label: string }[] = [
  { tab: "all", label: "전체" },
  { tab: "reported", label: "신고" },
  { tab: "unanswered", label: "미답변" },
  { tab: "hidden", label: "숨김" },
]

const RATING_CHOICES = [5, 4, 3, 2, 1] as const

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

/** 별점 — 별 모양만으로 전달하지 않고 숫자를 함께 준다 */
function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="shrink-0 text-[13px]">
      <span aria-hidden="true" className="text-primary">
        {"★".repeat(rating)}
        <span className="text-muted-foreground">{"★".repeat(5 - rating)}</span>
      </span>
      <span className="ml-1 font-bold">{rating}점</span>
    </span>
  )
}

export function AdminReviewListView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = React.useState<ReviewTab>("all")
  const [rating, setRating] = React.useState(0)
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [replyDrafts, setReplyDrafts] = React.useState<Record<number, string>>({})

  const listQuery = useQuery(
    trpc.adminReview.list.queryOptions({
      tab: activeTab,
      rating,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )
  const replyMutation = useMutation(trpc.adminReview.reply.mutationOptions())
  const hiddenMutation = useMutation(trpc.adminReview.setHidden.mutationOptions())
  const dismissMutation = useMutation(trpc.adminReview.dismissReports.mutationOptions())

  const listResult = listQuery.data
  const lastPage = listResult
    ? Math.max(1, Math.ceil(listResult.totalCount / listResult.pageSize))
    : 1

  function refreshReviews() {
    void queryClient.invalidateQueries(trpc.adminReview.pathFilter())
  }

  function submitReply(reviewId: number, draft: string) {
    if (replyMutation.isPending) return
    replyMutation.mutate(
      { reviewId, reply: draft },
      {
        onSuccess: () => {
          showToast(draft.trim() ? "답글을 등록했어요." : "답글을 지웠어요.", {
            toastVariant: "info",
          })
          setReplyDrafts((previous) => {
            const next = { ...previous }
            delete next[reviewId]
            return next
          })
          refreshReviews()
        },
        onError: (replyError) => showToast(replyError.message, { toastVariant: "error" }),
      },
    )
  }

  function toggleHidden(reviewId: number, nextHidden: boolean) {
    if (hiddenMutation.isPending) return
    hiddenMutation.mutate(
      { reviewId, isHidden: nextHidden },
      {
        onSuccess: () => {
          showToast(
            nextHidden
              ? "리뷰를 숨겼어요. 상품 별점에서도 빠집니다."
              : "리뷰를 다시 노출했어요. 상품 별점에 다시 포함됩니다.",
            { toastVariant: "info" },
          )
          refreshReviews()
        },
        onError: (hiddenError) => showToast(hiddenError.message, { toastVariant: "error" }),
      },
    )
  }

  function dismissReports(reviewId: number) {
    if (dismissMutation.isPending) return
    dismissMutation.mutate(
      { reviewId },
      {
        onSuccess: (result) => {
          showToast(`신고 ${result.dismissedCount}건을 반려했어요.`, { toastVariant: "info" })
          refreshReviews()
        },
        onError: (dismissError) => showToast(dismissError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="리뷰 상태 필터" className="flex flex-wrap gap-2">
        {REVIEW_TABS.map((tabItem) => (
          <Button
            key={tabItem.tab}
            type="button"
            variant="toggle"
            size="admin-38"
            aria-pressed={activeTab === tabItem.tab}
            onClick={() => {
              setActiveTab(tabItem.tab)
              setPage(1)
            }}
          >
            {tabItem.label}
            {listResult ? (
              <span className="ml-1.5 text-[12px] font-bold opacity-70">
                {listResult.tabCounts[tabItem.tab]}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="별점 필터" className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="toggle"
            size="admin-38"
            aria-pressed={rating === 0}
            onClick={() => {
              setRating(0)
              setPage(1)
            }}
          >
            전체 별점
          </Button>
          {RATING_CHOICES.map((ratingChoice) => (
            <Button
              key={ratingChoice}
              type="button"
              variant="toggle"
              size="admin-38"
              aria-pressed={rating === ratingChoice}
              onClick={() => {
                setRating(ratingChoice)
                setPage(1)
              }}
            >
              {ratingChoice}점
              {listResult ? (
                <span className="ml-1 text-[12px] font-bold opacity-70">
                  {listResult.ratingCounts[ratingChoice]}
                </span>
              ) : null}
            </Button>
          ))}
        </div>

        <form
          role="search"
          className="ml-auto flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setAppliedKeyword(keywordInput.trim())
            setPage(1)
          }}
        >
          <Input
            size="admin"
            type="search"
            aria-label="리뷰 검색"
            placeholder="상품명·리뷰 내용"
            className="max-w-[260px]"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Button type="submit" variant="neutral-solid" size="admin-40">
            검색
          </Button>
        </form>
      </div>

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">리뷰 목록을 불러오는 중입니다</span>
        </div>
      ) : listQuery.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
          리뷰 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (listResult?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">⭐</span>}
          title="조건에 맞는 리뷰가 없어요"
          description="탭·별점 필터나 검색어를 바꿔 보세요."
        />
      ) : (
        <>
          <p className="m-0 text-[13px] text-muted-foreground">
            총 <b className="text-foreground">{listResult?.totalCount.toLocaleString("ko-KR")}</b>건
          </p>

          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {listResult?.cards.map((reviewCard) => {
              const draft = replyDrafts[reviewCard.reviewId]
              const isEditingReply = draft !== undefined
              return (
                <li
                  key={reviewCard.reviewId}
                  className={cn(
                    "rounded-[var(--radius)] border border-border bg-card p-4",
                    reviewCard.isHidden && "opacity-70",
                  )}
                >
                  {/* 신고 배너 — 사유를 보여준다. 반려할지 숨길지는 사유를 봐야 정한다 */}
                  {reviewCard.pendingReportReasons.length > 0 ? (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[calc(var(--radius)-4px)] border border-destructive bg-card p-2.5">
                      <span className="text-[12px] font-bold text-destructive">
                        신고 {reviewCard.reportCount}건
                      </span>
                      <span className="min-w-0 flex-1 text-[12px]">
                        {reviewCard.pendingReportReasons.join(" · ")}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="admin-38"
                        onClick={() => dismissReports(reviewCard.reviewId)}
                      >
                        신고 반려
                      </Button>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <RatingStars rating={reviewCard.rating} />
                    <Link
                      href={`/admin/products/${reviewCard.productId}`}
                      className="text-[13px] font-semibold underline-offset-2 hover:underline"
                    >
                      {reviewCard.productName}
                    </Link>
                    {reviewCard.isHidden ? (
                      <span className="rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
                        숨김
                      </span>
                    ) : null}
                    {reviewCard.imageCount > 0 ? (
                      <span className="rounded-[5px] bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-secondary-foreground">
                        사진 {reviewCard.imageCount}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[12px] text-muted-foreground">
                      {reviewCard.authorName} · {formatDate(reviewCard.createdAt)}
                    </span>
                  </div>

                  <p className="m-0 mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                    {reviewCard.content}
                  </p>

                  {reviewCard.adminReply && !isEditingReply ? (
                    <div className="mt-3 rounded-[calc(var(--radius)-4px)] bg-muted p-3">
                      <p className="m-0 text-[12px] font-bold">판매자 답글</p>
                      <p className="m-0 mt-1 whitespace-pre-wrap text-[13px]">
                        {reviewCard.adminReply}
                      </p>
                    </div>
                  ) : null}

                  {isEditingReply ? (
                    <form
                      className="mt-3 flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        submitReply(reviewCard.reviewId, draft)
                      }}
                    >
                      <Label htmlFor={`reply-${reviewCard.reviewId}`} className="sr-only">
                        답글
                      </Label>
                      <Textarea
                        id={`reply-${reviewCard.reviewId}`}
                        size="compact"
                        placeholder="고객에게 보일 답글을 입력하세요."
                        value={draft}
                        onChange={(event) =>
                          setReplyDrafts((previous) => ({
                            ...previous,
                            [reviewCard.reviewId]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" size="admin-38">
                          {replyMutation.isPending ? "저장 중…" : "답글 저장"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="admin-38"
                          onClick={() =>
                            setReplyDrafts((previous) => {
                              const next = { ...previous }
                              delete next[reviewCard.reviewId]
                              return next
                            })
                          }
                        >
                          취소
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="admin-38"
                        onClick={() =>
                          setReplyDrafts((previous) => ({
                            ...previous,
                            [reviewCard.reviewId]: reviewCard.adminReply ?? "",
                          }))
                        }
                      >
                        {reviewCard.adminReply ? "답글 수정" : "답글 달기"}
                      </Button>
                      <Button
                        type="button"
                        variant={reviewCard.isHidden ? "primary" : "destructive-outline"}
                        size="admin-38"
                        onClick={() => toggleHidden(reviewCard.reviewId, !reviewCard.isHidden)}
                      >
                        {reviewCard.isHidden ? "다시 노출" : "숨김 처리"}
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <p className="m-0 text-[12px] text-muted-foreground">
            숨긴 리뷰는 스토어에서 보이지 않고 상품 별점 계산에서도 빠집니다.
          </p>

          {lastPage > 1 ? (
            <nav aria-label="페이지 이동" className="flex justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                disabled={page <= 1}
                onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              >
                이전
              </Button>
              <span className="flex items-center px-2 text-[13px] text-muted-foreground">
                {page} / {lastPage}
              </span>
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                disabled={page >= lastPage}
                onClick={() => setPage((previous) => Math.min(lastPage, previous + 1))}
              >
                다음
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  )
}
