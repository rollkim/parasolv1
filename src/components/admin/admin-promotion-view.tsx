"use client"

// 관리자 기획전 관리 — 핸드오프 '관리자 프로모션.dc.html'(기간·대상 설정) 재구현.
// 목록 + 인라인 등록/수정 폼(쿠폰 관리와 같은 패턴 — editingId 상태).
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 타임특가 가격 입력칸이 없다 — 특가는 결제 가격에 잇지 않는다(설계 결정 ①).
//    할인은 상품 가격(판매가/정가)으로 운영하고, 기획전은 모음·쿠폰·카운트다운을 판다.
//  - 상품 구성은 검색해서 담는다(id 직접 입력 아님) — 운영자는 상품 id를 모른다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { AdminPagination } from "@/components/admin/admin-pagination"
import {
  ImageDropUploader,
  type UploadedImage,
} from "@/components/admin/image-drop-uploader"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type PromotionFormState = {
  slug: string
  title: string
  description: string
  heroImagePath: string | null
  heroMobileImagePath: string | null
  startsAt: string
  endsAt: string
  couponId: number | null
  isActive: boolean
  /** 순서가 곧 진열 순서 */
  products: { productId: number; productName: string }[]
}

const EMPTY_FORM: PromotionFormState = {
  slug: "",
  title: "",
  description: "",
  heroImagePath: null,
  heroMobileImagePath: null,
  startsAt: "",
  endsAt: "",
  couponId: null,
  isActive: true,
  products: [],
}

