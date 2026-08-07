"use client"

// 관리자 쿠폰 관리 — 목록 · 등록/수정 · 사용 중지.
//
// 핸드오프에 쿠폰 화면이 없어 관리자 상품등록 규격을 준용한다(섹션 카드 · 라벨+인풋 · 하단 저장).
//
// **여기 숫자가 돈을 만든다.** 적립금 정책 화면과 같은 방식으로, 입력한 조건이 실제로
// 얼마를 깎는지 미리보기를 붙인다 — 정률을 %로 착각하는 실수가 눈에 보이게.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { AdminPagination } from "@/components/admin/admin-pagination"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { previewCouponDiscount } from "@/domain/coupon"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type CouponTab = "all" | "active" | "ended"

const COUPON_TABS: { tab: CouponTab; label: string }[] = [
  { tab: "all", label: "전체" },
  { tab: "active", label: "운영중" },
  { tab: "ended", label: "종료·중지" },
]

/** 미리보기 기준 주문액 — "3만원 사면 얼마 깎이나"로 감을 잡는 값 */
const PREVIEW_ORDER_AMOUNTS = [10_000, 30_000, 100_000]

type CouponFormState = {
  name: string
  discountKind: "fixed" | "percent"
  discountValue: number
  maxDiscountAmount: number | null
  minOrderAmount: number
  scopeKind: "all" | "category" | "product"
  scopeRefId: number | null
  issueMethod: "download" | "code" | "auto"
  code: string
  totalQuantity: number | null
  perCustomerLimit: number
  validDays: number | null
  startsAt: string
  endsAt: string
  isActive: boolean
}

const EMPTY_FORM: CouponFormState = {
  name: "",
  discountKind: "fixed",
  discountValue: 5000,
  maxDiscountAmount: null,
  minOrderAmount: 0,
  scopeKind: "all",
  scopeRefId: null,
  issueMethod: "download",
  code: "",
  totalQuantity: null,
  perCustomerLimit: 1,
  validDays: 30,
  startsAt: "",
  endsAt: "",
  isActive: true,
}

