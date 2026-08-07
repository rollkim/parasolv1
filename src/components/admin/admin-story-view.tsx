"use client"

// 관리자 이야기 관리 — 목록 · 작성/수정(서식 에디터) · 발행.
//
// 핸드오프에 관리자 이야기 화면이 없어 관리자 상품등록 규격을 준용한다
// (섹션 카드 · 좌측 라벨 · 하단 저장 버튼).
//
// 발행 상태는 별도 값이 아니라 발행일시 하나로 정한다 —
// 비우면 작성 중, 과거면 공개, 미래면 예약. 상태 컬럼을 더하면 모순 조합이 생긴다.

import * as React from "react"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "@/server/trpc/routers/_app"

import { AdminPagination } from "@/components/admin/admin-pagination"
import { ImageDropUploader } from "@/components/admin/image-drop-uploader"
import { RichTextEditor } from "@/components/admin/rich-text-editor"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type StoryTab = "all" | "published" | "draft" | "scheduled"

const STORY_TABS: { tab: StoryTab; label: string }[] = [
  { tab: "all", label: "전체" },
  { tab: "published", label: "공개중" },
  { tab: "draft", label: "작성중" },
  { tab: "scheduled", label: "예약" },
]

function formatDateTime(value: Date | null): string {
  if (!value) return "—"
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// =============================================================
// 목록
// =============================================================

export function AdminStoryListView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = React.useState<StoryTab>("all")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [deleteTarget, setDeleteTarget] = React.useState<{ articleId: number; title: string } | null>(
    null,
  )

  const listQuery = useQuery(
    trpc.adminStory.list.queryOptions({
      tab: activeTab,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )
  const removeMutation = useMutation(trpc.adminStory.remove.mutationOptions())

  const listResult = listQuery.data

  function confirmDelete() {
    if (!deleteTarget || removeMutation.isPending) return
    removeMutation.mutate(
      { articleId: deleteTarget.articleId },
      {
        onSuccess: () => {
          showToast("이야기를 삭제했어요.", { toastVariant: "info" })
          setDeleteTarget(null)
          void queryClient.invalidateQueries(trpc.adminStory.pathFilter())
        },
        onError: (removeError) => showToast(removeError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="발행 상태 필터" className="flex flex-wrap gap-2">
          {STORY_TABS.map((tabItem) => (
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

        <Button variant="primary" size="admin-40" className="ml-auto" asChild>
          <Link href="/admin/stories/new">+ 이야기 작성</Link>
        </Button>
      </div>

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
          aria-label="이야기 검색"
          placeholder="제목·URL 주소"
          className="max-w-[280px]"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
        />
        <Button type="submit" variant="neutral-solid" size="admin-40">
          검색
        </Button>
      </form>

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">이야기 목록을 불러오는 중입니다</span>
        </div>
      ) : (listResult?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="panel"
          headingLevel={2}
          title="이야기가 없어요"
          description="작업장의 하루, 만드는 사람, 재료 이야기를 남겨 보세요."
          actions={[{ label: "이야기 작성", href: "/admin/stories/new" }]}
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.cards.map((storyCard) => (
              <li
                key={storyCard.articleId}
                // 모바일은 세로 2단, md 이상에서 한 줄. 한 줄로 두면 제목이 min-w-0이라
                // 0까지 눌려 한글이 세로로 쪼개진다(flex-wrap이 발동하지 않는다)
                className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-border bg-card p-3.5 md:flex-row md:flex-wrap md:items-center md:gap-3"
              >
                <div className="flex min-w-0 items-center gap-3 md:contents">
                <span className="size-11 shrink-0 overflow-hidden rounded-[6px] border border-border bg-muted">
                  {storyCard.coverImagePath ? (
                    // 제목이 바로 옆에 있으므로 이미지는 장식으로 둔다(중복 낭독 방지)
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/uploads/${storyCard.coverImagePath}`}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : null}
                </span>

                <Link
                  href={`/admin/stories/${storyCard.articleId}`}
                  className="min-w-0 flex-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <b className="font-semibold">{storyCard.title}</b>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {[storyCard.categoryName, storyCard.slug].filter(Boolean).join(" · ")}
                  </span>
                </Link>
                </div>

                {/* 상태부 — 모바일에서는 아래 단으로 내려가 자기들끼리 줄바꿈한다 */}
                <div className="flex flex-wrap items-center gap-2 pl-[56px] md:contents md:pl-0">

                {storyCard.isFeatured ? (
                  <span className="shrink-0 rounded-[5px] border border-primary px-2 py-0.5 text-[12px] font-bold text-primary">
                    대표
                  </span>
                ) : null}

                {/* 상태는 색이 아니라 글자로 전달한다(KWCAG) */}
                <span
                  className={cn(
                    "shrink-0 rounded-[5px] border px-2 py-0.5 text-[12px] font-bold",
                    storyCard.isLiveNow
                      ? "border-border"
                      : storyCard.publishedAt
                        ? "border-primary text-primary"
                        : "border-destructive text-destructive",
                  )}
                >
                  {storyCard.isLiveNow ? "공개중" : storyCard.publishedAt ? "예약" : "작성중"}
                </span>

                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {formatDateTime(storyCard.publishedAt)}
                </span>

                <Button
                  type="button"
                  variant="ghost"
                  size="admin-38"
                  onClick={() =>
                    setDeleteTarget({ articleId: storyCard.articleId, title: storyCard.title })
                  }
                >
                  삭제
                </Button>
                </div>
              </li>
            ))}
          </ul>

          <AdminPagination
            label="이야기 목록"
            page={listResult?.page ?? 1}
            pageSize={listResult?.pageSize ?? 15}
            totalCount={listResult?.totalCount ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {/* 삭제는 되돌릴 수 없다 — 파괴적 동작이라 확인을 받는다(핸드오프 §5) */}
      {deleteTarget ? (
        <div
          role="alertdialog"
          aria-label="이야기 삭제 확인"
          className="rounded-[var(--radius)] border border-destructive bg-card p-4"
        >
          <p className="m-0 text-sm">
            <b>{deleteTarget.title}</b> 을(를) 삭제할까요? 되돌릴 수 없습니다.
          </p>
          <div className="mt-3 flex gap-2">
            <Button type="button" variant="outline" size="admin-40" onClick={() => setDeleteTarget(null)}>
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="admin-40"
              disabled={removeMutation.isPending}
              onClick={confirmDelete}
            >
              {removeMutation.isPending ? "삭제 중…" : "삭제"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// =============================================================
// 작성 · 수정
// =============================================================

type LoadedStoryForm = inferRouterOutputs<AppRouter>["adminStory"]["form"]

/**
 * 조회와 편집을 나눈다 — 편집 폼은 데이터가 온 뒤에만 마운트된다.
 * 한 컴포넌트로 두면 빈 상태로 그렸다가 effect로 서버 값을 밀어넣는 모양이 되고,
 * 그 setState가 연쇄 렌더를 만든다(상품 폼과 같은 이유).
 */
export function AdminStoryFormView({ articleId }: { articleId: number | null }) {
  const trpc = useTRPC()
  const formQuery = useQuery(trpc.adminStory.form.queryOptions({ articleId }))

  if (formQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">이야기 정보를 불러오는 중입니다</span>
      </div>
    )
  }

  if (formQuery.isError || !formQuery.data) {
    return (
      <div className="py-12 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {formQuery.error?.message ?? "이야기 정보를 불러오지 못했습니다."}
        </p>
        <Button variant="outline" size="admin-40" className="mt-4" asChild>
          <Link href="/admin/stories">이야기 목록으로</Link>
        </Button>
      </div>
    )
  }

  return <StoryFormFields loadedForm={formQuery.data} />
}

function StoryFormFields({ loadedForm }: { loadedForm: LoadedStoryForm }) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const saveMutation = useMutation(trpc.adminStory.save.mutationOptions())
  const initial = loadedForm.form

  const [slug, setSlug] = React.useState(initial.slug)
  const [title, setTitle] = React.useState(initial.title)
  const [summary, setSummary] = React.useState(initial.summary)
  const [content, setContent] = React.useState(initial.content)
  const [categoryCode, setCategoryCode] = React.useState(initial.categoryCode ?? "")
  const [productId, setProductId] = React.useState<number | null>(initial.productId)
  const [authorName, setAuthorName] = React.useState(initial.authorName)
  const [coverImagePath, setCoverImagePath] = React.useState(initial.coverImagePath)
  const [coverAlt, setCoverAlt] = React.useState("")
  const [isFeatured, setIsFeatured] = React.useState(initial.isFeatured)
  const [publishedAt, setPublishedAt] = React.useState(initial.publishedAt)

  function submitStory(event: React.FormEvent) {
    event.preventDefault()
    if (saveMutation.isPending) return

    saveMutation.mutate(
      {
        articleId: initial.articleId,
        slug: slug.trim(),
        title: title.trim(),
        summary: summary.trim() || undefined,
        content,
        categoryCode: categoryCode || undefined,
        productId: productId ?? undefined,
        authorName: authorName.trim() || undefined,
        coverImagePath: coverImagePath || undefined,
        isFeatured,
        publishedAt: publishedAt || undefined,
      },
      {
        onSuccess: (saved) => {
          showToast("이야기를 저장했어요.", { toastVariant: "info" })
          void queryClient.invalidateQueries(trpc.adminStory.pathFilter())
          router.push(`/admin/stories/${saved.articleId}`)
        },
        onError: (saveError) =>
          showToast(
            saveError.message.startsWith("[")
              ? "저장하지 못했어요. 입력값을 확인해 주세요."
              : saveError.message,
            { toastVariant: "error" },
          ),
      },
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submitStory}>
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">기본 정보</h2>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="story-title">제목 *</Label>
            <Input
              id="story-title"
              size="admin"
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-slug">URL 주소 *</Label>
            <Input
              id="story-slug"
              size="admin"
              required
              placeholder="morning-oven-6am"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
            <p className="m-0 text-[12px] text-muted-foreground">
              /story/{slug || "…"} 로 열립니다. 영문 소문자·숫자·하이픈만 씁니다.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-category">분류</Label>
            <select
              id="story-category"
              className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
            >
              <option value="">선택 안 함</option>
              {loadedForm.categoryOptions.map((categoryOption) => (
                <option key={categoryOption.code} value={categoryOption.code}>
                  {categoryOption.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-author">저자 표기</Label>
            <Input
              id="story-author"
              size="admin"
              placeholder="예: PaRaSOL 에디터"
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-product">이 이야기의 제품</Label>
            <select
              id="story-product"
              className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
              value={productId ?? ""}
              onChange={(event) =>
                setProductId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">선택 안 함</option>
              {loadedForm.productOptions.map((productOption) => (
                <option key={productOption.productId} value={productOption.productId}>
                  {productOption.name}
                </option>
              ))}
            </select>
            <p className="m-0 text-[12px] text-muted-foreground">
              이야기 아래에 상품 카드가 붙습니다 — 읽고 바로 살 수 있는 유일한 동선입니다.
            </p>
          </div>

          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="story-summary">목록 발췌</Label>
            <Input
              id="story-summary"
              size="admin"
              maxLength={300}
              placeholder="목록 카드에 보이는 한두 줄"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 mb-3 font-heading text-[15px] font-extrabold">커버 이미지</h2>
        <ImageDropUploader
          images={coverImagePath ? [{ path: coverImagePath, alt: coverAlt }] : []}
          onChange={(nextImages) => {
            const picked = nextImages.at(-1) ?? null
            setCoverImagePath(picked?.path ?? null)
            setCoverAlt(picked?.alt ?? "")
          }}
          purpose="banner"
          uploadEndpoint="/api/admin/product-images"
          multiple={false}
          label="커버 이미지 올리기"
          helpText="목록 카드와 상세 상단(16:7)에 쓰입니다."
        />
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 mb-3 font-heading text-[15px] font-extrabold">본문</h2>
        <RichTextEditor
          value={content}
          onChange={setContent}
          placeholder="작업장의 하루를 담담하게 적어 주세요. 사진도 넣을 수 있어요."
          imagePurpose="article"
          uploadEndpoint="/api/admin/product-images"
        />
        <p className="m-0 mt-2 text-[12px] text-muted-foreground">
          저장할 때 서버가 안전한 형태로 정리하므로, 붙여넣은 내용의 일부 서식은 사라질 수 있습니다.
        </p>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">발행</h2>

        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-published">발행일시</Label>
            <Input
              id="story-published"
              size="admin"
              type="datetime-local"
              className="max-w-[240px]"
              value={publishedAt}
              onChange={(event) => setPublishedAt(event.target.value)}
            />
            {/* 상태를 따로 고르게 하지 않는 이유를 화면에서도 밝힌다 */}
            <p className="m-0 text-[12px] text-muted-foreground">
              비우면 <b>작성 중</b>(스토어에 안 보임) · 지난 시각이면 <b>공개</b> ·
              앞으로의 시각이면 그때 <b>자동 공개</b>됩니다.
            </p>
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              aria-label="이달의 이야기로 지정"
              checked={isFeatured}
              onCheckedChange={(checked) => setIsFeatured(checked === true)}
            />
            이달의 이야기로 지정
            <span className="text-muted-foreground">— 목록 맨 위 큰 카드. 하나만 지정됩니다</span>
          </label>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="admin-40" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "저장 중…" : initial.articleId === null ? "등록" : "저장"}
        </Button>
        <Button type="button" variant="outline" size="admin-40" asChild>
          <Link href="/admin/stories">목록으로</Link>
        </Button>
        {/* 공개된 글은 실제 화면을 바로 확인할 수 있게 한다 */}
        {initial.articleId !== null && publishedAt ? (
          <Button type="button" variant="outline" size="admin-40" asChild>
            <Link href={`/story/${slug}`} target="_blank" rel="noopener noreferrer">
              스토어에서 보기
            </Link>
          </Button>
        ) : null}
      </div>
    </form>
  )
}
