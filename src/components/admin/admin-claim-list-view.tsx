"use client"

// 핸드오프 규격: 관리자 클레임.dc.html — 처리 요약 KPI 4장 + 유형 탭 + 상태 셀렉트 + 목록.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - KPI 카드를 누르면 상태 필터가 걸린다(목업과 동일). 다만 '오늘 처리 완료'는 전체 완료 건수로
//    바꿨다 — '오늘'을 세려면 타임존 경계를 서버가 정해야 하고, 대기열 화면에서 완료 건수의
//    쓸모는 '남은 일'이 아니라 '흐름 확인'이라 날짜 경계가 중요하지 않다.
//  - 검색 입력을 하나로 합쳤다(접수번호·주문번호·신청자명·연락처). 주문 목록과 같은 이유.
//  - '입금 대기' 표식을 추가했다. 교환 배송비 미입금은 교환품 발송을 막는 대기열인데
//    상태(collecting/inspecting)만 봐서는 보이지 않는다.

import * as React from "react"

import Link from "next/link"

import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type ClaimStatusFilter =
  | "all"
  | "requested"
  | "collecting"
  | "inspecting"
  | "done"
  | "rejected"
type ClaimTypeFilter = "all" | "cancel" | "return" | "exchange"

const CLAIM_TYPE_TABS: { typeFilter: ClaimTypeFilter; label: string }[] = [
  { typeFilter: "all", label: "전체" },
  { typeFilter: "cancel", label: "취소" },
  { typeFilter: "return", label: "반품" },
  { typeFilter: "exchange", label: "교환" },
]

const CLAIM_STATUS_OPTIONS: { statusFilter: ClaimStatusFilter; label: string }[] = [
  { statusFilter: "all", label: "전체 상태" },
  { statusFilter: "requested", label: "접수 (승인 대기)" },
  { statusFilter: "collecting", label: "회수/입고 대기" },
  { statusFilter: "inspecting", label: "검수 중" },
  { statusFilter: "done", label: "처리 완료" },
  { statusFilter: "rejected", label: "반려" },
]

