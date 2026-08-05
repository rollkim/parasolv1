"use client"

// 핸드오프 규격: 관리자 대시보드.dc.html — KPI · 최근 7일 매출 · 처리 대기열 ·
// 카테고리/결제수단 비중 · 시간대 · 재고 부족 · 베스트셀러 · 최근 문의.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **없는 지표는 그리지 않는다.** 결제 전환율(방문 추적 없음)·유입 채널(리퍼러 기록 없음)·
//    월 매출 목표(목표 설정 화면 없음)는 숫자를 만들어낼 수 없다. 그럴듯한 값을 그리면
//    운영자가 그것을 보고 판단한다 — 대신 '아직 못 보여주는 지표'로 이유와 함께 밝힌다.
//  - 차트는 CSS 막대다. 차트 라이브러리를 넣으면 번들이 커지고, 이 화면에 필요한 표현은
//    막대 두 개(이번 주·전주)가 전부다. 값은 막대 옆 숫자로도 읽힌다(색·높이만으로 전달 금지).
//  - 대기열 카드는 해당 관리 화면으로 바로 간다 — 대시보드의 쓸모는 '다음 할 일로 가는 문'이다.

import Link from "next/link"

import { useQuery } from "@tanstack/react-query"

import { Spinner } from "@/components/ui/spinner"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

/** 증감 표기 — 색과 함께 기호·문구를 준다(색만으로 전달 금지) */
function DeltaText({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) {
    return <span className="text-muted-foreground">어제 기록 없음</span>
  }
  const diffRatio = Math.round(((current - previous) / previous) * 100)
  if (diffRatio === 0) return <span className="text-muted-foreground">어제와 같음</span>
  const isUp = diffRatio > 0
  return (
    <span className={cn("font-bold", isUp ? "text-primary" : "text-destructive")}>
      {isUp ? "▲" : "▼"} {Math.abs(diffRatio)}% <span className="font-normal">어제 대비</span>
    </span>
  )
}

