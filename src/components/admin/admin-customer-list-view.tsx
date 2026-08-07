"use client"

// 핸드오프 규격: 관리자 회원관리.dc.html — 검색/필터 + 상태 탭 + 목록(주문·누적구매·가입일).
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **적립금 지급 버튼·등급 수동 변경은 두지 않았다.** 등급은 일일 배치가 기준대로 정한다 —
//    수동 변경은 다음 산정에서 되돌아가는 거짓 약속이 된다. 기준 편집은 상단 접이식 카드.
//  - 상태는 정지(is_active)와 탈퇴(deleted_at) 두 축이다 — 탭도 그대로 나눈다.
//  - 누적 구매액은 취소 주문을 뺀다. 취소를 포함하면 '많이 산 고객'을 잘못 고른다.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type CustomerTab = "all" | "active" | "suspended" | "withdrawn"
type CustomerSort = "recent" | "spending" | "orderCount"

const CUSTOMER_TABS: { tab: CustomerTab; label: string }[] = [
  { tab: "all", label: "전체" },
  { tab: "active", label: "정상" },
  { tab: "suspended", label: "정지" },
  { tab: "withdrawn", label: "탈퇴" },
]

const CUSTOMER_SORTS: { sort: CustomerSort; label: string }[] = [
  { sort: "recent", label: "최근 가입순" },
  { sort: "spending", label: "누적 구매순" },
  { sort: "orderCount", label: "주문 많은순" },
]

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

/**
 * 등급 기준 편집 — 접이식 카드.
 *
 * 별도 메뉴로 빼지 않은 이유: 등급은 회원의 속성이라 회원 관리에서 찾는 게 자연스럽고,
 * 편집 빈도가 낮은 화면에 내비 항목을 늘리면 매일 쓰는 메뉴가 묻힌다.
 */
