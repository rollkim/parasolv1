"use client"

// 핸드오프 규격: 상품상세.dc.html L317~349(리뷰 요약 + 리뷰 목록) · 리뷰목록.dc.html
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 재구매율은 두지 않았다 — 재구매를 세려면 회원별 구매 이력 집계가 필요한데, 지금은
//    그 수치를 만들 근거가 없다. 없는 숫자를 그리면 고객이 그걸 보고 산다.
//  - 적립금 안내(사진 리뷰 +200원)는 빼놓았다. 적립금은 2차라 실제로 지급되지 않는다.
//  - 별점은 별 모양과 함께 숫자를 준다 — 모양만으로 전달하지 않는다(KWCAG).

import * as React from "react"

import Link from "next/link"

import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useTRPC } from "@/trpc/client"

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function RatingStars({ rating }: { rating: number }) {
  const rounded = Math.round(rating)
  return (
    <span className="text-sm">
      <span aria-hidden="true" className="text-primary">
        {"★".repeat(rounded)}
        <span className="text-muted-foreground">{"★".repeat(Math.max(0, 5 - rounded))}</span>
      </span>
      <span className="sr-only">5점 만점에 {rating}점</span>
    </span>
  )
}

export function ProductReviewPanel({ productId }: { productId: number }) {
  const trpc = useTRPC()
  const [photoOnly, setPhotoOnly] = React.useState(false)
  const [page, setPage] = React.useState(1)

  const reviewQuery = useQuery(
    trpc.review.listByProduct.queryOptions({ productId, page, photoOnly }),
  )

  if (reviewQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">리뷰를 불러오는 중입니다</span>
      </div>
    )
  }

  if (reviewQuery.isError || !reviewQuery.data) {
    return (
      <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
        리뷰를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  const reviews = reviewQuery.data
  const bucketTotal = Object.values(reviews.ratingBuckets).reduce((sum, value) => sum + value, 0)
  const ratingAverage =
    bucketTotal === 0
      ? 0
      : Math.round(
          (Object.entries(reviews.ratingBuckets).reduce(
            (sum, [score, bucketCount]) => sum + Number(score) * bucketCount,
            0,
          ) /
            bucketTotal) *
            10,
        ) / 10

  const lastPage = Math.max(1, Math.ceil(reviews.totalCount / reviews.pageSize))

  return (
    <div className="flex flex-col gap-5">
      {/* 요약 */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[var(--radius)] border border-border bg-card p-4">
        <div>
          <p className="m-0 font-heading text-3xl font-extrabold">
            {bucketTotal === 0 ? "-" : ratingAverage.toFixed(1)}
          </p>
          {/* 리뷰가 없는 것과 0점은 다르다 — 별을 그리면 "0점짜리 상품"으로 읽힌다 */}
          {bucketTotal === 0 ? (
            <span className="text-[13px] text-muted-foreground">아직 별점이 없어요</span>
          ) : (
            <RatingStars rating={ratingAverage} />
          )}
        </div>
        <div className="min-w-0 flex-1 text-[13px] text-muted-foreground">
          전체 리뷰 {bucketTotal}개 · 사진 리뷰 {reviews.photoReviewCount}개
        </div>
        {reviews.photoReviewCount > 0 ? (
          <Button
            type="button"
            variant="toggle"
            size="sm-44"
            aria-pressed={photoOnly}
            onClick={() => {
              setPhotoOnly((previous) => !previous)
              setPage(1)
            }}
          >
            사진 리뷰만
          </Button>
        ) : null}
      </div>

      {reviews.cards.length === 0 ? (
        <EmptyState
          size="inline"
          title={photoOnly ? "사진 리뷰가 아직 없어요" : "첫 리뷰를 기다리고 있어요"}
          description={
            photoOnly
              ? "사진 없이 남긴 리뷰는 위 버튼을 눌러 함께 볼 수 있어요."
              : "이 상품을 구매하시면 마이페이지에서 리뷰를 남기실 수 있어요."
          }
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {reviews.cards.map((reviewCard) => (
            <li key={reviewCard.reviewId} className="border-b border-border pb-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <RatingStars rating={reviewCard.rating} />
                <span className="text-[13px] font-semibold">{reviewCard.authorName}</span>
                <span className="text-[12px] text-muted-foreground">
                  {formatDate(reviewCard.createdAt)}
                </span>
                {reviewCard.optionLabel ? (
                  <span className="text-[12px] text-muted-foreground">
                    {reviewCard.optionLabel}
                  </span>
                ) : null}
              </div>

              {reviewCard.tagLabels.length > 0 ? (
                <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
                  {reviewCard.tagLabels.map((tagLabel) => (
                    <li
                      key={tagLabel}
                      className="rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-secondary-foreground"
                    >
                      {tagLabel}
                    </li>
                  ))}
                </ul>
              ) : null}

              {reviewCard.images.length > 0 ? (
                <ul className="m-0 mt-2.5 flex list-none gap-2 overflow-x-auto p-0">
                  {reviewCard.images.map((imagePath) => (
                    <li key={imagePath}>
                      {/* next/image는 원격 로더 설정이 필요해 일반 img를 쓴다 */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/uploads/${imagePath}`}
                        alt=""
                        loading="lazy"
                        className="size-24 shrink-0 rounded-[calc(var(--radius)-5px)] border border-border object-cover"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="m-0 mt-2.5 whitespace-pre-wrap text-sm leading-[1.8]">
                {reviewCard.content}
              </p>

              {reviewCard.adminReply ? (
                <div className="mt-3 rounded-[calc(var(--radius)-4px)] bg-muted p-3">
                  <p className="m-0 text-[12px] font-bold">판매자 답글</p>
                  <p className="m-0 mt-1 whitespace-pre-wrap text-[13px]">
                    {reviewCard.adminReply}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 ? (
        <nav aria-label="리뷰 페이지 이동" className="flex justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm-44"
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
            size="sm-44"
            disabled={page >= lastPage}
            onClick={() => setPage((previous) => Math.min(lastPage, previous + 1))}
          >
            다음
          </Button>
        </nav>
      ) : null}

      <p className="m-0 text-center text-[12px] text-muted-foreground">
        리뷰는 구매하신 분만 남길 수 있어요.{" "}
        <Link href="/mypage/reviews" className="underline underline-offset-2">
          마이페이지에서 리뷰 쓰기
        </Link>
      </p>
    </div>
  )
}