function toDateInputValue(value: Date | null): string {
  if (!value) return ""
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 상품 검색 피커 — 운영자는 상품 id를 모른다. 이름으로 찾아 담는다 */
function ProductPicker({
  selected,
  onAdd,
}: {
  selected: PromotionFormState["products"]
  onAdd: (product: { productId: number; productName: string }) => void
}) {
  const trpc = useTRPC()
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")

  const searchQuery = useQuery({
    ...trpc.adminProduct.list.queryOptions({ keyword: appliedKeyword, page: 1 }),
    enabled: appliedKeyword.length > 0,
  })

  const selectedIds = new Set(selected.map((item) => item.productId))
  const candidates = (searchQuery.data?.cards ?? []).slice(0, 8)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          size="admin"
          type="search"
          aria-label="담을 상품 검색"
          placeholder="상품명으로 검색"
          className="max-w-[280px]"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              setAppliedKeyword(keywordInput.trim())
            }
          }}
        />
        <Button
          type="button"
          variant="neutral-solid"
          size="admin-40"
          onClick={() => setAppliedKeyword(keywordInput.trim())}
        >
          검색
        </Button>
      </div>

      {appliedKeyword.length > 0 ? (
        searchQuery.isPending ? (
          <div className="flex min-h-14 items-center justify-center" aria-busy="true">
            <Spinner />
            <span className="sr-only">상품을 찾는 중입니다</span>
          </div>
        ) : candidates.length === 0 ? (
          <p className="m-0 text-[12px] text-muted-foreground">검색 결과가 없어요.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {candidates.map((candidate) => (
              <li
                key={candidate.productId}
                className="flex items-center gap-2 rounded-[calc(var(--radius)-4px)] border border-border px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{candidate.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="admin-38"
                  disabled={selectedIds.has(candidate.productId)}
                  onClick={() =>
                    onAdd({ productId: candidate.productId, productName: candidate.name })
                  }
                >
                  {selectedIds.has(candidate.productId) ? "담김" : "추가"}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  )
}

export function AdminPromotionView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  /** null=폼 닫힘 · 0=신규 · 그 외=수정 */
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [form, setForm] = React.useState<PromotionFormState>(EMPTY_FORM)

  const listQuery = useQuery(
    trpc.adminPromotion.list.queryOptions({ keyword: appliedKeyword || undefined, page }),
  )
  const couponChoicesQuery = useQuery({
    ...trpc.adminPromotion.couponChoices.queryOptions(),
    enabled: editingId !== null,
  })
  const createMutation = useMutation(trpc.adminPromotion.create.mutationOptions())
  const updateMutation = useMutation(trpc.adminPromotion.update.mutationOptions())
  const deactivateMutation = useMutation(trpc.adminPromotion.deactivate.mutationOptions())

  const listResult = listQuery.data
  const isSaving = createMutation.isPending || updateMutation.isPending

  async function openEditForm(promotionId: number) {
    // 상세는 서버에서 새로 읽는다 — 목록 행에는 상품 구성이 없다
    const detail = await queryClient.fetchQuery(
      trpc.adminPromotion.get.queryOptions({ promotionId }),
    )
    setForm({
      slug: detail.slug,
      title: detail.title,
      description: detail.description ?? "",
      heroImagePath: detail.heroImagePath,
      heroMobileImagePath: detail.heroMobileImagePath,
      startsAt: toDateInputValue(detail.startsAt),
      endsAt: toDateInputValue(detail.endsAt),
      couponId: detail.couponId,
      isActive: detail.isActive,
      products: detail.products,
    })
    setEditingId(promotionId)
  }

  const localError = (() => {
    if (!form.title.trim()) return "기획전 제목을 입력해 주세요."
    if (!/^[a-z0-9-]+$/.test(form.slug)) {
      return "URL 주소는 영문 소문자·숫자·하이픈만 쓸 수 있습니다. 예: chuseok-2026"
    }
    if (form.startsAt && form.endsAt && form.startsAt > form.endsAt) {
      return "종료일이 시작일보다 빠릅니다."
    }
    if (form.products.length === 0) return "구성 상품을 1개 이상 담아 주세요."
    return null
  })()

  function handleSave() {
    if (isSaving || localError) return
    const payload = {
      slug: form.slug,
      title: form.title,
      description: form.description.trim() || null,
      heroImagePath: form.heroImagePath,
      heroMobileImagePath: form.heroMobileImagePath,
      startsAt: form.startsAt ? new Date(form.startsAt) : null,
      // 종료일은 그날 끝까지 — 자정으로 저장하면 마지막 날 낮에 이미 끝나 버린다
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59+09:00`) : null,
      couponId: form.couponId,
      isActive: form.isActive,
      productIds: form.products.map((item) => item.productId),
    }
    const handlers = {
      onSuccess: () => {
        showToast(editingId === 0 ? "기획전을 등록했어요." : "기획전을 수정했어요.", {
          toastVariant: "info",
        })
        setEditingId(null)
        void queryClient.invalidateQueries(trpc.adminPromotion.pathFilter())
      },
      onError: (saveError: { message: string }) =>
        showToast(saveError.message, { toastVariant: "error" }),
    }
    if (editingId === 0) createMutation.mutate(payload, handlers)
    else if (editingId !== null)
      updateMutation.mutate({ promotionId: editingId, ...payload }, handlers)
  }

  const heroImages: UploadedImage[] = form.heroImagePath
    ? [{ path: form.heroImagePath, alt: "" }]
    : []
  const heroMobileImages: UploadedImage[] = form.heroMobileImagePath
    ? [{ path: form.heroMobileImagePath, alt: "" }]
    : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
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
            aria-label="기획전 검색"
            placeholder="기획전 제목"
            className="max-w-[280px]"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Button type="submit" variant="neutral-solid" size="admin-40">
            검색
          </Button>
        </form>

        <Button
          variant="primary"
          size="admin-40"
          className="ml-auto"
          type="button"
          onClick={() => {
            setForm(EMPTY_FORM)
            setEditingId(0)
          }}
        >
          + 기획전 등록
        </Button>
      </div>

      {editingId !== null ? (
        <section className="rounded-[var(--radius)] border border-primary bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">
            {editingId === 0 ? "기획전 등록" : "기획전 수정"}
          </h2>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promo-title" required>
                제목
              </Label>
              <Input
                id="promo-title"
                size="admin"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promo-slug" required>
                URL 주소
              </Label>
              <Input
                id="promo-slug"
                size="admin"
                placeholder="chuseok-2026"
                value={form.slug}
                onChange={(event) =>
                  setForm({ ...form, slug: event.target.value.toLowerCase() })
                }
              />
              <p className="m-0 text-[12px] text-muted-foreground">
                /events/{form.slug || "…"} 로 열립니다. 영문 소문자·숫자·하이픈.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="promo-description">소개 문구</Label>
              <Textarea
                id="promo-description"
                rows={2}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promo-starts">시작일</Label>
              <Input
                id="promo-starts"
                size="admin"
                type="date"
                value={form.startsAt}
                onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promo-ends">종료일</Label>
              <Input
                id="promo-ends"
                size="admin"
                type="date"
                value={form.endsAt}
                onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              />
              <p className="m-0 text-[12px] text-muted-foreground">
                종료일 그날 밤까지 진행됩니다. 비우면 상시 진행.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="promo-coupon">연결 쿠폰</Label>
              <select
                id="promo-coupon"
                className="h-10 rounded-[calc(var(--radius)-4px)] border border-border bg-card px-3 text-sm"
                value={form.couponId ?? ""}
                onChange={(event) =>
                  setForm({
                    ...form,
                    couponId: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">연결 안 함</option>
                {(couponChoicesQuery.data ?? []).map((choice) => (
                  <option key={choice.couponId} value={choice.couponId}>
                    {choice.couponName}
                  </option>
                ))}
              </select>
              <p className="m-0 text-[12px] text-muted-foreground">
                연결하면 기획전 상단에 쿠폰 받기 줄이 생깁니다.
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ImageDropUploader
              images={heroImages}
              onChange={(nextImages) =>
                setForm({ ...form, heroImagePath: nextImages.at(-1)?.path ?? null })
              }
              purpose="banner"
              uploadEndpoint="/api/admin/product-images"
              folder="promotions"
              multiple={false}
              label="히어로 이미지 (PC)"
              helpText="가로 1920 이상 원본을 권합니다."
            />
            <ImageDropUploader
              images={heroMobileImages}
              onChange={(nextImages) =>
                setForm({ ...form, heroMobileImagePath: nextImages.at(-1)?.path ?? null })
              }
              purpose="banner"
              uploadEndpoint="/api/admin/product-images"
              folder="promotions"
              multiple={false}
              label="히어로 이미지 (모바일 · 선택)"
            />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <b className="text-[13px] font-extrabold">구성 상품 ({form.products.length})</b>
            {form.products.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {form.products.map((item, index) => (
                  <li
                    key={item.productId}
                    className="flex items-center gap-2 rounded-[calc(var(--radius)-4px)] border border-border px-3 py-1.5"
                  >
                    <span className="w-6 shrink-0 text-[12px] font-bold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{item.productName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="admin-38"
                      onClick={() =>
                        setForm({
                          ...form,
                          products: form.products.filter(
                            (candidate) => candidate.productId !== item.productId,
                          ),
                        })
                      }
                    >
                      빼기
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[12px] text-muted-foreground">
                아래에서 상품을 검색해 담아 주세요. 담은 순서대로 진열됩니다.
              </p>
            )}
            <ProductPicker
              selected={form.products}
              onAdd={(picked) => setForm({ ...form, products: [...form.products, picked] })}
            />
          </div>

          {localError ? (
            <p
              role="alert"
              className="m-0 mt-3 rounded-[calc(var(--radius)-2px)] border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-[13px] font-semibold text-destructive"
            >
              {localError}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="admin-40"
              disabled={isSaving || localError !== null}
              onClick={handleSave}
            >
              {isSaving ? "저장 중…" : "저장"}
            </Button>
            <Button
              type="button"
              variant="neutral-solid"
              size="admin-40"
              onClick={() => setEditingId(null)}
            >
              취소
            </Button>
          </div>
        </section>
      ) : null}

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">기획전 목록을 불러오는 중입니다</span>
        </div>
      ) : (listResult?.rows.length ?? 0) === 0 ? (
        <EmptyState
          size="panel"
          headingLevel={2}
          title="기획전이 없어요"
          description="기획전을 등록하고 히어로 배너에서 연결하면 메인에서 바로 들어올 수 있어요."
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.rows.map((row) => {
              const isEnded =
                !row.isActive || (row.endsAt !== null && new Date(row.endsAt) < new Date())
              return (
                <li
                  key={row.promotionId}
                  // 모바일은 세로 스택, md 이상에서 한 줄(제목이 min-w-0이라 눌리면 세로로 쪼개진다)
                  className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-border bg-card p-3.5 md:flex-row md:flex-wrap md:items-center md:gap-3"
                >
                  <div className="min-w-0 md:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-sm font-semibold">{row.title}</b>
                      <span
                        className={cn(
                          "rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                          isEnded
                            ? "border-border text-muted-foreground"
                            : "border-primary text-primary",
                        )}
                      >
                        {row.isActive ? (isEnded ? "기간 종료" : "운영중") : "중지됨"}
                      </span>
                    </div>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {[
                        `/events/${row.slug}`,
                        `상품 ${row.productCount}개`,
                        row.couponName ? `쿠폰: ${row.couponName}` : null,
                        row.endsAt
                          ? `${new Date(row.endsAt).toLocaleDateString("ko-KR")}까지`
                          : "상시",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="admin-38"
                      onClick={() => void openEditForm(row.promotionId)}
                    >
                      수정
                    </Button>
                    {row.isActive ? (
                      <Button
                        type="button"
                        variant="neutral-solid"
                        size="admin-38"
                        disabled={deactivateMutation.isPending}
                        onClick={() =>
                          deactivateMutation.mutate(
                            { promotionId: row.promotionId },
                            {
                              onSuccess: () => {
                                showToast("기획전을 중지했어요.", { toastVariant: "info" })
                                void queryClient.invalidateQueries(
                                  trpc.adminPromotion.pathFilter(),
                                )
                              },
                              onError: (stopError) =>
                                showToast(stopError.message, { toastVariant: "error" }),
                            },
                          )
                        }
                      >
                        중지
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>

          <AdminPagination
            page={listResult?.page ?? 1}
            pageSize={listResult?.pageSize ?? 15}
            totalCount={listResult?.totalCount ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
