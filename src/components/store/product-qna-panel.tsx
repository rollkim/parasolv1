"use client"

// 핸드오프 규격: 상품상세.dc.html L351~369(문의 목록 + 상태 배지 + 문의하기)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **비밀글은 본문을 받지도 않는다.** 서버가 작성자에게만 내용을 내려준다 —
//    화면에서 가리는 방식은 응답을 열어보면 그대로 보여 비밀글이 아니게 된다.
//  - 비회원도 문의할 수 있게 이름·연락처·비밀번호를 받는다(1:1 문의와 같은 규칙).

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function ProductQnaPanel({
  productId,
  isMember,
}: {
  productId: number
  isMember: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [page, setPage] = React.useState(1)
  const [isWriting, setIsWriting] = React.useState(false)
  const [form, setForm] = React.useState({
    title: "",
    content: "",
    isSecret: false,
    guestName: "",
    guestPhone: "",
    guestPassword: "",
  })

  const listQuery = useQuery(trpc.support.productQna.list.queryOptions({ productId, page }))
  const createMutation = useMutation(trpc.support.productQna.create.mutationOptions())

  function submitQna(event: React.FormEvent) {
    event.preventDefault()
    if (createMutation.isPending) return
    createMutation.mutate(
      {
        productId,
        // 상품 문의 유형은 하나뿐이라 화면에서 고르게 하지 않는다
        categoryCode: "product",
        title: form.title.trim(),
        content: form.content.trim(),
        isSecret: form.isSecret,
        ...(isMember
          ? {}
          : {
              guestName: form.guestName.trim(),
              guestPhone: form.guestPhone.trim(),
              guestPassword: form.guestPassword,
            }),
      },
      {
        onSuccess: () => {
          showToast("문의를 남겼어요. 답변이 등록되면 알려드릴게요.", { toastVariant: "info" })
          setIsWriting(false)
          setForm({
            title: "",
            content: "",
            isSecret: false,
            guestName: "",
            guestPhone: "",
            guestPassword: "",
          })
          void queryClient.invalidateQueries(trpc.support.productQna.pathFilter())
        },
        onError: (createError) => showToast(createError.message, { toastVariant: "error" }),
      },
    )
  }

  const qnas = listQuery.data
  const lastPage = qnas ? Math.max(1, Math.ceil(qnas.totalCount / qnas.pageSize)) : 1

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4">
        <p className="m-0 min-w-0 flex-1 text-[13px] text-muted-foreground">
          상품에 대한 궁금한 점을 남겨 주세요. 비밀글로 문의하면 작성자와 판매자만 볼 수 있어요.
        </p>
        <Button
          type="button"
          variant={isWriting ? "outline" : "primary"}
          size="sm-44"
          onClick={() => setIsWriting((previous) => !previous)}
        >
          {isWriting ? "취소" : "상품 문의하기"}
        </Button>
      </div>

      {isWriting ? (
        <form
          className="flex flex-col gap-3 rounded-[var(--radius)] border border-primary bg-card p-4"
          onSubmit={submitQna}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qna-title">제목 *</Label>
            <Input
              id="qna-title"
              required
              maxLength={200}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qna-content">문의 내용 *</Label>
            <Textarea
              id="qna-content"
              size="compact"
              required
              placeholder="궁금한 점을 적어 주세요."
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          </div>

          {!isMember ? (
            <div className="flex flex-col gap-3 rounded-[calc(var(--radius)-4px)] bg-muted p-3">
              <p className="m-0 text-[12px] text-muted-foreground">
                비회원 문의는 답변 확인에 이름·연락처·비밀번호가 필요합니다.
              </p>
              <div className="flex flex-wrap gap-3">
                <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                  <Label htmlFor="qna-guest-name">이름 *</Label>
                  <Input
                    id="qna-guest-name"
                    required
                    value={form.guestName}
                    onChange={(event) => setForm({ ...form, guestName: event.target.value })}
                  />
                </div>
                <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
                  <Label htmlFor="qna-guest-phone">연락처 *</Label>
                  <Input
                    id="qna-guest-phone"
                    required
                    inputMode="numeric"
                    placeholder="010-1234-5678"
                    value={form.guestPhone}
                    onChange={(event) => setForm({ ...form, guestPhone: event.target.value })}
                  />
                </div>
                <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
                  <Label htmlFor="qna-guest-password">비밀번호 *</Label>
                  <Input
                    id="qna-guest-password"
                    required
                    type="password"
                    minLength={4}
                    value={form.guestPassword}
                    onChange={(event) => setForm({ ...form, guestPassword: event.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              aria-label="비밀글로 문의하기"
              checked={form.isSecret}
              onCheckedChange={(checked) => setForm({ ...form, isSecret: checked === true })}
            />
            비밀글로 문의하기
          </label>

          <Button
            type="submit"
            variant="primary"
            size="md-48"
            className="self-start"
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "등록 중…" : "문의 등록"}
          </Button>
        </form>
      ) : null}

      {listQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">문의를 불러오는 중입니다</span>
        </div>
      ) : (qnas?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="inline"
          title="아직 등록된 문의가 없어요"
          description="궁금한 점을 남겨 주시면 판매자가 답변해 드려요."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {qnas?.cards.map((qnaCard) => (
            <li key={qnaCard.qnaPostId} className="border-b border-border pb-4 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                    qnaCard.isAnswered
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {qnaCard.isAnswered ? "답변 완료" : "답변 대기"}
                </span>
                {qnaCard.isSecret ? (
                  <span className="text-[12px] text-muted-foreground">🔒 비밀글</span>
                ) : null}
                <span className="text-[12px] text-muted-foreground">
                  {qnaCard.authorName} · {formatDate(qnaCard.createdAt)}
                </span>
              </div>

              <p className="m-0 mt-2 text-sm font-semibold">{qnaCard.title}</p>
              {qnaCard.content ? (
                <p className="m-0 mt-1.5 whitespace-pre-wrap text-sm leading-[1.8] text-muted-foreground">
                  {qnaCard.content}
                </p>
              ) : (
                <p className="m-0 mt-1.5 text-[13px] text-muted-foreground">
                  작성자와 판매자만 볼 수 있는 문의입니다.
                </p>
              )}

              {qnaCard.answer ? (
                <div className="mt-3 rounded-[calc(var(--radius)-4px)] bg-secondary p-3">
                  <p className="m-0 text-[12px] font-extrabold text-secondary-foreground">
                    판매자 답변
                  </p>
                  <p className="m-0 mt-1 whitespace-pre-wrap text-[13px]">
                    {qnaCard.answer.content}
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 ? (
        <nav aria-label="문의 페이지 이동" className="flex justify-center gap-2">
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
    </div>
  )
}
