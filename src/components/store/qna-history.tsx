"use client"

// 1:1 문의 내역 — 회원은 세션으로 바로, 비회원은 연락처+비밀번호(주문조회와 같은 2요소).
// 이 화면이 없던 동안 문의는 "보내면 끝"이었다 — 답변이 달려도 고객이 볼 곳이 없었다.

import * as React from "react"

import { useMutation, useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { useTRPC } from "@/trpc/client"

type QnaHistoryCard = {
  qnaPostId: number
  title: string
  content: string
  isAnswered: boolean
  answer: { content: string; createdAt: Date } | null
  createdAt: Date
}

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function QnaCardList({ cards }: { cards: QnaHistoryCard[] }) {
  if (cards.length === 0) {
    return (
      <EmptyState
        size="section"
        stateTone="neutral"
        headingLevel={3}
        title="문의 내역이 없어요"
        description="궁금한 점이 있으시면 문의하기 탭에서 남겨 주세요."
      />
    )
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {cards.map((card) => (
        <li
          key={card.qnaPostId}
          className="rounded-[var(--radius)] border border-border bg-card p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            {/* 상태는 색이 아니라 글자로(KWCAG) */}
            <span
              className={
                card.isAnswered
                  ? "rounded-[5px] border border-primary px-1.5 py-0.5 text-[11px] font-bold text-primary"
                  : "rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground"
              }
            >
              {card.isAnswered ? "답변 완료" : "답변 대기"}
            </span>
            <b className="min-w-0 flex-1 truncate text-sm font-bold">{card.title}</b>
            <span className="text-[12px] text-muted-foreground">{formatDate(card.createdAt)}</span>
          </div>
          <p className="m-0 mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {card.content}
          </p>
          {card.answer ? (
            <div className="mt-3 rounded-[calc(var(--radius)-2px)] bg-secondary px-3.5 py-3">
              <b className="text-[12px] font-extrabold text-secondary-foreground">답변</b>
              <p className="m-0 mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
                {card.answer.content}
              </p>
              <span className="mt-1 block text-[11px] text-secondary-foreground/70">
                {formatDate(card.answer.createdAt)}
              </span>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** 회원 — 세션이 곧 인증. 진입 즉시 목록 */
function MemberHistory() {
  const trpc = useTRPC()
  const listQuery = useQuery(trpc.support.qna.listMine.queryOptions())

  if (listQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">문의 내역을 불러오는 중입니다</span>
      </div>
    )
  }
  return <QnaCardList cards={listQuery.data ?? []} />
}

/** 비회원 — 연락처 + 작성 시 비밀번호를 맞혀야 열린다 */
function GuestHistory() {
  const trpc = useTRPC()
  const { showToast } = useToast()
  const lookupMutation = useMutation(trpc.support.qna.guestLookup.mutationOptions())

  const [phoneInput, setPhoneInput] = React.useState("")
  const [passwordInput, setPasswordInput] = React.useState("")
  const [cards, setCards] = React.useState<QnaHistoryCard[] | null>(null)

  function handleLookup() {
    if (lookupMutation.isPending) return
    lookupMutation.mutate(
      { guestPhone: phoneInput, guestPassword: passwordInput },
      {
        onSuccess: (foundCards) => {
          setCards(foundCards)
          if (foundCards.length === 0) {
            // 번호·비밀번호 불일치와 "문의 없음"을 구분해 주지 않는다 —
            // 구분해 주면 남의 번호로 문의 존재 여부를 알아낼 수 있다
            showToast("문의를 찾지 못했어요. 연락처와 비밀번호를 확인해 주세요.", {
              toastVariant: "info",
            })
          }
        },
        onError: (lookupError) => showToast(lookupError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault()
          handleLookup()
        }}
      >
        <p className="m-0 text-[13px] text-muted-foreground">
          문의하실 때 입력한 휴대폰 번호와 비밀번호로 확인할 수 있어요.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qna-lookup-phone" required>
            휴대폰 번호
          </Label>
          <Input
            id="qna-lookup-phone"
            type="tel"
            autoComplete="tel"
            placeholder="'-' 없이 숫자만"
            value={phoneInput}
            onChange={(event) => setPhoneInput(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="qna-lookup-password" required>
            비밀번호
          </Label>
          <Input
            id="qna-lookup-password"
            type="password"
            autoComplete="off"
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size="sm-44"
          className="self-start"
          aria-disabled={lookupMutation.isPending}
        >
          {lookupMutation.isPending ? "확인 중…" : "문의 확인"}
        </Button>
      </form>

      {cards !== null && cards.length > 0 ? <QnaCardList cards={cards} /> : null}
    </div>
  )
}

export function QnaHistory({ isMember }: { isMember: boolean }) {
  return isMember ? <MemberHistory /> : <GuestHistory />
}
