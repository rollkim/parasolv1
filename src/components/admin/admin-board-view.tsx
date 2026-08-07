"use client"

// 핸드오프 규격: 관리자 게시판.dc.html — 공지사항 / FAQ / 1:1 문의 3탭.
// 각 탭이 목록 ↔ 편집(또는 답변) 두 모드를 오간다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 비회원 문의 상세에 **연락처를 보여준다.** 비회원에게는 회신 수단이 그것뿐이라
//    답변만 달아두면 고객이 다시 들어와 확인하지 않는 한 전달되지 않는다.
//  - 문의 목록을 **미답변 먼저** 정렬한다. 대기열 화면이라 오래된 미답변이 묻히면 안 된다.
//  - 답변 삭제 시 '미답변'으로 되돌아간다는 것을 안내한다 — 뱃지와 내용이 어긋나면
//    운영자가 답변을 두 번 단다.

import * as React from "react"

import Link from "next/link"

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

/**
 * 게시판 = 운영자가 **쓰는** 글(공지·FAQ).
 * 고객이 쓰고 운영자가 답하는 문의는 /admin/inquiries로 갈랐다 — 하는 일이 반대라
 * 한 화면에 묶으면 "답변 대기"를 공지 옆에서 찾게 된다.
 */
export type BoardTab = "notice" | "faq"

const BOARD_TABS: { tab: BoardTab; label: string }[] = [
  { tab: "notice", label: "공지사항" },
  { tab: "faq", label: "FAQ" },
]

/** 문의 종류 — 상품 문의는 어느 상품인지, 1:1은 유형이 핵심이라 화면을 나눈다 */
export type InquiryKind = "product" | "direct" | "bulk"

const INQUIRY_TABS: { kind: InquiryKind; label: string }[] = [
  { kind: "product", label: "상품 문의" },
  { kind: "direct", label: "1:1 문의" },
  { kind: "bulk", label: "단체구매 문의" },
]

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

/**
 * 탭을 URL 세그먼트로 둔다(/admin/boards/{tab}) — 사이드바가 하위 메뉴로 직접 링크하고,
 * 새로고침·뒤로가기가 같은 탭으로 돌아온다.
 */
export function AdminBoardView({ activeTab }: { activeTab: BoardTab }) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="게시판 선택" className="flex flex-wrap gap-2">
        {BOARD_TABS.map((tabItem) => (
          <Button
            key={tabItem.tab}
            variant="toggle"
            size="admin-40"
            aria-current={activeTab === tabItem.tab ? "page" : undefined}
            aria-pressed={activeTab === tabItem.tab}
            asChild
          >
            <Link href={`/admin/boards/${tabItem.tab}`}>{tabItem.label}</Link>
          </Button>
        ))}
      </nav>

      {activeTab === "notice" ? <NoticePanel /> : null}
      {activeTab === "faq" ? <FaqPanel /> : null}
    </div>
  )
}

/** 문의 관리(CS) — 상품 문의 · 1:1 문의 · 단체구매 문의 */
export function AdminInquiryView({
  activeKind,
  openPostId = null,
}: {
  activeKind: InquiryKind
  /** ?post=<id> — 대시보드에서 특정 문의로 바로 들어온 경우 */
  openPostId?: number | null
}) {
  const trpc = useTRPC()
  const waitingQuery = useQuery(trpc.adminBoard.waitingQnaCount.queryOptions())

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="문의 종류 선택" className="flex flex-wrap gap-2">
        {INQUIRY_TABS.map((tabItem) => (
          <Button
            key={tabItem.kind}
            variant="toggle"
            size="admin-40"
            aria-current={activeKind === tabItem.kind ? "page" : undefined}
            aria-pressed={activeKind === tabItem.kind}
            asChild
          >
            <Link href={`/admin/inquiries/${tabItem.kind}`}>
              {tabItem.label}
              {tabItem.kind === "direct" && (waitingQuery.data ?? 0) > 0 ? (
                <span className="ml-1.5 text-[12px] font-bold text-destructive">
                  {waitingQuery.data}
                </span>
              ) : null}
            </Link>
          </Button>
        ))}
      </nav>

      {/* key로 종류를 묶어 새로 마운트한다 — 이전 종류의 페이지·검색어·열린 문의가 남으면
          빈 목록이 나온다. useEffect로 상태를 되돌리면 한 번 잘못 그린 뒤에 고치는 셈이다 */}
      {activeKind === "product" ? (
        <QnaPanel key="product" inquiryKind="product" initialOpenPostId={openPostId} />
      ) : null}
      {activeKind === "direct" ? (
        <QnaPanel key="direct" inquiryKind="direct" initialOpenPostId={openPostId} />
      ) : null}
      {activeKind === "bulk" ? <BulkInquiryPanel /> : null}
    </div>
  )
}