function SectionCard({
  title,
  action,
  children,
  id,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  /** KPI 카드가 앵커로 데려올 섹션에만 준다 */
  id?: string
}) {
  return (
    // scroll-mt: 앵커로 점프했을 때 상단 고정 헤더에 제목이 가리지 않게 여백을 확보
    <section id={id} className="scroll-mt-20 rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">{title}</h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** 비중 막대 — 카테고리·결제수단이 같은 표현을 쓴다 */
function ShareList({ items }: { items: { label: string; amount: number; ratio: number }[] }) {
  if (items.length === 0) {
    return <p className="m-0 text-[13px] text-muted-foreground">최근 30일 집계할 데이터가 없어요.</p>
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-semibold">{item.label}</span>
            <span className="text-muted-foreground">
              {formatKrw(item.amount)} · <b className="text-foreground">{item.ratio}%</b>
            </span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${item.label} 비중 ${item.ratio}퍼센트`}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${item.ratio}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function AdminDashboardView() {
  const trpc = useTRPC()
  const summaryQuery = useQuery(trpc.adminDashboard.summary.queryOptions())

  if (summaryQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">대시보드를 불러오는 중입니다</span>
      </div>
    )
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
        대시보드를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  const dashboard = summaryQuery.data
  const maxDailyRevenue = Math.max(
    1,
    ...dashboard.dailyRevenue.flatMap((row) => [row.revenue, row.previousWeekRevenue]),
  )
  const maxHourlyCount = Math.max(1, ...dashboard.hourlyOrders.map((row) => row.count))

  return (
    <div className="flex flex-col gap-4">
      {/* KPI — 전부 눌러서 이동한다. 숫자만 보여주고 끝나면 "그래서 어디를 여나"를
          운영자가 메뉴에서 다시 찾아야 한다. 집계 카드(처리 대기·미답변)는 세부 항목이
          여러 갈래라 페이지 대신 아래 해당 섹션으로 데려간다(거기서 갈래를 고른다) */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Link
          href="/admin/orders"
          className="block rounded-[var(--radius)] border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <p className="m-0 text-[12px] font-semibold text-muted-foreground">오늘 주문</p>
          <p className="m-0 mt-1 font-heading text-2xl font-extrabold">
            {dashboard.kpi.todayOrderCount.toLocaleString("ko-KR")}건
          </p>
          <p className="m-0 mt-1 text-[12px]">
            <DeltaText
              current={dashboard.kpi.todayOrderCount}
              previous={dashboard.kpi.yesterdayOrderCount}
            />
          </p>
        </Link>

        <Link
          href="/admin/orders"
          className="block rounded-[var(--radius)] border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <p className="m-0 text-[12px] font-semibold text-muted-foreground">오늘 매출</p>
          <p className="m-0 mt-1 font-heading text-2xl font-extrabold">
            {formatKrw(dashboard.kpi.todayRevenue)}
          </p>
          <p className="m-0 mt-1 text-[12px]">
            <DeltaText
              current={dashboard.kpi.todayRevenue}
              previous={dashboard.kpi.yesterdayRevenue}
            />
          </p>
        </Link>

        <a
          href="#pending-queue"
          className={cn(
            "block rounded-[var(--radius)] border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            dashboard.kpi.pendingTaskCount > 0 ? "border-primary" : "border-border",
          )}
        >
          <p className="m-0 text-[12px] font-semibold text-muted-foreground">처리 대기</p>
          <p className="m-0 mt-1 font-heading text-2xl font-extrabold">
            {dashboard.kpi.pendingTaskCount.toLocaleString("ko-KR")}건
          </p>
          <p className="m-0 mt-1 text-[12px] text-muted-foreground">
            {dashboard.kpi.pendingTaskCount > 0 ? "아래 대기열에서 처리하세요" : "밀린 일이 없어요"}
          </p>
        </a>

        <a
          href="#inquiry-queue"
          className={cn(
            "block rounded-[var(--radius)] border bg-card p-4 transition-colors hover:border-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            dashboard.kpi.unansweredInquiryCount > 0 ? "border-destructive" : "border-border",
          )}
        >
          <p className="m-0 text-[12px] font-semibold text-muted-foreground">미답변 문의</p>
          <p className="m-0 mt-1 font-heading text-2xl font-extrabold">
            {dashboard.kpi.unansweredInquiryCount.toLocaleString("ko-KR")}건
          </p>
          <p className="m-0 mt-1 text-[12px] text-muted-foreground">
            {dashboard.kpi.unansweredInquiryCount > 0 ? "답변이 필요해요" : "모두 답변했어요"}
          </p>
        </a>
      </div>

      {/* 돈 이상 감지 — 있을 때만 나타난다. 조용할 때 자리를 차지하면 늘 있는 배경이 되어
          정작 떴을 때 아무도 안 본다. 알림 채널(알림톡)이 붙기 전까지 이 카드가 유일한 경보다 */}
      {dashboard.moneyAnomalies.length > 0 ? (
        <section
          role="alert"
          aria-labelledby="dashboard-anomaly-heading"
          className="rounded-[var(--radius)] border-2 border-destructive bg-destructive/5 p-4"
        >
          <h2
            id="dashboard-anomaly-heading"
            className="m-0 font-heading text-[15px] font-extrabold text-destructive"
          >
            ⚠ 환불 확인 필요 {dashboard.moneyAnomalies.length}건
          </h2>
          <p className="m-0 mt-1 text-[12px] text-muted-foreground">
            주문은 취소됐는데 결제 취소 기록이 없습니다 — 고객 돈이 걸려 있으니 먼저 처리하세요.
          </p>
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-1.5 p-0">
            {dashboard.moneyAnomalies.map((anomaly) => (
              <li key={anomaly.orderNo} className="flex flex-wrap items-center gap-2 text-[13px]">
                <Link
                  href={`/admin/orders?keyword=${encodeURIComponent(anomaly.orderNo)}`}
                  className="font-bold text-destructive underline-offset-2 hover:underline"
                >
                  {anomaly.orderNo}
                </Link>
                <span className="font-bold">{formatKrw(anomaly.grandTotal)}</span>
                <span className="text-muted-foreground">{anomaly.detectedNote}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 처리 대기열 — 다음 할 일로 가는 문 */}
      <SectionCard id="pending-queue" title="처리 대기열">
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 md:grid-cols-5">
          {dashboard.queue.map((queueItem) => (
            <li key={queueItem.queueKey}>
              <Link
                href={queueItem.href}
                className={cn(
                  "flex flex-col rounded-[calc(var(--radius)-4px)] border p-3 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  queueItem.count > 0 ? "border-border" : "border-border opacity-60",
                )}
              >
                <span className="font-heading text-xl font-extrabold">{queueItem.count}</span>
                <span className="text-[12px] text-muted-foreground">{queueItem.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* 문의 처리 대기 — 총합 하나로는 어디를 열어야 할지 모른다. 메뉴별로 쪼개 바로 보낸다.
          대기 0인 줄도 남긴다: 사라지면 "그 메뉴가 없는 건지 0인 건지"를 구분할 수 없다 */}
      <SectionCard id="inquiry-queue" title="문의 처리 대기">
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
          {dashboard.inquiryQueue.map((inquiryItem) => (
            <li key={inquiryItem.inquiryKind}>
              <Link
                href={inquiryItem.href}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-[calc(var(--radius)-4px)] border p-3 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  inquiryItem.count > 0 ? "border-border" : "border-border opacity-60",
                )}
              >
                <span className="text-[13px] font-semibold">{inquiryItem.label}</span>
                <span
                  className={cn(
                    "font-heading text-xl font-extrabold",
                    inquiryItem.count > 0 && "text-destructive",
                  )}
                >
                  {inquiryItem.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <SectionCard
            title="최근 7일 매출"
            action={
              <span className="text-[13px] text-muted-foreground">
                합계 <b className="text-foreground">{formatKrw(dashboard.weekRevenueTotal)}</b>
              </span>
            }
          >
            {/* 값은 막대 아래 숫자로도 읽힌다 — 높이만으로 전달하지 않는다 */}
            <ul className="m-0 flex list-none items-end gap-2 p-0">
              {dashboard.dailyRevenue.map((day) => (
                <li key={day.reportDate} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    {day.revenue === 0 ? "-" : `${Math.round(day.revenue / 10000)}만`}
                  </span>
                  <div className="flex h-[120px] w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/3 rounded-t bg-muted"
                      style={{ height: `${(day.previousWeekRevenue / maxDailyRevenue) * 100}%` }}
                      title="전주 같은 요일"
                    />
                    <div
                      className="w-1/2 rounded-t bg-primary"
                      style={{ height: `${(day.revenue / maxDailyRevenue) * 100}%` }}
                    />
                  </div>
                  <span className="text-[12px] font-bold">{day.weekdayLabel}</span>
                  <span className="text-[11px] text-muted-foreground">{day.orderCount}건</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 text-[12px] text-muted-foreground">
              진한 막대가 이번 주, 옅은 막대가 전주 같은 요일입니다.
            </p>
          </SectionCard>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SectionCard title="카테고리별 매출 (30일)">
              <ShareList items={dashboard.categoryRevenue} />
            </SectionCard>
            <SectionCard title="결제수단 비중 (30일)">
              <ShareList items={dashboard.paymentMethodShare} />
            </SectionCard>
          </div>

          <SectionCard title="시간대별 주문 (7일)">
            <ul className="m-0 flex list-none items-end gap-2 p-0">
              {dashboard.hourlyOrders.map((slot) => (
                <li key={slot.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[12px] font-bold">{slot.count}</span>
                  <div className="flex h-[72px] w-full items-end justify-center">
                    <div
                      className="w-2/3 rounded-t bg-primary"
                      style={{ height: `${(slot.count / maxHourlyCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-[12px] text-muted-foreground">{slot.label}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <aside className="flex flex-col gap-4">
          <SectionCard title="지표 요약 (7일)">
            <dl className="m-0 flex flex-col gap-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">객단가</dt>
                <dd className="m-0 font-bold">{formatKrw(dashboard.averageOrderValue)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">클레임율 (30일)</dt>
                <dd className="m-0 font-bold">{dashboard.claimRate}%</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            title="재고 부족"
            action={
              <Link href="/admin/products?tab=soldout" className="text-[12px] text-primary underline-offset-2 hover:underline">
                상품 관리
              </Link>
            }
          >
            {dashboard.lowStock.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">재고가 부족한 상품이 없어요.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {dashboard.lowStock.map((item) => (
                  <li
                    key={item.variantId}
                    className="flex items-center justify-between gap-2 text-[13px]"
                  >
                    <span className="min-w-0 truncate">
                      {item.productName}
                      {item.variantLabel ? (
                        <span className="ml-1 text-[12px] text-muted-foreground">
                          {item.variantLabel}
                        </span>
                      ) : null}
                    </span>
                    {/* 품절은 색이 아니라 문구가 전달한다 */}
                    <span
                      className={cn(
                        "shrink-0 font-bold",
                        item.stock === 0 ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {item.stock === 0 ? "품절" : `${item.stock}개`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="베스트셀러 (30일)">
            {dashboard.bestSellers.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">집계할 판매가 없어요.</p>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {dashboard.bestSellers.map((item, itemIndex) => (
                  <li key={item.productId} className="flex items-center gap-2 text-[13px]">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-secondary text-[11px] font-bold text-secondary-foreground">
                      {itemIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.productName}</span>
                    <span className="shrink-0 font-bold">{item.soldQuantity}개</span>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          <SectionCard title="최근 문의">
            {dashboard.recentInquiries.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">아직 문의가 없어요.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {dashboard.recentInquiries.map((inquiry) => (
                  <li key={inquiry.postId}>
                    {/* 링크가 없으면 여기서 본 문의를 메뉴에서 다시 찾아야 한다 */}
                    <Link
                      href={inquiry.href}
                      className="block rounded-[6px] p-1.5 text-[13px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="flex items-center gap-1.5">
                        {!inquiry.isAnswered ? (
                          <span className="shrink-0 rounded-[4px] border border-destructive px-1.5 text-[11px] font-bold text-destructive">
                            미답변
                          </span>
                        ) : null}
                        {inquiry.productName ? (
                          <span className="shrink-0 text-[11px] font-bold text-primary">
                            [{inquiry.productName}]
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate font-semibold">{inquiry.title}</span>
                      </span>
                      {/* 제목만으로는 "aaaaa" 같은 글이 무엇인지 알 수 없다 */}
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {inquiry.contentPreview}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* 왜 어떤 지표가 없는지 밝힌다 — 빈 자리는 의심을 부르고, 가짜 숫자는 오판을 부른다 */}
          <SectionCard title="아직 못 보여주는 지표">
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12px] text-muted-foreground">
              {dashboard.excludedMetrics.map((metric) => (
                <li key={metric.label}>
                  <b className="text-foreground">{metric.label}</b> — {metric.reason}
                </li>
              ))}
            </ul>
          </SectionCard>
        </aside>
      </div>
    </div>
  )
}