/** KPI 카드 — 대기열이 어디에 몰려 있는지. 누르면 그 상태로 필터된다 */
const CLAIM_KPIS: { statusFilter: Exclude<ClaimStatusFilter, "all">; label: string; urgent: boolean }[] =
  [
    { statusFilter: "requested", label: "승인 대기", urgent: true },
    { statusFilter: "collecting", label: "회수/입고 대기", urgent: false },
    { statusFilter: "inspecting", label: "검수 중", urgent: false },
    { statusFilter: "done", label: "처리 완료", urgent: false },
  ]

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function AdminClaimListView() {
  const trpc = useTRPC()

  const [statusFilter, setStatusFilter] = React.useState<ClaimStatusFilter>("all")
  const [typeFilter, setTypeFilter] = React.useState<ClaimTypeFilter>("all")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)

  const listQuery = useQuery(
    trpc.adminClaim.list.queryOptions({
      claimStatus: statusFilter,
      claimTypeFilter: typeFilter,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )

  function submitSearch(event: React.FormEvent) {
    event.preventDefault()
    setAppliedKeyword(keywordInput.trim())
    setPage(1)
  }

  const listResult = listQuery.data
  const lastPage = listResult
    ? Math.max(1, Math.ceil(listResult.totalCount / listResult.pageSize))
    : 1

  return (
    <div className="flex flex-col gap-4">
      {/* 처리 요약 — 대기열이 어디에 쌓였는지 한눈에 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {CLAIM_KPIS.map((kpi) => {
          const kpiCount = listResult?.statusCounts[kpi.statusFilter] ?? 0
          const isActive = statusFilter === kpi.statusFilter
          return (
            <button
              key={kpi.statusFilter}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                setStatusFilter(isActive ? "all" : kpi.statusFilter)
                setPage(1)
              }}
              className={cn(
                "rounded-[var(--radius)] border bg-card px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                isActive ? "border-primary" : "border-border hover:border-foreground",
              )}
            >
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                {kpi.label}
                {/* 색만으로 긴급을 전달하지 않는다 — 점은 장식, 의미는 라벨이 담는다 */}
                {kpi.urgent && kpiCount > 0 ? (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-destructive"
                  />
                ) : null}
              </span>
              <span className="mt-1 block font-heading text-2xl font-extrabold">
                {listQuery.isPending ? "—" : kpiCount}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="클레임 유형 필터" className="flex flex-wrap gap-2">
          {CLAIM_TYPE_TABS.map((typeTab) => (
            <Button
              key={typeTab.typeFilter}
              type="button"
              variant="toggle"
              size="admin-38"
              aria-pressed={typeFilter === typeTab.typeFilter}
              onClick={() => {
                setTypeFilter(typeTab.typeFilter)
                setPage(1)
              }}
            >
              {typeTab.label}
              {listResult ? (
                <span className="ml-1.5 text-[12px] font-bold opacity-70">
                  {listResult.typeCounts[typeTab.typeFilter]}
                </span>
              ) : null}
            </Button>
          ))}
        </div>

        <label className="ml-auto flex items-center gap-2 text-[13px]">
          <span className="sr-only">처리 상태</span>
          <select
            className="h-[38px] rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as ClaimStatusFilter)
              setPage(1)
            }}
          >
            {CLAIM_STATUS_OPTIONS.map((statusOption) => (
              <option key={statusOption.statusFilter} value={statusOption.statusFilter}>
                {statusOption.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <form role="search" className="flex gap-2" onSubmit={submitSearch}>
        <Input
          size="admin"
          type="search"
          aria-label="클레임 검색"
          placeholder="접수번호·주문번호·신청자명·연락처"
          className="max-w-[340px]"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
        />
        <Button type="submit" variant="neutral-solid" size="admin-40">
          검색
        </Button>
        {appliedKeyword ? (
          <Button
            type="button"
            variant="ghost"
            size="admin-40"
            onClick={() => {
              setKeywordInput("")
              setAppliedKeyword("")
              setPage(1)
            }}
          >
            초기화
          </Button>
        ) : null}
      </form>

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">클레임 목록을 불러오는 중입니다</span>
        </div>
      ) : listQuery.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
          클레임 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (listResult?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">🗂️</span>}
          title="조건에 맞는 클레임이 없어요"
          description="유형·상태 필터나 검색어를 바꿔 보세요."
        />
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            총 <b className="text-foreground">{listResult?.totalCount.toLocaleString("ko-KR")}</b>건
          </p>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.cards.map((claimCard) => (
              <li key={claimCard.claimNo}>
                <Link
                  href={`/admin/claims/${claimCard.claimNo}`}
                  className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="w-[148px] shrink-0 font-mono text-[13px] font-bold">
                    {claimCard.claimNo}
                  </span>

                  <span className="shrink-0 rounded-[6px] bg-secondary px-2 py-0.5 text-[12px] font-bold text-secondary-foreground">
                    {claimCard.claimTypeLabel}
                  </span>

                  <span className="min-w-0 flex-1 text-sm">
                    <b className="font-semibold">{claimCard.leadProductName}</b>
                    {claimCard.itemCount > 1 ? (
                      <span className="text-muted-foreground"> 외 {claimCard.itemCount - 1}건</span>
                    ) : null}
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {claimCard.buyerName} · {claimCard.orderNo} · {claimCard.reasonLabel}
                    </span>
                  </span>

                  {/* 미입금 교환은 발송이 막혀 있는 건이라 목록에서 보여야 한다 */}
                  {claimCard.feeAwaiting ? (
                    <span className="shrink-0 rounded-[5px] bg-secondary px-2 py-0.5 text-[12px] font-bold text-secondary-foreground">
                      입금 대기
                    </span>
                  ) : null}

                  <span
                    className={cn(
                      "shrink-0 rounded-[5px] border px-2 py-0.5 text-[12px] font-bold",
                      claimCard.claimStatus === "requested"
                        ? "border-destructive text-destructive"
                        : claimCard.claimStatus === "rejected"
                          ? "border-border text-muted-foreground"
                          : "border-primary text-primary",
                    )}
                  >
                    {claimCard.claimStatusLabel}
                  </span>

                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {formatDate(claimCard.requestedAt)}
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