// =============================================================
// 공지사항
// =============================================================

/** 편집칸은 마운트 시점의 값으로 시작한다 — 부모가 데이터 도착 후에만 그린다 */
function NoticeEditorForm({
  postId,
  initialTitle,
  initialContent,
  initialIsPinned,
  isSaving,
  onSubmit,
  onCancel,
}: {
  postId: number | null
  initialTitle: string
  initialContent: string
  initialIsPinned: boolean
  isSaving: boolean
  onSubmit: (values: {
    postId: number | null
    title: string
    content: string
    isPinned: boolean
  }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = React.useState(initialTitle)
  const [content, setContent] = React.useState(initialContent)
  const [isPinned, setIsPinned] = React.useState(initialIsPinned)

  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (isSaving) return
        onSubmit({ postId, title: title.trim(), content: content.trim(), isPinned })
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notice-title">제목 *</Label>
        <Input
          id="notice-title"
          size="admin"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notice-content">내용 *</Label>
        <Textarea
          id="notice-content"
          size="form"
          required
          placeholder="공지 내용을 입력하세요."
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <Checkbox
          aria-label="목록 상단에 고정"
          checked={isPinned}
          onCheckedChange={(checked) => setIsPinned(checked === true)}
        />
        목록 상단에 고정
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="admin-40" disabled={isSaving}>
          {isSaving ? "저장 중…" : "저장"}
        </Button>
        <Button type="button" variant="outline" size="admin-40" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  )
}

function NoticePanel() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [editingPostId, setEditingPostId] = React.useState<number | null | "none">("none")

  const listQuery = useQuery(
    trpc.adminBoard.listNotices.queryOptions({ keyword: appliedKeyword || undefined, page }),
  )
  const saveMutation = useMutation(trpc.adminBoard.saveNotice.mutationOptions())
  const deleteMutation = useMutation(trpc.adminBoard.deletePost.mutationOptions())

  const editQuery = useQuery({
    ...trpc.adminBoard.getNotice.queryOptions({
      postId: typeof editingPostId === "number" ? editingPostId : 0,
    }),
    enabled: typeof editingPostId === "number",
  })

  function openEditor(postId: number | null) {
    setEditingPostId(postId)
  }

  function refreshNotices() {
    void queryClient.invalidateQueries(trpc.adminBoard.pathFilter())
  }

  if (editingPostId !== "none") {
    // 기존 글은 값이 도착한 뒤에만 편집기를 마운트한다 — 빈 폼을 그렸다가 effect로
    // 밀어넣으면 연쇄 렌더가 나고, 입력 중에 서버 값이 덮어쓸 여지도 생긴다
    const isLoadingExisting = typeof editingPostId === "number" && editQuery.isPending
    return (
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <Button
          type="button"
          variant="ghost"
          size="admin-38"
          onClick={() => setEditingPostId("none")}
        >
          ← 공지 목록
        </Button>

        {isLoadingExisting ? (
          <div className="flex min-h-32 items-center justify-center" aria-busy="true">
            <Spinner />
            <span className="sr-only">공지를 불러오는 중입니다</span>
          </div>
        ) : (
          <NoticeEditorForm
            key={editingPostId ?? "new"}
            postId={typeof editingPostId === "number" ? editingPostId : null}
            initialTitle={editQuery.data?.title ?? ""}
            initialContent={editQuery.data?.content ?? ""}
            initialIsPinned={editQuery.data?.isPinned ?? false}
            isSaving={saveMutation.isPending}
            onCancel={() => setEditingPostId("none")}
            onSubmit={(values) =>
              saveMutation.mutate(values, {
                onSuccess: () => {
                  showToast("공지를 저장했어요.", { toastVariant: "info" })
                  setEditingPostId("none")
                  refreshNotices()
                },
                onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
              })
            }
          />
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setAppliedKeyword(keywordInput.trim())
            setPage(1)
          }}
        >
          <Input
            size="admin"
            type="search"
            aria-label="공지 검색"
            placeholder="공지 제목 검색"
            className="max-w-[260px]"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Button type="submit" variant="neutral-solid" size="admin-40">
            검색
          </Button>
        </form>
        <Button
          type="button"
          variant="primary"
          size="admin-40"
          className="ml-auto"
          onClick={() => openEditor(null)}
        >
          + 공지 작성
        </Button>
      </div>

      {listQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">공지를 불러오는 중입니다</span>
        </div>
      ) : (listQuery.data?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">📢</span>}
          title="등록된 공지가 없어요"
          description="공지를 작성해 스토어에 알려 보세요."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {listQuery.data?.cards.map((notice) => (
            <li
              key={notice.postId}
              // 모바일은 세로 스택, md 이상에서 한 줄(제목이 min-w-0이라 눌리면 세로로 쪼개진다)
              className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-border bg-card p-3.5 md:flex-row md:flex-wrap md:items-center md:gap-3"
            >
              <span className="flex min-w-0 items-start gap-2 md:contents">
                {notice.isPinned ? (
                  <span className="shrink-0 rounded-[5px] border border-primary px-1.5 py-0.5 text-[11px] font-bold text-primary">
                    고정
                  </span>
                ) : null}
                <span className="min-w-0 text-sm font-semibold md:flex-1">{notice.title}</span>
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                조회 {notice.viewCount} · {formatDate(notice.createdAt)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                onClick={() => openEditor(notice.postId)}
              >
                수정
              </Button>
              <Button
                type="button"
                variant="destructive-outline"
                size="admin-38"
                onClick={() =>
                  deleteMutation.mutate(
                    { postId: notice.postId },
                    {
                      onSuccess: () => {
                        showToast("공지를 삭제했어요.", { toastVariant: "info" })
                        refreshNotices()
                      },
                      onError: (deleteError) =>
                        showToast(deleteError.message, { toastVariant: "error" }),
                    },
                  )
                }
              >
                삭제
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// =============================================================
// FAQ — title이 질문, content가 답변
// =============================================================

function FaqPanel() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const listQuery = useQuery(trpc.adminBoard.listFaqs.queryOptions({}))
  const saveMutation = useMutation(trpc.adminBoard.saveFaq.mutationOptions())
  const deleteMutation = useMutation(trpc.adminBoard.deletePost.mutationOptions())

  const [editing, setEditing] = React.useState<
    { postId: number | null; categoryCode: string | null; question: string; answer: string } | null
  >(null)

  function refreshFaqs() {
    void queryClient.invalidateQueries(trpc.adminBoard.pathFilter())
  }

  if (editing) {
    return (
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <Button type="button" variant="ghost" size="admin-38" onClick={() => setEditing(null)}>
          ← FAQ 목록
        </Button>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (saveMutation.isPending) return
            saveMutation.mutate(
              {
                postId: editing.postId,
                categoryCode: editing.categoryCode,
                question: editing.question.trim(),
                answer: editing.answer.trim(),
              },
              {
                onSuccess: () => {
                  showToast("FAQ를 저장했어요.", { toastVariant: "info" })
                  setEditing(null)
                  refreshFaqs()
                },
                onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
              },
            )
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="faq-category">분류</Label>
            <select
              id="faq-category"
              className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
              value={editing.categoryCode ?? ""}
              onChange={(event) =>
                setEditing({ ...editing, categoryCode: event.target.value || null })
              }
            >
              <option value="">분류 없음</option>
              {listQuery.data?.categoryOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="faq-question">질문 *</Label>
            <Input
              id="faq-question"
              size="admin"
              required
              value={editing.question}
              onChange={(event) => setEditing({ ...editing, question: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="faq-answer">답변 *</Label>
            <Textarea
              id="faq-answer"
              size="form"
              required
              placeholder="답변 내용"
              value={editing.answer}
              onChange={(event) => setEditing({ ...editing, answer: event.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="admin-40" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button type="button" variant="outline" size="admin-40" onClick={() => setEditing(null)}>
              취소
            </Button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="primary"
        size="admin-40"
        className="self-end"
        onClick={() => setEditing({ postId: null, categoryCode: null, question: "", answer: "" })}
      >
        + FAQ 추가
      </Button>

      {listQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">FAQ를 불러오는 중입니다</span>
        </div>
      ) : (listQuery.data?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">❓</span>}
          title="등록된 FAQ가 없어요"
          description="자주 묻는 질문을 미리 등록하면 문의가 줄어듭니다."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {listQuery.data?.cards.map((faq) => (
            <li key={faq.postId} className="rounded-[var(--radius)] border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                {faq.categoryName ? (
                  <span className="shrink-0 rounded-[5px] bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-secondary-foreground">
                    {faq.categoryName}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 text-sm font-semibold">{faq.question}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="admin-38"
                  onClick={() =>
                    setEditing({
                      postId: faq.postId,
                      categoryCode: faq.categoryCode,
                      question: faq.question,
                      answer: faq.answer,
                    })
                  }
                >
                  수정
                </Button>
                <Button
                  type="button"
                  variant="destructive-outline"
                  size="admin-38"
                  onClick={() =>
                    deleteMutation.mutate(
                      { postId: faq.postId },
                      {
                        onSuccess: () => {
                          showToast("FAQ를 삭제했어요.", { toastVariant: "info" })
                          refreshFaqs()
                        },
                        onError: (deleteError) =>
                          showToast(deleteError.message, { toastVariant: "error" }),
                      },
                    )
                  }
                >
                  삭제
                </Button>
              </div>
              <p className="m-0 mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
                {faq.answer}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// =============================================================
// 1:1 문의
// =============================================================

function QnaPanel({
  inquiryKind,
  initialOpenPostId,
}: {
  inquiryKind: "product" | "direct"
  /** ?post=<id> 딥링크 — 대시보드 '최근 문의'가 특정 문의로 바로 보낸다 */
  initialOpenPostId: number | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [tab, setTab] = React.useState<"all" | "waiting" | "answered">("waiting")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  // 초기값으로 받는다 — useEffect로 나중에 열면 목록을 한 번 그린 뒤 덮어쓰는 셈이다
  const [openPostId, setOpenPostId] = React.useState<number | null>(initialOpenPostId)
  const [answerDraft, setAnswerDraft] = React.useState("")
  const [editingCommentId, setEditingCommentId] = React.useState<number | null>(null)

  const listQuery = useQuery(
    trpc.adminBoard.listQnas.queryOptions({
      tab,
      inquiryKind,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )
  const detailQuery = useQuery({
    ...trpc.adminBoard.getQna.queryOptions({ postId: openPostId ?? 0 }),
    enabled: openPostId !== null,
  })
  const answerMutation = useMutation(trpc.adminBoard.answerQna.mutationOptions())
  const deleteAnswerMutation = useMutation(trpc.adminBoard.deleteQnaAnswer.mutationOptions())

  function refreshQnas() {
    void queryClient.invalidateQueries(trpc.adminBoard.pathFilter())
  }

  if (openPostId !== null) {
    const qna = detailQuery.data
    return (
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <Button
          type="button"
          variant="ghost"
          size="admin-38"
          onClick={() => {
            setOpenPostId(null)
            setAnswerDraft("")
            setEditingCommentId(null)
          }}
        >
          ← 문의 목록
        </Button>

        {detailQuery.isPending || !qna ? (
          <div className="flex min-h-32 items-center justify-center" aria-busy="true">
            <Spinner />
            <span className="sr-only">문의를 불러오는 중입니다</span>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {qna.categoryName ? (
                <span className="rounded-[5px] bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-secondary-foreground">
                  {qna.categoryName}
                </span>
              ) : null}
              {qna.isSecret ? (
                <span className="rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
                  비밀글
                </span>
              ) : null}
              <span
                className={cn(
                  "rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                  qna.isAnswered ? "border-primary text-primary" : "border-destructive text-destructive",
                )}
              >
                {qna.isAnswered ? "답변 완료" : "미답변"}
              </span>
            </div>

            <h2 className="m-0 mt-2 font-heading text-base font-extrabold">{qna.title}</h2>
            <p className="m-0 mt-1 text-[12px] text-muted-foreground">
              {qna.authorName}
              {qna.isMember ? " (회원)" : " (비회원)"} · {formatDate(qna.createdAt)}
              {/* 비회원에게는 연락처가 유일한 회신 수단이다 */}
              {qna.contactPhone ? ` · ${qna.contactPhone}` : ""}
            </p>
            <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-relaxed">{qna.content}</p>

            {qna.answers.length > 0 ? (
              <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
                {qna.answers.map((answer) => (
                  <li
                    key={answer.commentId}
                    className="rounded-[calc(var(--radius)-4px)] bg-secondary p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-extrabold text-secondary-foreground">
                        판매자 답변
                      </span>
                      <span className="ml-auto text-[12px] text-secondary-foreground opacity-75">
                        {formatDate(answer.createdAt)}
                      </span>
                    </div>
                    <p className="m-0 mt-2 whitespace-pre-wrap text-[13px]">{answer.content}</p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="admin-38"
                        onClick={() => {
                          setEditingCommentId(answer.commentId)
                          setAnswerDraft(answer.content)
                        }}
                      >
                        수정
                      </Button>
                      <Button
                        type="button"
                        variant="destructive-outline"
                        size="admin-38"
                        onClick={() =>
                          deleteAnswerMutation.mutate(
                            { postId: qna.postId, commentId: answer.commentId },
                            {
                              onSuccess: (result) => {
                                showToast(
                                  result.isAnswered
                                    ? "답변을 삭제했어요."
                                    : "답변을 삭제했어요. 미답변으로 되돌아갑니다.",
                                  { toastVariant: "info" },
                                )
                                refreshQnas()
                              },
                              onError: (deleteError) =>
                                showToast(deleteError.message, { toastVariant: "error" }),
                            },
                          )
                        }
                      >
                        삭제
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <form
              className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (answerMutation.isPending) return
                answerMutation.mutate(
                  {
                    postId: qna.postId,
                    commentId: editingCommentId,
                    content: answerDraft.trim(),
                  },
                  {
                    onSuccess: () => {
                      showToast("답변을 등록했어요.", { toastVariant: "info" })
                      setAnswerDraft("")
                      setEditingCommentId(null)
                      refreshQnas()
                    },
                    onError: (answerError) =>
                      showToast(answerError.message, { toastVariant: "error" }),
                  },
                )
              }}
            >
              <Label htmlFor="qna-answer">
                {editingCommentId === null ? "답변 작성" : "답변 수정"}
              </Label>
              <Textarea
                id="qna-answer"
                size="compact"
                required
                placeholder="고객에게 보일 답변을 입력하세요."
                value={answerDraft}
                onChange={(event) => setAnswerDraft(event.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="admin-40"
                  disabled={answerMutation.isPending}
                >
                  {answerMutation.isPending ? "등록 중…" : "답변 등록"}
                </Button>
                {editingCommentId !== null ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="admin-40"
                    onClick={() => {
                      setEditingCommentId(null)
                      setAnswerDraft("")
                    }}
                  >
                    수정 취소
                  </Button>
                ) : null}
              </div>
            </form>
          </>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="문의 상태 필터" className="flex gap-2">
          {(
            [
              { key: "waiting", label: "미답변" },
              { key: "answered", label: "답변 완료" },
              { key: "all", label: "전체" },
            ] as const
          ).map((tabItem) => (
            <Button
              key={tabItem.key}
              type="button"
              variant="toggle"
              size="admin-38"
              aria-pressed={tab === tabItem.key}
              onClick={() => {
                setTab(tabItem.key)
                setPage(1)
              }}
            >
              {tabItem.label}
              {listQuery.data ? (
                <span className="ml-1.5 text-[12px] font-bold opacity-70">
                  {listQuery.data.tabCounts[tabItem.key]}
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
            aria-label="문의 검색"
            placeholder="제목·내용·작성자"
            className="max-w-[240px]"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Button type="submit" variant="neutral-solid" size="admin-40">
            검색
          </Button>
        </form>
      </div>

      {listQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">문의를 불러오는 중입니다</span>
        </div>
      ) : (listQuery.data?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">💬</span>}
          title="조건에 맞는 문의가 없어요"
          description="탭이나 검색어를 바꿔 보세요."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {listQuery.data?.cards.map((qnaCard) => (
            <li key={qnaCard.postId}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={() => {
                  setOpenPostId(qnaCard.postId)
                  setAnswerDraft("")
                  setEditingCommentId(null)
                }}
              >
                <span
                  className={cn(
                    "shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                    qnaCard.isAnswered
                      ? "border-primary text-primary"
                      : "border-destructive text-destructive",
                  )}
                >
                  {qnaCard.isAnswered ? "답변 완료" : "미답변"}
                </span>
                {/* 1:1 문의는 유형이 갈래다. 상품 문의는 유형이 늘 '상품'이라 표시할 값이 없다 */}
                {inquiryKind === "direct" && qnaCard.categoryName ? (
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {qnaCard.categoryName}
                  </span>
                ) : null}

                {/* 썸네일 — 상품명만 읽는 것보다 어느 상품인지 훨씬 빨리 알아본다.
                    상품명이 바로 옆에 있으므로 이미지는 장식으로 둔다(중복 낭독 방지) */}
                {qnaCard.inquiryProduct ? (
                  <span className="size-10 shrink-0 overflow-hidden rounded-[6px] border border-border bg-muted">
                    {qnaCard.inquiryProduct.thumbnailPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qnaCard.inquiryProduct.thumbnailPath}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : null}
                  </span>
                ) : null}

                <span className="min-w-0 flex-1 text-sm font-semibold">
                  {/* 어느 상품에 대한 문의인지 모르면 답을 쓸 수 없다 — 제목보다 먼저 온다 */}
                  {qnaCard.inquiryProduct ? (
                    <span className="mr-1.5 text-[12px] font-bold text-primary">
                      [{qnaCard.inquiryProduct.name}]
                    </span>
                  ) : null}
                  {qnaCard.title}
                  {qnaCard.isSecret ? (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      (비밀글)
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {qnaCard.authorName} · {formatDate(qnaCard.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// =============================================================
// 단체구매 문의 — 전화 상담 업무라 상태 3칸 + 메모면 충분하다
// =============================================================

const BULK_STATUS_CHOICES = [
  { key: "all", label: "전체" },
  { key: "received", label: "접수" },
  { key: "contacted", label: "연락함" },
  { key: "closed", label: "종료" },
] as const

function BulkInquiryPanel() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [statusFilter, setStatusFilter] =
    React.useState<(typeof BULK_STATUS_CHOICES)[number]["key"]>("all")
  const [page, setPage] = React.useState(1)
  const [memoDrafts, setMemoDrafts] = React.useState<Record<number, string>>({})

  const listQuery = useQuery(
    trpc.adminBoard.listBulkInquiries.queryOptions({ inquiryStatus: statusFilter, page }),
  )
  const updateMutation = useMutation(trpc.adminBoard.updateBulkInquiry.mutationOptions())

  function saveInquiry(
    inquiryId: number,
    inquiryStatus: "received" | "contacted" | "closed",
    adminMemo: string | null,
  ) {
    if (updateMutation.isPending) return
    updateMutation.mutate(
      { inquiryId, inquiryStatus, adminMemo },
      {
        onSuccess: () => {
          showToast("문의를 저장했어요.", { toastVariant: "info" })
          setMemoDrafts((previous) => {
            const next = { ...previous }
            delete next[inquiryId]
            return next
          })
          void queryClient.invalidateQueries(trpc.adminBoard.pathFilter())
        },
        onError: (updateError) => showToast(updateError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="문의 상태 필터" className="flex flex-wrap gap-2">
        {BULK_STATUS_CHOICES.map((choice) => (
          <Button
            key={choice.key}
            type="button"
            variant="toggle"
            size="admin-38"
            aria-pressed={statusFilter === choice.key}
            onClick={() => {
              setStatusFilter(choice.key)
              setPage(1)
            }}
          >
            {choice.label}
            {listQuery.data ? (
              <span className="ml-1.5 text-[12px] font-bold opacity-70">
                {listQuery.data.statusCounts[choice.key]}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {listQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">단체구매 문의를 불러오는 중입니다</span>
        </div>
      ) : (listQuery.data?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">🏢</span>}
          title="조건에 맞는 문의가 없어요"
          description="상태 필터를 바꿔 보세요."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {listQuery.data?.cards.map((inquiry) => {
            const memoDraft = memoDrafts[inquiry.inquiryId]
            return (
              <li
                key={inquiry.inquiryId}
                className="rounded-[var(--radius)] border border-border bg-card p-3.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                      inquiry.inquiryStatus === "received"
                        ? "border-destructive text-destructive"
                        : inquiry.inquiryStatus === "contacted"
                          ? "border-primary text-primary"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {inquiry.inquiryStatusLabel}
                  </span>
                  {inquiry.purchaseTypeName ? (
                    <span className="shrink-0 rounded-[5px] bg-secondary px-1.5 py-0.5 text-[11px] font-bold text-secondary-foreground">
                      {inquiry.purchaseTypeName}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    {inquiry.companyName ?? "개인"} · {inquiry.managerName}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {formatDate(inquiry.createdAt)}
                  </span>
                </div>

                <dl className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">연락처</dt>
                    <dd className="m-0 font-semibold">{inquiry.phone}</dd>
                  </div>
                  {inquiry.email ? (
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">이메일</dt>
                      <dd className="m-0">{inquiry.email}</dd>
                    </div>
                  ) : null}
                  {inquiry.quantity ? (
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">수량</dt>
                      <dd className="m-0">{inquiry.quantity.toLocaleString("ko-KR")}개</dd>
                    </div>
                  ) : null}
                  {inquiry.dueDate ? (
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">희망일</dt>
                      <dd className="m-0">{formatDate(inquiry.dueDate)}</dd>
                    </div>
                  ) : null}
                  {inquiry.needTaxInvoice ? (
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">세금계산서</dt>
                      <dd className="m-0 font-semibold">필요</dd>
                    </div>
                  ) : null}
                </dl>

                {inquiry.content ? (
                  <p className="m-0 mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">
                    {inquiry.content}
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                    <Label htmlFor={`bulk-memo-${inquiry.inquiryId}`} className="text-[12px]">
                      상담 메모
                    </Label>
                    <Input
                      id={`bulk-memo-${inquiry.inquiryId}`}
                      size="admin"
                      placeholder="통화 내용·견적 등"
                      value={memoDraft ?? inquiry.adminMemo ?? ""}
                      onChange={(event) =>
                        setMemoDrafts((previous) => ({
                          ...previous,
                          [inquiry.inquiryId]: event.target.value,
                        }))
                      }
                    />
                  </div>
                  {(["received", "contacted", "closed"] as const).map((nextStatus) => (
                    <Button
                      key={nextStatus}
                      type="button"
                      variant={inquiry.inquiryStatus === nextStatus ? "primary" : "outline"}
                      size="admin-38"
                      onClick={() =>
                        saveInquiry(
                          inquiry.inquiryId,
                          nextStatus,
                          memoDraft ?? inquiry.adminMemo ?? null,
                        )
                      }
                    >
                      {nextStatus === "received"
                        ? "접수"
                        : nextStatus === "contacted"
                          ? "연락함"
                          : "종료"}
                    </Button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
