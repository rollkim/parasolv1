"use client"

// 핸드오프 규격: 주문상세.dc.html — 주문일자·주문번호·상태 배지 / 배송조회(택배사·마스킹 송장·
// 4단계 타임라인) / 주문 상품 / 결제 정보 / 배송지 + 우측 액션(교환·반품·주문취소·재주문·리뷰).
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 클레임 버튼(교환/반품/주문취소)을 **서버 판정으로 조건부 노출**한다. 목업은 주문 상태와
//    무관하게 항상 3개를 보여주는데, 배송 중 주문에 '주문 취소'가 보이면 눌렀을 때 거부된다.
//    가능 유형은 서버(availableClaimTypes)가 도메인 규칙으로 계산해 내려준다 — 화면이 자체
//    조건을 두면 서버 검증과 어긋난다.
//  - 클레임 신청 폼은 아직 없다(C5) — 지금은 진입 버튼만 두고 안내 토스트를 띄운다.
//  - 도착 예정일 미표시: 리드타임 정책이 없어 계산 근거가 없다(주문완료·비회원조회와 같은 판단).
//  - 배송조회는 토스트 안내 — 택배사 추적 연동이 없다.
//  - 재주문·리뷰는 범위 밖(리뷰는 6주차) — 목업의 하단 2분할 대신 두지 않는다.

import Link from "next/link"

import { useQuery } from "@tanstack/react-query"

import { ImagePlaceholder } from "@/components/store/image-placeholder"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

const CLAIM_TYPE_LABELS: Record<string, string> = {
  cancel: "주문 취소",
  exchange: "교환 신청",
  return: "반품 신청",
}

