"use client"

// 핸드오프 규격: 관리자 주문관리.dc.html — 상태 탭(전체/결제완료/배송준비/배송중/배송완료/취소·반품)
// + 검색 + 목록. 760px 미만은 카드, 이상은 표.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 검색 입력을 하나로 합쳤다(주문번호·주문자명·연락처 동시 검색). CS가 전화를 받으며 쓰는
//    화면이라 '무엇으로 검색할지' 고르게 하면 느려진다.
//  - 엑셀 내보내기·송장 일괄 등록·알림톡 발송은 범위 밖(각각 별도 기능) — 버튼을 두지 않는다.
//    누를 수 있는데 동작하지 않는 버튼은 '되는지 모르는 기능'이 된다.
//  - 상태 뱃지는 도메인 라벨(orderStatusLabel)을 쓴다 — 스토어프론트·알림톡과 표기를 공유한다.

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

type AdminOrderTab = "all" | "paid" | "preparing" | "shipping" | "delivered" | "cancelled"

const ORDER_TABS: { tab: AdminOrderTab; label: string }[] = [
  { tab: "all", label: "전체" },
  { tab: "paid", label: "결제완료" },
  { tab: "preparing", label: "배송준비" },
  { tab: "shipping", label: "배송중" },
  { tab: "delivered", label: "배송완료" },
  { tab: "cancelled", label: "취소/반품" },
]

function formatDate(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export function AdminOrderListView() {
  const trpc = useTRPC()

  const [activeTab, setActiveTab] = React.useState<AdminOrderTab>("all")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)

  const listQuery = useQuery(
    trpc.adminOrder.list.queryOptions({
      tab: activeTab,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )

  function selectTab(tab: AdminOrderTab) {
    setActiveTab(tab)
    setPage(1)
  }

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
      {/* 상태 탭 — 건수 뱃지로 처리할 일이 얼마나 남았는지 한눈에 */}
      <div role="group" aria-label="주문 상태 필터" className="flex flex-wrap gap-2">
        {ORDER_TABS.map((tabItem) => (
          <Button
            key={tabItem.tab}
            type="button"
            variant="toggle"
            size="admin-38"
            aria-pressed={activeTab === tabItem.tab}
            onClick={() => selectTab(tabItem.tab)}
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

      <form role="search" className="flex gap-2" onSubmit={submitSearch}>
        <Input
          size="admin"
          type="search"
          aria-label="주문 검색"
          placeholder="주문번호·주문자명·연락처"
          className="max-w-[320px]"
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
          <span className="sr-only">주문 목록을 불러오는 중입니다</span>
        </div>
      ) : listQuery.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
          주문 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (listResult?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">📦</span>}
          title="조건에 맞는 주문이 없어요"
          description="탭이나 검색어를 바꿔 보세요."
        />
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">
            총 <b className="text-foreground">{listResult?.totalCount.toLocaleString("ko-KR")}</b>건
          </p>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.cards.map((orderCard) => (
              <li key={orderCard.orderNo}>
                {/* 모바일은 세로 3단(주문번호·상태 / 상품·주문자 / 날짜·금액), md 이상에서 한 줄.
                    한 줄로 두면 상품명이 min-w-0이라 0까지 눌려 한글이 세로로 쪼개진다 */}
                <Link
                  href={`/admin/orders/${orderCard.orderNo}`}
                  className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-card p-3.5 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex-row md:flex-wrap md:items-center md:gap-3"
                >
                  <div className="flex flex-wrap items-center gap-2 md:contents">
                    <span className="shrink-0 font-mono text-[13px] font-bold md:w-[132px]">
                      {orderCard.orderNo}
                    </span>

                    <span
                      className={cn(
                        "shrink-0 rounded-[5px] border px-2 py-0.5 text-[12px] font-bold",
                        orderCard.orderStatus === "cancelled"
                          ? "border-destructive text-destructive"
                          : "border-primary text-primary",
                      )}
                    >
                      {orderCard.orderStatusLabel}
                    </span>
                  </div>

                  <span className="min-w-0 text-sm md:flex-1">
                    <b className="font-semibold">{orderCard.leadProductName}</b>
                    {orderCard.itemCount > 1 ? (
                      <span className="text-muted-foreground"> 외 {orderCard.itemCount - 1}건</span>
                    ) : null}
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {orderCard.ordererName} · {orderCard.ordererPhone}
                      {orderCard.isGuestOrder ? " · 비회원" : ""}
                    </span>
                  </span>

                  <div className="flex flex-wrap items-center gap-2 md:contents">
                    {/* 배송준비 상태인데 송장이 없으면 '해야 할 일'이라 눈에 띄게 둔다 */}
                    {orderCard.orderStatus === "preparing" && !orderCard.hasTrackingNo ? (
                      <span className="shrink-0 rounded-[5px] bg-secondary px-2 py-0.5 text-[12px] font-bold text-secondary-foreground">
                        송장 필요
                      </span>
                    ) : null}

                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {formatDate(orderCard.orderedAt)}
                    </span>
                    <span className="shrink-0 text-sm font-bold">
                      {formatKrw(orderCard.grandTotal)}
                    </span>
                  </div>
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
