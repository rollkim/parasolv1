"use client"

// 핸드오프 규격: 주문완료.dc.html — 완료 헤드라인 + 주문번호(복사) + 결제 정보 4행 + 배송지 +
// 주문 상품 + 비회원 가입 유도 배너 + 하단 액션(주문 상세 보기 / 쇼핑 계속하기).
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 도착 예정일('7월 23일(목)~24일(금) 도착 예정')은 표시하지 않는다: 리드타임·출고 마감 정책이
//    스펙·site_setting 어디에도 없어 계산 근거가 없다. 날짜 없는 출고 안내 문구만 남긴다
//    (정책이 정해지면 서버가 계산해 내려주는 자리). 근거 없는 날짜를 하드코딩하지 않는다.
//  - 주문 상태를 함께 표시한다(목업엔 없음): 결제 전(pending) 주문도 이 화면에 도달할 수 있어
//    '주문이 완료되었어요'만 보여주면 결제되지 않은 주문을 완료로 오인한다.
//  - 결제일시·결제수단은 승인 전이면 렌더하지 않는다 — 빈 값에 '-'를 채우면 정보가 있는 것처럼 읽힌다.

import Link from "next/link"

import { useQuery } from "@tanstack/react-query"

import { ImagePlaceholder } from "@/components/store/image-placeholder"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

function formatDateTime(value: Date | null): string | null {
  if (!value) return null
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function OrderCompleteView({ orderNo }: { orderNo: string }) {
  const trpc = useTRPC()
  const { showToast } = useToast()

  const orderQuery = useQuery(trpc.order.getOrderResult.queryOptions({ orderNo }))
  const orderView = orderQuery.data

  async function copyOrderNo() {
    try {
      await navigator.clipboard.writeText(orderNo)
      showToast("주문번호를 복사했어요", { toastVariant: "info" })
    } catch {
      showToast("복사에 실패했어요. 주문번호를 길게 눌러 복사해 주세요.", {
        toastVariant: "error",
      })
    }
  }

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
          주문 정보를 확인할 수 없습니다. 주문 조회에서 주문번호와 연락처로 확인해 주세요.
        </p>
        <Button variant="outline" size="sm-46" className="mt-4" asChild>
          <Link href="/order-lookup">주문 조회로 이동</Link>
        </Button>
      </div>
    )
  }

  const { amounts, paymentSummary, shippingAddress } = orderView
  const isPaid = orderView.orderStatus !== "pending"
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
    <div className="mt-6 flex flex-col gap-6">
      {/* 완료 헤드라인 — 결제 전이면 문구를 바꿔 오인을 막는다 */}
      <section className="text-center">
        <h2 className="m-0 font-heading text-[clamp(20px,3vw,26px)] font-extrabold">
          {isPaid ? "주문이 완료되었어요" : "주문서가 만들어졌어요"}
        </h2>
        <p className="m-0 mt-2 text-sm text-muted-foreground">
          {isPaid
            ? "평일 14시 이전 결제 건은 당일 출고돼요."
            : "아직 결제가 완료되지 않았어요. 결제를 마쳐야 주문이 확정됩니다."}
        </p>

        <div className="mt-4 inline-flex flex-wrap items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card px-4 py-3">
          <span className="text-[13px] text-muted-foreground">주문번호</span>
          <strong className="font-heading text-base font-extrabold">{orderView.orderNo}</strong>
          <Button type="button" variant="outline" size="sm-44" onClick={copyOrderNo}>
            복사
          </Button>
        </div>

        <p className="m-0 mt-2 text-[13px]">
          <span className="text-muted-foreground">주문 상태 </span>
          <span className="font-bold">{orderView.orderStatusLabel}</span>
        </p>
      </section>

      {/* 결제 정보 */}
      <section aria-labelledby="complete-payment-heading" className="rounded-[var(--radius)] border border-border bg-card p-5">
        <h3 id="complete-payment-heading" className="m-0 font-heading text-base font-extrabold">
          결제 정보
        </h3>

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
      <section aria-labelledby="complete-address-heading" className="rounded-[var(--radius)] border border-border bg-card p-5">
        <h3 id="complete-address-heading" className="m-0 font-heading text-base font-extrabold">
          배송지
        </h3>
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

      {/* 주문 상품 */}
      <section aria-labelledby="complete-items-heading" className="rounded-[var(--radius)] border border-border bg-card p-5">
        <h3 id="complete-items-heading" className="m-0 font-heading text-base font-extrabold">
          주문 상품 <span className="text-[13px] font-normal text-muted-foreground">총 {orderView.items.length}건</span>
        </h3>
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

      {/* 비회원 가입 유도 — UX 규칙 4: 가입 권유는 주문 완료 후에만 */}
      {orderView.isGuestOrder ? (
        <section className="rounded-[var(--radius)] border border-border bg-accent/10 p-5">
          <h3 className="m-0 font-heading text-base font-extrabold">비회원으로 주문하셨어요</h3>
          <p className="m-0 mt-2 text-[13px] leading-relaxed text-muted-foreground">
            이 주문을 회원 계정에 담아 드리고, 다음 주문부터 배송지·적립 혜택을 간편하게 받을 수 있어요.
          </p>
          <Button variant="primary" size="sm-46" className="mt-3" asChild>
            <Link href="/login">회원가입하고 혜택 받기</Link>
          </Button>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="md-50" asChild>
          {/* 비회원은 세션이 없어 회원 상세로 갈 수 없다 — 주문번호+연락처 조회로 안내한다 */}
          <Link href={orderView.isGuestOrder ? "/order-lookup" : `/order/${orderView.orderNo}`}>
            주문 상세 보기
          </Link>
        </Button>
        <Button variant="primary" size="md-50" asChild>
          <Link href="/products">쇼핑 계속하기</Link>
        </Button>
      </div>
    </div>
  )
}
