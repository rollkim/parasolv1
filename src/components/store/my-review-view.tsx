"use client"

// 핸드오프 규격: 리뷰작성.dc.html(별점·만족도 태그·사진·본문) + 마이페이지 리뷰 목록.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 적립금 안내("사진 리뷰 +200원")를 빼놓았다 — 적립금은 2차라 실제로 지급되지 않는다.
//    지급되지도 않는 보상을 걸면 약속을 어기는 것이 된다.
//  - 별점은 라디오 그룹이다. 목업은 별 아이콘 클릭인데, 키보드만으로 점수를 고를 수 없다(KWCAG).
//  - 사진은 상품 이미지와 같은 업로드 경로를 쓴다(관리자 전용이 아니라 회원도 올린다).

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

const RATING_CHOICES = [5, 4, 3, 2, 1] as const

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function MyReviewView() {
  const trpc = useTRPC()
  const [writingOrderItemId, setWritingOrderItemId] = React.useState<number | null>(null)

  const reviewableQuery = useQuery(trpc.review.listReviewable.queryOptions())
  const mineQuery = useQuery(trpc.review.listMine.queryOptions())

  if (writingOrderItemId !== null) {
    return (
      <ReviewWriteForm
        orderItemId={writingOrderItemId}
        onDone={() => setWritingOrderItemId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="m-0 font-heading text-lg font-extrabold">리뷰 쓸 상품</h2>
        <p className="m-0 mt-1 text-[13px] text-muted-foreground">
          배송이 완료된 상품에 후기를 남기실 수 있어요.
        </p>

        {reviewableQuery.isPending ? (
          <div className="flex min-h-24 items-center justify-center" aria-busy="true">
            <Spinner />
            <span className="sr-only">불러오는 중입니다</span>
          </div>
        ) : (reviewableQuery.data?.length ?? 0) === 0 ? (
          <EmptyState
            size="inline"
            title="리뷰를 쓸 상품이 없어요"
            description="배송이 완료되면 이곳에서 후기를 남기실 수 있어요."
          />
        ) : (
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {reviewableQuery.data?.map((item) => (
              <li
                key={item.orderItemId}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5"
              >
                <span className="min-w-0 flex-1 text-sm">
                  <b className="font-semibold">{item.productName}</b>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {[item.optionLabel, item.orderNo].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="primary"
                  size="sm-44"
                  onClick={() => setWritingOrderItemId(item.orderItemId)}
                >
                  리뷰 쓰기
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="m-0 font-heading text-lg font-extrabold">내가 쓴 리뷰</h2>
        {mineQuery.isPending ? (
          <div className="flex min-h-24 items-center justify-center" aria-busy="true">
            <Spinner />
            <span className="sr-only">불러오는 중입니다</span>
          </div>
        ) : (mineQuery.data?.length ?? 0) === 0 ? (
          <EmptyState size="inline" title="아직 작성한 리뷰가 없어요" />
        ) : (
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {mineQuery.data?.map((myReview) => (
              <li
                key={myReview.reviewId}
                className="rounded-[var(--radius)] border border-border bg-card p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true" className="text-sm text-primary">
                    {"★".repeat(myReview.rating)}
                  </span>
                  <span className="text-[13px] font-bold">{myReview.rating}점</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {myReview.productName}
                  </span>
                  {/* 숨김 처리된 리뷰도 본인에게는 보인다 — 사라지면 왜 없는지 알 수 없다 */}
                  {myReview.isHidden ? (
                    <span className="rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
                      비공개 처리됨
                    </span>
                  ) : null}
                  <span className="text-[12px] text-muted-foreground">
                    {formatDate(myReview.createdAt)}
                  </span>
                </div>
                <p className="m-0 mt-2 whitespace-pre-wrap text-[13px] leading-[1.8] text-muted-foreground">
                  {myReview.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button variant="outline" size="md-48" className="self-start" asChild>
        <Link href="/mypage">마이페이지로</Link>
      </Button>
    </div>
  )
}

function ReviewWriteForm({
  orderItemId,
  onDone,
}: {
  orderItemId: number
  onDone: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const writeViewQuery = useQuery(trpc.review.writeView.queryOptions({ orderItemId }))
  const createMutation = useMutation(trpc.review.create.mutationOptions())

  const [rating, setRating] = React.useState(5)
  const [selectedTags, setSelectedTags] = React.useState<string[]>([])
  const [content, setContent] = React.useState("")
  const [images, setImages] = React.useState<string[]>([])
  const [isUploading, setIsUploading] = React.useState(false)

  async function uploadReviewImages(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || isUploading) return
    setIsUploading(true)
    try {
      const formData = new FormData()
      for (const file of Array.from(fileList).slice(0, 5)) formData.append("files", file)
      const response = await fetch("/api/reviews/images", { method: "POST", body: formData })
      const payload = (await response.json()) as { storedPaths?: string[]; message?: string }
      if (!response.ok) {
        showToast(payload.message ?? "사진을 올리지 못했습니다.", { toastVariant: "error" })
        return
      }
      setImages((previous) => [...previous, ...(payload.storedPaths ?? [])].slice(0, 5))
    } catch {
      showToast("사진을 올리지 못했습니다.", { toastVariant: "error" })
    } finally {
      setIsUploading(false)
    }
  }

  if (writeViewQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">리뷰 작성 화면을 불러오는 중입니다</span>
      </div>
    )
  }

  if (writeViewQuery.isError || !writeViewQuery.data) {
    return (
      <div className="py-10 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {writeViewQuery.error?.message ?? "리뷰를 작성할 수 없습니다."}
        </p>
        <Button variant="outline" size="md-48" className="mt-4" onClick={onDone}>
          목록으로
        </Button>
      </div>
    )
  }

  const writeView = writeViewQuery.data

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (createMutation.isPending) return
        createMutation.mutate(
          { orderItemId, rating, content: content.trim(), tags: selectedTags, images },
          {
            onSuccess: () => {
              showToast("리뷰를 등록했어요. 감사합니다!", { toastVariant: "info" })
              void queryClient.invalidateQueries(trpc.review.pathFilter())
              onDone()
            },
            onError: (createError) => showToast(createError.message, { toastVariant: "error" }),
          },
        )
      }}
    >
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5">
        <span className="min-w-0 flex-1 text-sm">
          <b className="font-semibold">{writeView.target.productName}</b>
          {writeView.target.optionLabel ? (
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {writeView.target.optionLabel}
            </span>
          ) : null}
        </span>
      </div>

      {/* 별점 — 키보드로도 고를 수 있어야 한다 */}
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-sm font-bold">별점 *</legend>
        <div className="flex flex-wrap gap-2">
          {RATING_CHOICES.map((ratingChoice) => (
            <Button
              key={ratingChoice}
              type="button"
              variant="toggle"
              size="sm-44"
              aria-pressed={rating === ratingChoice}
              onClick={() => setRating(ratingChoice)}
            >
              <span aria-hidden="true" className="text-primary">
                {"★".repeat(ratingChoice)}
              </span>
              <span className="ml-1">{ratingChoice}점</span>
            </Button>
          ))}
        </div>
      </fieldset>

      {writeView.tagOptions.length > 0 ? (
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-sm font-bold">
            만족한 점 <span className="font-normal text-muted-foreground">(선택)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {writeView.tagOptions.map((tagOption) => (
              <Button
                key={tagOption.code}
                type="button"
                variant="toggle"
                size="sm-44"
                aria-pressed={selectedTags.includes(tagOption.code)}
                onClick={() =>
                  setSelectedTags((previous) =>
                    previous.includes(tagOption.code)
                      ? previous.filter((code) => code !== tagOption.code)
                      : [...previous, tagOption.code].slice(0, 6),
                  )
                }
              >
                {tagOption.name}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="review-photos">
          사진 첨부 <span className="font-normal text-muted-foreground">(선택 · 최대 5장)</span>
        </Label>
        {images.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {images.map((imagePath) => (
              <li key={imagePath} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/uploads/${imagePath}`}
                  alt=""
                  className="size-20 rounded-[calc(var(--radius)-5px)] border border-border object-cover"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm-44"
                  className="absolute -top-1 -right-1 size-7 rounded-full p-0"
                  aria-label="사진 삭제"
                  onClick={() => setImages((previous) => previous.filter((p) => p !== imagePath))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          id="review-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          disabled={isUploading || images.length >= 5}
          className="text-[13px] file:mr-2 file:min-h-9 file:rounded-[calc(var(--radius)-4px)] file:border file:border-border file:bg-card file:px-3 file:text-[13px] file:font-bold"
          onChange={(event) => {
            void uploadReviewImages(event.target.files)
            event.target.value = ""
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-content">리뷰 내용 *</Label>
        <Textarea
          id="review-content"
          size="form"
          required
          minLength={10}
          placeholder="맛, 포장, 배송 등 다른 고객님께 도움이 될 후기를 남겨주세요. (최소 10자)"
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
        <p
          className={cn(
            "m-0 text-[12px]",
            content.trim().length < 10 ? "text-muted-foreground" : "text-primary",
          )}
        >
          {content.trim().length}자 / 최소 10자
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          size="md-48"
          disabled={createMutation.isPending || content.trim().length < 10}
        >
          {createMutation.isPending ? "등록 중…" : "리뷰 등록"}
        </Button>
        <Button type="button" variant="outline" size="md-48" onClick={onDone}>
          취소
        </Button>
      </div>
    </form>
  )
}