function toDateInputValue(value: Date | null): string {
  if (!value) return ""
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatBenefit(row: {
  discountKind: "fixed" | "percent"
  discountValue: number
  maxDiscountAmount: number | null
}): string {
  if (row.discountKind === "fixed") return `${formatKrw(row.discountValue)} 할인`
  const percentLabel = `${(row.discountValue / 10).toFixed(1).replace(/\.0$/, "")}% 할인`
  return row.maxDiscountAmount === null
    ? percentLabel
    : `${percentLabel} (최대 ${formatKrw(row.maxDiscountAmount)})`
}

export function AdminCouponView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = React.useState<CouponTab>("all")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  /** 편집 대상 — null이면 폼 닫힘, 0이면 신규 */
  const [editingCouponId, setEditingCouponId] = React.useState<number | null>(null)
  const [form, setForm] = React.useState<CouponFormState>(EMPTY_FORM)

  const listQuery = useQuery(
    trpc.adminCoupon.list.queryOptions({
      tab: activeTab,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )
  const createMutation = useMutation(trpc.adminCoupon.create.mutationOptions())
  const updateMutation = useMutation(trpc.adminCoupon.update.mutationOptions())
  const deactivateMutation = useMutation(trpc.adminCoupon.deactivate.mutationOptions())

  const listResult = listQuery.data
  const isSaving = createMutation.isPending || updateMutation.isPending

  function openNewForm() {
    setForm(EMPTY_FORM)
    setEditingCouponId(0)
  }

  function openEditForm(row: NonNullable<typeof listResult>["rows"][number]) {
    setForm({
      name: row.name,
      discountKind: row.discountKind,
      discountValue: row.discountValue,
      maxDiscountAmount: row.maxDiscountAmount,
      minOrderAmount: row.minOrderAmount,
      scopeKind: row.scopeKind,
      scopeRefId: row.scopeRefId,
      issueMethod: row.issueMethod,
      code: row.code ?? "",
      totalQuantity: row.totalQuantity,
      perCustomerLimit: row.perCustomerLimit,
      validDays: row.validDays,
      startsAt: toDateInputValue(row.startsAt),
      endsAt: toDateInputValue(row.endsAt),
      isActive: row.isActive,
    })
    setEditingCouponId(row.couponId)
  }

  /* 저장 전에 화면이 먼저 거른다 — 서버도 같은 규칙을 보지만, 눌러 보고 나서 알게 되면
     이미 "왜 안 되지"를 한 번 겪는다 */
  const localError = (() => {
    if (!form.name.trim()) return "쿠폰 이름을 입력해 주세요."
    if (form.discountValue <= 0) return "할인 값은 0보다 커야 합니다."
    if (form.discountKind === "percent" && form.discountValue > 1000) {
      return "할인율이 100%를 넘습니다. 0.1% 단위로 입력해 주세요(100 = 10%)."
    }
    if (form.discountKind === "fixed" && form.maxDiscountAmount !== null) {
      return "정액 쿠폰에는 최대 할인액을 설정할 수 없습니다."
    }
    if (form.scopeKind !== "all" && form.scopeRefId === null) {
      return "범위를 지정한 쿠폰은 대상 카테고리·상품 id가 필요합니다."
    }
    if (form.issueMethod === "code" && !form.code.trim()) {
      return "코드 등록형 쿠폰은 코드가 필요합니다."
    }
    if (form.startsAt && form.endsAt && form.startsAt > form.endsAt) {
      return "종료일이 시작일보다 빠릅니다."
    }
    return null
  })()

  function handleSave() {
    if (isSaving || localError) return
    const payload = {
      name: form.name,
      discountKind: form.discountKind,
      discountValue: form.discountValue,
      maxDiscountAmount: form.discountKind === "percent" ? form.maxDiscountAmount : null,
      minOrderAmount: form.minOrderAmount,
      scopeKind: form.scopeKind,
      scopeRefId: form.scopeKind === "all" ? null : form.scopeRefId,
      issueMethod: form.issueMethod,
      code: form.code.trim() || null,
      totalQuantity: form.totalQuantity,
      perCustomerLimit: form.perCustomerLimit,
      validDays: form.validDays,
      startsAt: form.startsAt ? new Date(form.startsAt) : null,
      endsAt: form.endsAt ? new Date(form.endsAt) : null,
      isActive: form.isActive,
    }
    const handlers = {
      onSuccess: () => {
        showToast(editingCouponId === 0 ? "쿠폰을 등록했어요." : "쿠폰을 수정했어요.", {
          toastVariant: "info",
        })
        setEditingCouponId(null)
        void queryClient.invalidateQueries(trpc.adminCoupon.pathFilter())
      },
      onError: (saveError: { message: string }) =>
        showToast(saveError.message, { toastVariant: "error" }),
    }

    if (editingCouponId === 0) {
      createMutation.mutate(payload, handlers)
    } else if (editingCouponId !== null) {
      updateMutation.mutate({ couponId: editingCouponId, ...payload }, handlers)
    }
  }

  const numberField = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0
  const nullableNumberField = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "")
    return digits === "" ? null : Number(digits)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="쿠폰 상태 필터" className="flex flex-wrap gap-2">
          {COUPON_TABS.map((tabItem) => (
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
            </Button>
          ))}
        </div>

        <Button
          variant="primary"
          size="admin-40"
          className="ml-auto"
          type="button"
          onClick={openNewForm}
        >
          + 쿠폰 등록
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
          aria-label="쿠폰 검색"
          placeholder="쿠폰명·코드"
          className="max-w-[280px]"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
        />
        <Button type="submit" variant="neutral-solid" size="admin-40">
          검색
        </Button>
      </form>

      {editingCouponId !== null ? (
        <section className="rounded-[var(--radius)] border border-primary bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">
            {editingCouponId === 0 ? "쿠폰 등록" : "쿠폰 수정"}
          </h2>
          {editingCouponId !== 0 ? (
            // 발급된 쿠폰의 조건을 바꾸면 이미 받은 사람의 혜택이 소급해 바뀐다.
            // 막지는 않되(오타 정정·기간 연장은 정당하다) 무엇을 건드리는지 알린다
            <p className="m-0 mt-1 text-[12px] text-muted-foreground">
              이미 발급된 쿠폰의 조건을 바꾸면 <b className="text-foreground">받아 간 고객의 혜택도 함께 바뀝니다.</b>
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="coupon-name" required>
                쿠폰 이름
              </Label>
              <Input
                id="coupon-name"
                size="admin"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-kind">할인 방식</Label>
              <select
                id="coupon-kind"
                className="h-10 rounded-[calc(var(--radius)-4px)] border border-border bg-card px-3 text-sm"
                value={form.discountKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    discountKind: event.target.value as "fixed" | "percent",
                    // 정액으로 바꾸면 최대 할인액은 의미가 없다 — 남겨 두면 저장에서 막힌다
                    maxDiscountAmount:
                      event.target.value === "fixed" ? null : form.maxDiscountAmount,
                  })
                }
              >
                <option value="fixed">정액 (원)</option>
                <option value="percent">정률 (0.1% 단위)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-value">
                {form.discountKind === "fixed" ? "할인 금액 (원)" : "할인율 (0.1% 단위)"}
              </Label>
              <Input
                id="coupon-value"
                size="admin"
                inputMode="numeric"
                value={form.discountValue}
                onChange={(event) =>
                  setForm({ ...form, discountValue: numberField(event.target.value) })
                }
              />
              {form.discountKind === "percent" ? (
                <p className="m-0 text-[12px] text-muted-foreground">
                  현재 <b className="text-foreground">{(form.discountValue / 10).toFixed(1)}%</b>{" "}
                  (100 = 10%)
                </p>
              ) : null}
            </div>

            {form.discountKind === "percent" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-max">최대 할인액 (원)</Label>
                <Input
                  id="coupon-max"
                  size="admin"
                  inputMode="numeric"
                  placeholder="비우면 상한 없음"
                  value={form.maxDiscountAmount ?? ""}
                  onChange={(event) =>
                    setForm({ ...form, maxDiscountAmount: nullableNumberField(event.target.value) })
                  }
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-min-order">최소 주문 금액 (원)</Label>
              <Input
                id="coupon-min-order"
                size="admin"
                inputMode="numeric"
                value={form.minOrderAmount}
                onChange={(event) =>
                  setForm({ ...form, minOrderAmount: numberField(event.target.value) })
                }
              />
              <p className="m-0 text-[12px] text-muted-foreground">
                0이면 제한 없음. 범위 쿠폰은 <b className="text-foreground">범위 상품 합계</b>로 판정합니다.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-scope">적용 범위</Label>
              <select
                id="coupon-scope"
                className="h-10 rounded-[calc(var(--radius)-4px)] border border-border bg-card px-3 text-sm"
                value={form.scopeKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scopeKind: event.target.value as "all" | "category" | "product",
                    scopeRefId: event.target.value === "all" ? null : form.scopeRefId,
                  })
                }
              >
                <option value="all">전체 상품</option>
                <option value="category">특정 카테고리</option>
                <option value="product">특정 상품</option>
              </select>
            </div>

            {form.scopeKind !== "all" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-scope-ref" required>
                  {form.scopeKind === "category" ? "카테고리 id" : "상품 id"}
                </Label>
                <Input
                  id="coupon-scope-ref"
                  size="admin"
                  inputMode="numeric"
                  value={form.scopeRefId ?? ""}
                  onChange={(event) =>
                    setForm({ ...form, scopeRefId: nullableNumberField(event.target.value) })
                  }
                />
                {form.scopeKind === "category" ? (
                  <p className="m-0 text-[12px] text-muted-foreground">
                    하위 카테고리 상품도 함께 적용됩니다.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-issue-method">발급 방식</Label>
              <select
                id="coupon-issue-method"
                className="h-10 rounded-[calc(var(--radius)-4px)] border border-border bg-card px-3 text-sm"
                value={form.issueMethod}
                onChange={(event) =>
                  setForm({
                    ...form,
                    issueMethod: event.target.value as "download" | "code" | "auto",
                  })
                }
              >
                <option value="download">다운로드</option>
                <option value="code">코드 등록</option>
                <option value="auto">자동 지급</option>
              </select>
            </div>

            {form.issueMethod === "code" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="coupon-code" required>
                  등록 코드
                </Label>
                <Input
                  id="coupon-code"
                  size="admin"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-total">총 발급 수량</Label>
              <Input
                id="coupon-total"
                size="admin"
                inputMode="numeric"
                placeholder="비우면 무제한"
                value={form.totalQuantity ?? ""}
                onChange={(event) =>
                  setForm({ ...form, totalQuantity: nullableNumberField(event.target.value) })
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-per-customer">인당 발급 한도</Label>
              <Input
                id="coupon-per-customer"
                size="admin"
                inputMode="numeric"
                value={form.perCustomerLimit}
                onChange={(event) =>
                  setForm({
                    ...form,
                    perCustomerLimit: Math.max(1, numberField(event.target.value)),
                  })
                }
              />
              <p className="m-0 text-[12px] text-muted-foreground">
                1이면 1인 1매. 만료 후 재발급·보상 발급이 필요하면 늘립니다.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-valid-days">유효 기간 (일)</Label>
              <Input
                id="coupon-valid-days"
                size="admin"
                inputMode="numeric"
                placeholder="비우면 종료일까지"
                value={form.validDays ?? ""}
                onChange={(event) =>
                  setForm({ ...form, validDays: nullableNumberField(event.target.value) })
                }
              />
              <p className="m-0 text-[12px] text-muted-foreground">
                발급일 기준입니다. 쿠폰 종료일이 먼저 오면 그날이 기한입니다.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-starts">사용 시작일</Label>
              <Input
                id="coupon-starts"
                size="admin"
                type="date"
                value={form.startsAt}
                onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="coupon-ends">사용 종료일</Label>
              <Input
                id="coupon-ends"
                size="admin"
                type="date"
                value={form.endsAt}
                onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              />
            </div>
          </div>

          {/* 조건을 %로만 보여주면 실제 금액 감각이 안 온다 — 내림·상한까지 반영해 계산해 보여준다 */}
          <dl className="m-0 mt-3 flex flex-wrap gap-x-6 gap-y-1.5 rounded-[calc(var(--radius)-2px)] border border-border bg-muted/40 px-3.5 py-3 text-[13px]">
            {PREVIEW_ORDER_AMOUNTS.map((previewAmount) => (
              <div key={previewAmount} className="flex items-baseline gap-1.5">
                <dt className="text-muted-foreground">{formatKrw(previewAmount)} 주문</dt>
                <dd className="m-0 font-bold">
                  {formatKrw(
                    previewCouponDiscount(
                      {
                        discountKind: form.discountKind,
                        discountValue: form.discountValue,
                        maxDiscountAmount:
                          form.discountKind === "percent" ? form.maxDiscountAmount : null,
                        minOrderAmount: form.minOrderAmount,
                      },
                      previewAmount,
                    ),
                  )}
                </dd>
              </div>
            ))}
          </dl>

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
              onClick={() => setEditingCouponId(null)}
            >
              취소
            </Button>
          </div>
        </section>
      ) : null}

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">쿠폰 목록을 불러오는 중입니다</span>
        </div>
      ) : (listResult?.rows.length ?? 0) === 0 ? (
        <EmptyState
          size="panel"
          headingLevel={2}
          title="쿠폰이 없어요"
          description="할인 쿠폰을 등록하면 고객이 상품·기획전 화면에서 받아 갈 수 있어요."
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.rows.map((row) => {
              const isEnded =
                !row.isActive || (row.endsAt !== null && new Date(row.endsAt) < new Date())
              return (
                <li
                  key={row.couponId}
                  // 모바일은 세로 스택, md 이상에서 한 줄. 한 줄로 두면 이름이 min-w-0이라
                  // 0까지 눌려 한글이 세로로 쪼개진다(flex-wrap이 발동하지 않는다)
                  className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-border bg-card p-3.5 md:flex-row md:flex-wrap md:items-center md:gap-3"
                >
                  <div className="min-w-0 md:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-sm font-semibold">{row.name}</b>
                      {/* 상태는 색이 아니라 글자로 전달한다(KWCAG) */}
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
                        formatBenefit(row),
                        row.minOrderAmount > 0 ? `${formatKrw(row.minOrderAmount)} 이상` : null,
                        row.scopeKind === "all" ? "전체 상품" : "범위 지정",
                        row.endsAt
                          ? `${new Date(row.endsAt).toLocaleDateString("ko-KR")}까지`
                          : "기한 없음",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>

                  {/* 발급 현황 — 목록에 없으면 소진 여부를 감으로 판단하게 된다 */}
                  <div className="shrink-0 text-[12px] md:text-right">
                    <span className="block font-bold text-foreground">
                      발급 {row.issuedCount}
                      {row.totalQuantity !== null ? ` / ${row.totalQuantity}` : ""}
                    </span>
                    <span className="text-muted-foreground">사용 {row.usedCount}</span>
                  </div>

                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="admin-38"
                      onClick={() => openEditForm(row)}
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
                            { couponId: row.couponId },
                            {
                              onSuccess: () => {
                                showToast("쿠폰을 사용 중지했어요.", { toastVariant: "info" })
                                void queryClient.invalidateQueries(trpc.adminCoupon.pathFilter())
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