function GradeCriteriaCard() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [isOpen, setIsOpen] = React.useState(false)
  const gradesQuery = useQuery({
    ...trpc.adminCustomer.listGrades.queryOptions(),
    enabled: isOpen,
  })
  const updateMutation = useMutation(trpc.adminCustomer.updateGrade.mutationOptions())

  /** 행별 편집값 — gradeId를 키로 문자열 상태를 든다(입력 중 빈 칸 허용) */
  const [draftByGradeId, setDraftByGradeId] = React.useState<
    Record<number, { gradeName: string; bonusRate: string; minSpend: string }>
  >({})

  const gradeRows = gradesQuery.data ?? []

  function draftOf(gradeRow: (typeof gradeRows)[number]) {
    return (
      draftByGradeId[gradeRow.gradeId] ?? {
        gradeName: gradeRow.gradeName,
        bonusRate: String(gradeRow.bonusRatePerMille),
        minSpend: String(gradeRow.minRecentSpend),
      }
    )
  }

  function saveGrade(gradeRow: (typeof gradeRows)[number]) {
    if (updateMutation.isPending) return
    const draft = draftOf(gradeRow)
    updateMutation.mutate(
      {
        gradeId: gradeRow.gradeId,
        gradeName: draft.gradeName,
        bonusRatePerMille: Number(draft.bonusRate.replace(/[^0-9]/g, "")) || 0,
        minRecentSpend: Number(draft.minSpend.replace(/[^0-9]/g, "")) || 0,
      },
      {
        onSuccess: () => {
          showToast(`${draft.gradeName} 기준을 저장했어요. 다음 산정부터 반영됩니다.`, {
            toastVariant: "info",
          })
          void queryClient.invalidateQueries(trpc.adminCustomer.pathFilter())
        },
        onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-4 text-left"
      >
        <b className="text-sm font-extrabold">등급 기준 관리</b>
        <span className="text-[12px] text-muted-foreground">
          {isOpen ? "접기" : "펼치기 — 보너스 적립률·승급 기준"}
        </span>
      </button>

      {isOpen ? (
        <div className="border-t border-border p-4">
          {/* 산정 시점을 밝힌다 — 저장했는데 등급이 안 바뀌면 고장으로 보인다 */}
          <p className="m-0 mb-3 text-[12px] text-muted-foreground">
            기준은 <b className="text-foreground">최근 90일 구매확정 실결제액</b>이며, 매일 새벽
            배치에서 승급·강등이 자동 반영됩니다. 저장 즉시 등급이 바뀌지 않습니다.
          </p>

          {gradesQuery.isPending ? (
            <div className="flex min-h-20 items-center justify-center" aria-busy="true">
              <Spinner />
              <span className="sr-only">등급 기준을 불러오는 중입니다</span>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {gradeRows.map((gradeRow) => {
                const draft = draftOf(gradeRow)
                return (
                  <li
                    key={gradeRow.gradeId}
                    className="flex flex-wrap items-end gap-3 rounded-[calc(var(--radius)-2px)] border border-border p-3"
                  >
                    <div className="flex w-[140px] flex-col gap-1">
                      <label
                        htmlFor={`grade-name-${gradeRow.gradeId}`}
                        className="text-[12px] font-semibold text-muted-foreground"
                      >
                        등급 이름
                      </label>
                      <Input
                        id={`grade-name-${gradeRow.gradeId}`}
                        size="admin"
                        value={draft.gradeName}
                        onChange={(event) =>
                          setDraftByGradeId((previous) => ({
                            ...previous,
                            [gradeRow.gradeId]: { ...draft, gradeName: event.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="flex w-[150px] flex-col gap-1">
                      <label
                        htmlFor={`grade-bonus-${gradeRow.gradeId}`}
                        className="text-[12px] font-semibold text-muted-foreground"
                      >
                        추가 적립률 (0.1%)
                      </label>
                      <Input
                        id={`grade-bonus-${gradeRow.gradeId}`}
                        size="admin"
                        inputMode="numeric"
                        value={draft.bonusRate}
                        onChange={(event) =>
                          setDraftByGradeId((previous) => ({
                            ...previous,
                            [gradeRow.gradeId]: { ...draft, bonusRate: event.target.value },
                          }))
                        }
                      />
                      <span className="text-[11px] text-muted-foreground">
                        = +{((Number(draft.bonusRate) || 0) / 10).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex w-[170px] flex-col gap-1">
                      <label
                        htmlFor={`grade-min-${gradeRow.gradeId}`}
                        className="text-[12px] font-semibold text-muted-foreground"
                      >
                        승급 기준 (원)
                      </label>
                      <Input
                        id={`grade-min-${gradeRow.gradeId}`}
                        size="admin"
                        inputMode="numeric"
                        value={draft.minSpend}
                        onChange={(event) =>
                          setDraftByGradeId((previous) => ({
                            ...previous,
                            [gradeRow.gradeId]: { ...draft, minSpend: event.target.value },
                          }))
                        }
                      />
                    </div>

                    {/* 영향 범위 — 몇 명이 이 등급인지 보여야 기준 변경이 겁나지 않는다 */}
                    <span className="pb-2.5 text-[12px] text-muted-foreground">
                      현재 {gradeRow.memberCount}명
                    </span>

                    <Button
                      type="button"
                      variant="outline"
                      size="admin-38"
                      className="ml-auto"
                      disabled={updateMutation.isPending}
                      onClick={() => saveGrade(gradeRow)}
                    >
                      저장
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}

export function AdminCustomerListView() {
  const trpc = useTRPC()

  const [activeTab, setActiveTab] = React.useState<CustomerTab>("all")
  const [sort, setSort] = React.useState<CustomerSort>("recent")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)

  const listQuery = useQuery(
    trpc.adminCustomer.list.queryOptions({
      tab: activeTab,
      sort,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )

  const listResult = listQuery.data
  const lastPage = listResult
    ? Math.max(1, Math.ceil(listResult.totalCount / listResult.pageSize))
    : 1

  return (
    <div className="flex flex-col gap-4">
      <GradeCriteriaCard />

      <div role="group" aria-label="회원 상태 필터" className="flex flex-wrap gap-2">
        {CUSTOMER_TABS.map((tabItem) => (
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
            aria-label="회원 검색"
            placeholder="이름·이메일·연락처"
            className="max-w-[280px]"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Button type="submit" variant="neutral-solid" size="admin-40">
            검색
          </Button>
        </form>

        <label className="flex items-center gap-2 text-[13px]">
          <span className="sr-only">정렬</span>
          <select
            className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
            value={sort}
            onChange={(event) => setSort(event.target.value as CustomerSort)}
          >
            {CUSTOMER_SORTS.map((sortOption) => (
              <option key={sortOption.sort} value={sortOption.sort}>
                {sortOption.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">회원 목록을 불러오는 중입니다</span>
        </div>
      ) : listQuery.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
          회원 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (listResult?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">👤</span>}
          title="조건에 맞는 회원이 없어요"
          description="탭이나 검색어를 바꿔 보세요."
        />
      ) : (
        <>
          <p className="m-0 text-[13px] text-muted-foreground">
            총 <b className="text-foreground">{listResult?.totalCount.toLocaleString("ko-KR")}</b>명
          </p>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.cards.map((customerCard) => (
              <li key={customerCard.customerId}>
                <Link
                  href={`/admin/customers/${customerCard.customerId}`}
                  className={cn(
                    // 모바일은 세로 2단, md 이상에서 한 줄. 한 줄로 두면 이름이 min-w-0이라
                    // 0까지 눌려 한글이 세로로 쪼개진다(flex-wrap이 발동하지 않는다)
                    "flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-3.5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "md:flex-row md:flex-wrap md:items-center md:gap-3",
                    customerCard.isWithdrawn && "opacity-60",
                  )}
                >
                  <span className="min-w-0 text-sm md:flex-1">
                    <span className="flex items-center gap-1.5">
                      <b className="font-semibold">{customerCard.name}</b>
                      {/* 등급 — 미배정(null)은 기본 등급이라 뱃지를 달지 않는다(전원 '일반' 도배 방지) */}
                      {customerCard.gradeName ? (
                        <span className="rounded-full border border-primary px-1.5 py-px text-[11px] font-bold text-primary">
                          {customerCard.gradeName}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {[customerCard.email, customerCard.phone].filter(Boolean).join(" · ") ||
                        "연락처 없음"}
                    </span>
                  </span>

                  {/* 상태부 — 모바일에서는 아래 단으로 내려가 자기들끼리 줄바꿈한다 */}
                  <span className="flex flex-wrap items-center gap-2 md:contents">
                    {/* 상태는 색이 아니라 문구가 전달한다 */}
                    <span
                      className={cn(
                        "shrink-0 rounded-[5px] border px-2 py-0.5 text-[12px] font-bold",
                        customerCard.isWithdrawn
                          ? "border-border text-muted-foreground"
                          : customerCard.isActive
                            ? "border-primary text-primary"
                            : "border-destructive text-destructive",
                      )}
                    >
                      {customerCard.statusLabel}
                    </span>

                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      주문 {customerCard.orderCount}건
                    </span>
                    <span className="shrink-0 text-sm font-bold">
                      {formatKrw(customerCard.totalSpending)}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {formatDate(customerCard.joinedAt)} 가입
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

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