function formatDateTime(value: Date | null): string | null {
  if (!value) return null
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function OrderDetailView({ orderNo }: { orderNo: string }) {
  const trpc = useTRPC()
  const { showToast } = useToast()

  const orderQuery = useQuery(trpc.order.getMyOrderDetail.queryOptions({ orderNo }))
  const orderView = orderQuery.data

  if (orderQuery.isPending) {
    return (
      <div className="flex min-h-60 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">주문 정보를 불러오는 중입니다</span>
      </div>
    )
  }

  if (orderQuery.isError || !orderView) {
    return (
      <div className="py-16 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          주문 정보를 확인할 수 없습니다. 주문 내역에서 다시 시도해 주세요.
        </p>
        <Button variant="outline" size="sm-46" className="mt-4" asChild>
          <Link href="/mypage">주문 내역으로</Link>
        </Button>
      </div>
    )
  }

  const { amounts, paymentSummary, shippingAddress, timeline } = orderView
  const approvedAtText = formatDateTime(paymentSummary?.approvedAt ?? null)

  const paymentRows = [
    { label: "총 상품금액", value: formatKrw(amounts.listTotal) },
    ...(amounts.productDiscount > 0
      ? [{ label: "상품 할인", value: `-${formatKrw(amounts.productDiscount)}`, emphasis: true }]
      : []),
    ...(amounts.addonTotal > 0
      ? [{ label: "추가상품", value: `+${formatKrw(amounts.addonTotal)}` }]
      : []),
    { label: "배송비", value: amounts.shippingFee === 0 ? "무료" : formatKrw(amounts.shippingFee) },
  ]

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-5">
        {/* 주문 헤더 + 진행 타임라인 */}
        <section className="rounded-[var(--radius)] border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 text-[13px] text-muted-foreground">
                {formatDateTime(orderView.orderedAt)} 주문
              </p>
              <p className="m-0 font-heading text-base font-extrabold">{orderView.orderNo}</p>
            </div>
            {/* 상태는 색만으로 전달하지 않는다 — 배지 안에 한글 라벨(KWCAG) */}
            <span className="rounded-[6px] border border-primary px-2.5 py-1 text-[13px] font-bold text-primary">
              {orderView.orderStatusLabel}
            </span>
          </div>

          {timeline.outOfTimeline ? (
            <p className="m-0 mt-4 rounded-[calc(var(--radius)-2px)] border border-border bg-muted/40 px-3.5 py-3 text-[13px] text-muted-foreground">
              {orderView.orderStatus === "cancelled"
                ? "취소된 주문이에요. 결제하신 금액은 환불 처리됩니다."
                : "아직 결제가 완료되지 않은 주문이에요."}
            </p>
          ) : (
            <ol className="m-0 mt-4 flex list-none gap-1 p-0">
              {timeline.steps.map((step, stepIndex) => {
                const reached = timeline.currentStep !== null && stepIndex <= timeline.currentStep
                const isCurrent = stepIndex === timeline.currentStep
                return (
                  <li key={step} className="flex-1 text-center">
                    <div
                      aria-hidden="true"
                      className={cn("h-1 rounded-full", reached ? "bg-primary" : "bg-border")}
                    />
                    <span
                      className={cn(
                        "mt-1.5 block text-[11px]",
                        isCurrent ? "font-bold text-primary" : "text-muted-foreground",
                      )}
                    >
                      {step}
                      {isCurrent ? <span className="sr-only"> (현재 단계)</span> : null}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          {orderView.shipmentSummary?.maskedTrackingNo ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <p className="m-0 text-[13px] text-muted-foreground">
                {orderView.shipmentSummary.carrierCode ?? "택배"} · 송장번호{" "}
                {orderView.shipmentSummary.maskedTrackingNo}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm-44"
                className="ml-auto"
                onClick={() =>
                  showToast("배송 조회는 준비 중이에요. 택배사 연동 후 이용하실 수 있어요.", {
                    toastVariant: "info",
                  })
                }
              >
                배송 조회
              </Button>
            </div>
          ) : null}
        </section>

        {/* 주문 상품 */}
        <section
          aria-labelledby="detail-items-heading"
          className="rounded-[var(--radius)] border border-border bg-card p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="detail-items-heading" className="m-0 font-heading text-base font-extrabold">
              주문 상품
            </h2>
            <span className="text-[13px] text-muted-foreground">
              총 {orderView.items.length}건
            </span>
          </div>
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {orderView.items.map((item) => (
              <li key={item.orderItemId} className="flex items-start gap-3">
                <div className="size-16 shrink-0 overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border">
                  {item.thumbnailPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailPath}
                      alt={item.thumbnailAlt ?? item.productName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImagePlaceholder />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {item.makerName ? (
                    <p className="m-0 text-xs text-muted-foreground">{item.makerName}</p>
                  ) : null}
                  <p className="m-0 text-sm font-bold">{item.productName}</p>
                  <p className="m-0 text-[13px] text-muted-foreground">
                    {[item.optionLabel, `수량 ${item.quantity}`].filter(Boolean).join(" · ")}
                  </p>
                  {item.addons.map((addon) => (
                    <p key={addon.addonName} className="m-0 text-xs text-muted-foreground">
                      추가 · {addon.addonName} (+{formatKrw(addon.unitPrice)})
                    </p>
                  ))}
                </div>
                <span className="shrink-0 text-sm font-bold">{formatKrw(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 결제 정보 */}
        <section
          aria-labelledby="detail-payment-heading"
          className="rounded-[var(--radius)] border border-border bg-card p-5"
        >
          <h2 id="detail-payment-heading" className="m-0 font-heading text-base font-extrabold">
            결제 정보
          </h2>
          {paymentSummary?.methodLabel || approvedAtText ? (
            <dl className="mt-3 flex flex-col gap-2 border-b border-border pb-3 text-[13px]">
              {paymentSummary?.methodLabel ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">결제수단</dt>
                  <dd className="m-0 font-bold">{paymentSummary.methodLabel}</dd>
                </div>
              ) : null}
              {approvedAtText ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">결제일시</dt>
                  <dd className="m-0 font-bold">{approvedAtText}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <dl className="mt-3 flex flex-col gap-2 text-[13px]">
            {paymentRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className={cn("m-0 font-bold", row.emphasis && "text-destructive")}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-bold">결제금액</span>
            <strong className="font-heading text-lg font-extrabold">
              {formatKrw(amounts.grandTotal)}
            </strong>
          </div>
        </section>

        {/* 배송지 */}
        <section
          aria-labelledby="detail-address-heading"
          className="rounded-[var(--radius)] border border-border bg-card p-5"
        >
          <h2 id="detail-address-heading" className="m-0 font-heading text-base font-extrabold">
            배송지
          </h2>
          <p className="m-0 mt-3 text-sm font-bold">{shippingAddress.recipient}</p>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {shippingAddress.phone}
            <br />({shippingAddress.zipcode}) {shippingAddress.addr1}
            {shippingAddress.addr2 ? `, ${shippingAddress.addr2}` : ""}
          </p>
          {shippingAddress.deliveryMemo ? (
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">
              배송 메모 · {shippingAddress.deliveryMemo}
            </p>
          ) : null}
        </section>
      </div>

      {/* 액션 — 신청 가능한 클레임만 보여준다(서버 판정) */}
      <aside className="self-start lg:sticky lg:top-4">
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h2 className="m-0 font-heading text-base font-extrabold">주문 관리</h2>

          {orderView.availableClaimTypes.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              {orderView.availableClaimTypes.map((claimType) => (
                <Button
                  key={claimType}
                  variant={claimType === "cancel" ? "ghost" : "outline"}
                  size="sm-46"
                  asChild
                >
                  <Link href={`/order/${orderView.orderNo}/claim?type=${claimType}`}>
                    {CLAIM_TYPE_LABELS[claimType]}
                  </Link>
                </Button>
              ))}
            </div>
          ) : (
            <p className="m-0 mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {orderView.orderStatus === "shipping"
                ? "배송이 시작되어 취소할 수 없어요. 배송 완료 후 반품·교환을 신청할 수 있습니다."
                : "지금은 신청할 수 있는 취소·교환·반품이 없어요."}
            </p>
          )}

          <div className="mt-4 border-t border-border pt-3">
            <Link
              href="/terms/delivery"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
            >
              교환·반품 안내 보기
            </Link>
          </div>
        </div>

        <Button variant="outline" size="md-50" className="mt-3 w-full" asChild>
          <Link href="/mypage">주문 내역으로</Link>
        </Button>
      </aside>
    </div>
  )
}
