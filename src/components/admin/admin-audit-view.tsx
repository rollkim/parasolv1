"use client"

// 운영 기록 — 네 원장(주문·클레임·재고·환불)의 읽기 전용 창.
// "이 주문 누가 취소했어요?" 같은 CS 분쟁에 DB를 열지 않고 답하는 화면이다.

import * as React from "react"

import { useQuery } from "@tanstack/react-query"

import { AdminPagination } from "@/components/admin/admin-pagination"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Spinner } from "@/components/ui/spinner"
import { useTRPC } from "@/trpc/client"

type AuditKind = "order" | "claim" | "stock" | "refund"

const AUDIT_TABS: { kind: AuditKind; label: string }[] = [
  { kind: "order", label: "주문 이력" },
  { kind: "claim", label: "클레임 이력" },
  { kind: "stock", label: "재고 변동" },
  { kind: "refund", label: "환불 원장" },
]

/** actor 규약("admin:1"·"customer:5"·"system")을 읽기 좋게 — 원문도 남긴다(감사 화면) */
function actorLabel(actor: string): string {
  if (actor === "system") return "시스템"
  if (actor.startsWith("admin:")) return `관리자 #${actor.slice(6)}`
  if (actor.startsWith("customer:")) return `고객 #${actor.slice(9)}`
  return actor
}

function formatDateTime(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function AdminAuditView() {
  const trpc = useTRPC()
  const [activeKind, setActiveKind] = React.useState<AuditKind>("order")
  const [page, setPage] = React.useState(1)

  const listQuery = useQuery(trpc.adminAudit.list.queryOptions({ kind: activeKind, page }))
  const listResult = listQuery.data

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="기록 종류" className="flex flex-wrap gap-2">
        {AUDIT_TABS.map((tabItem) => (
          <Button
            key={tabItem.kind}
            type="button"
            variant="toggle"
            size="admin-38"
            aria-pressed={activeKind === tabItem.kind}
            onClick={() => {
              setActiveKind(tabItem.kind)
              setPage(1)
            }}
          >
            {tabItem.label}
          </Button>
        ))}
      </div>

      <p className="m-0 text-[12px] text-muted-foreground">
        상태 이력·재고·환불 원장을 그대로 보여줍니다. 기록은 지울 수 없습니다 — 지울 수 있으면
        감사 기록이 아닙니다.
      </p>

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">기록을 불러오는 중입니다</span>
        </div>
      ) : (listResult?.rows.length ?? 0) === 0 ? (
        <EmptyState
          size="panel"
          headingLevel={2}
          title="기록이 없어요"
          description="주문·클레임이 생기면 이곳에 이력이 쌓입니다."
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {listResult?.rows.map((row, index) => (
              <li
                key={`${row.refLabel}-${row.occurredAt}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-[calc(var(--radius)-2px)] border border-border bg-card px-3.5 py-2.5"
              >
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {formatDateTime(row.occurredAt)}
                </span>
                <b className="shrink-0 text-[13px] font-bold">{row.refLabel}</b>
                <span className="min-w-0 flex-1 text-[13px]">{row.summary}</span>
                <span
                  className="shrink-0 text-[12px] text-muted-foreground"
                  title={row.actor}
                >
                  {actorLabel(row.actor)}
                </span>
                {row.memo ? (
                  <span className="block w-full text-[12px] text-muted-foreground">
                    {row.memo}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          <AdminPagination
            page={listResult?.page ?? 1}
            pageSize={listResult?.pageSize ?? 20}
            totalCount={listResult?.totalCount ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
