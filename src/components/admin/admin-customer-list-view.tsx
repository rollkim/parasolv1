"use client"

// 핸드오프 규격: 관리자 회원관리.dc.html — 검색/필터 + 상태 탭 + 목록(주문·누적구매·가입일).
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **등급 필터·적립금 지급 버튼을 두지 않았다.** 적립금·회원등급은 2차다(스펙서 §10).
//    원장·소멸 배치 없이 지급 버튼만 만들면 근거 없는 잔액이 쌓인다.
//  - 상태는 정지(is_active)와 탈퇴(deleted_at) 두 축이다 — 탭도 그대로 나눈다.
//  - 누적 구매액은 취소 주문을 뺀다. 취소를 포함하면 '많이 산 고객'을 잘못 고른다.

import * as React from "react"

import Link from "next/link"

import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
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
                    "flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    customerCard.isWithdrawn && "opacity-60",
                  )}
                >
                  <span className="min-w-0 flex-1 text-sm">
                    <b className="font-semibold">{customerCard.name}</b>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {[customerCard.email, customerCard.phone].filter(Boolean).join(" · ") ||
                        "연락처 없음"}
                    </span>
                  </span>

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
