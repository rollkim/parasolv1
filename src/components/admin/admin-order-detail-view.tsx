"use client"

// 핸드오프 규격: 관리자 주문관리.dc.html 상세 — 진행 단계 · 주문/결제/배송 정보 · 송장 등록 ·
// 상태 변경. 목업의 '배송 준비중 처리'·'송장 등록' 동작을 그대로 따른다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 상태 변경 버튼을 **서버 판정으로만** 그린다(nextStatuses). 목업은 '다음 단계' 버튼을
//    상태와 무관하게 두는데, 불법 전이를 누르면 서버가 거부한다 — 눌러야 아는 버튼이 된다.
//  - 취소는 여기서 하지 않는다. 환불이 걸린 작업이라 클레임(관리자 클레임 화면)이 맡는다 —
//    주문 상태만 cancelled로 바꾸면 돈이 남는다.
//  - 알림톡 발송·엑셀 내보내기는 범위 밖이라 버튼을 두지 않는다.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { useTRPC } from "@/trpc/client"

/** 택배사 — common_code(carrier)로 옮기기 전까지의 최소 목록(목업 4종) */
const CARRIERS: { code: string; label: string }[] = [
  { code: "cj", label: "CJ대한통운" },
  { code: "hanjin", label: "한진택배" },
  { code: "lotte", label: "롯데택배" },
  { code: "post", label: "우체국택배" },
]

function formatDateTime(value: Date | null): string | null {
  if (!value) return null
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function AdminOrderDetailView({ orderNo }: { orderNo: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const detailQuery = useQuery(trpc.adminOrder.detail.queryOptions({ orderNo }))
  const registerInvoiceMutation = useMutation(trpc.adminOrder.registerInvoice.mutationOptions())
  const changeStatusMutation = useMutation(trpc.adminOrder.changeStatus.mutationOptions())

  const [carrierCode, setCarrierCode] = React.useState(CARRIERS[0].code)
  const [trackingNo, setTrackingNo] = React.useState("")

  const orderDetail = detailQuery.data

  function refreshOrder() {
    void queryClient.invalidateQueries(trpc.adminOrder.pathFilter())
  }

  function submitInvoice(event: React.FormEvent) {
    event.preventDefault()
    if (registerInvoiceMutation.isPending) return
    if (!trackingNo.trim()) {
      showToast("송장번호를 입력해 주세요.", { toastVariant: "error" })
      return
    }
    registerInvoiceMutation.mutate(
      { orderNo, carrierCode, trackingNo: trackingNo.trim() },
      {
        onSuccess: () => {
          showToast("송장을 등록하고 배송중으로 변경했어요.", { toastVariant: "info" })
          setTrackingNo("")
          refreshOrder()
        },
        onError: (invoiceError) => showToast(invoiceError.message, { toastVariant: "error" }),
      },
    )
  }

  function moveStatus(toStatus: string, label: string) {
    if (changeStatusMutation.isPending) return
    changeStatusMutation.mutate(
      { orderNo, toStatus },
      {
        onSuccess: () => {
          showToast(`${label}(으)로 변경했어요.`, { toastVariant: "info" })
          refreshOrder()
        },
        onError: (statusError) => showToast(statusError.message, { toastVariant: "error" }),
      },
    )
  }

  if (detailQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">주문을 불러오는 중입니다</span>
      </div>
    )
  }

  if (detailQuery.isError || !orderDetail) {
    return (
      <div className="py-12 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {detailQuery.error?.message ?? "주문을 불러오지 못했습니다."}
        </p>
        <Button variant="outline" size="admin-40" className="mt-4" asChild>
          <Link href="/admin/orders">주문 목록으로</Link>
        </Button>
      </div>
    )
  }

  const approvedAtText = formatDateTime(orderDetail.paymentSummary?.approvedAt ?? null)
  // 송장 등록은 배송준비 상태에서만 가능하다(서버도 같은 조건으로 막는다)
  const canRegisterInvoice = orderDetail.orderStatus === "preparing"

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 font-mono text-base font-bold">{orderDetail.orderNo}</p>
              <p className="m-0 text-[12px] text-muted-foreground">
                {formatDateTime(orderDetail.orderedAt)} 주문
              </p>
            </div>
            <span className="rounded-[5px] border border-primary px-2.5 py-1 text-[13px] font-bold text-primary">
              {orderDetail.orderStatusLabel}
            </span>
          </div>

          {/* 서버가 허용한 전이만 버튼으로 나온다 — 눌러야 아는 버튼을 만들지 않는다 */}
          {orderDetail.nextStatuses.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {orderDetail.nextStatuses.map((nextStatus) => (
                <Button
                  key={nextStatus.status}
                  type="button"
                  variant={nextStatus.status === "cancelled" ? "destructive-outline" : "primary"}
                  size="admin-38"
                  // 취소는 환불이 걸려 클레임이 맡는다 — 여기서 상태만 바꾸면 돈이 남는다
                  disabled={nextStatus.status === "cancelled"}
                  title={
                    nextStatus.status === "cancelled"
                      ? "취소·환불은 클레임 관리에서 처리합니다"
                      : undefined
                  }
                  onClick={() => moveStatus(nextStatus.status, nextStatus.label)}
                >
                  {nextStatus.label}(으)로 변경
                </Button>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">주문 상품</h2>
          <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
            {orderDetail.items.map((item) => (
              <li key={item.orderItemId} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <b className="font-semibold">{item.productName}</b>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {[item.optionLabel, `수량 ${item.quantity}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 font-bold">{formatKrw(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">상품금액</dt>
              <dd className="m-0 font-bold">{formatKrw(orderDetail.amounts.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">배송비</dt>
              <dd className="m-0 font-bold">
                {orderDetail.amounts.shippingFee === 0
                  ? "무료"
                  : formatKrw(orderDetail.amounts.shippingFee)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5">
              <dt className="font-bold">결제금액</dt>
              <dd className="m-0 font-heading text-base font-extrabold">
                {formatKrw(orderDetail.amounts.grandTotal)}
              </dd>
            </div>
          </dl>
          {orderDetail.paymentSummary ? (
            <p className="m-0 mt-2 text-[12px] text-muted-foreground">
              {orderDetail.paymentSummary.methodLabel ?? "결제수단 미확인"}
              {approvedAtText ? ` · ${approvedAtText}` : ""} · 상태{" "}
              {orderDetail.paymentSummary.status}
            </p>
          ) : null}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">배송 정보</h2>
          <p className="m-0 mt-2.5 text-sm font-bold">{orderDetail.shippingAddress.recipient}</p>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {orderDetail.shippingAddress.phone}
            <br />({orderDetail.shippingAddress.zipcode}) {orderDetail.shippingAddress.addr1}
            {orderDetail.shippingAddress.addr2 ? `, ${orderDetail.shippingAddress.addr2}` : ""}
          </p>
          {orderDetail.shippingAddress.deliveryMemo ? (
            <p className="m-0 mt-2 rounded-[calc(var(--radius)-4px)] bg-muted px-2.5 py-2 text-[12px]">
              배송메모 · {orderDetail.shippingAddress.deliveryMemo}
            </p>
          ) : null}

          <div className="mt-3 border-t border-border pt-3">
            <h3 className="m-0 text-[13px] font-bold">송장 정보</h3>
            {orderDetail.shipmentInfo?.trackingNo ? (
              <p className="m-0 mt-1.5 text-[13px]">
                {CARRIERS.find((c) => c.code === orderDetail.shipmentInfo?.carrierCode)?.label ??
                  orderDetail.shipmentInfo.carrierCode}{" "}
                <span className="font-mono">{orderDetail.shipmentInfo.trackingNo}</span>
              </p>
            ) : canRegisterInvoice ? (
              <form className="mt-2 flex flex-col gap-2" onSubmit={submitInvoice}>
                <Label htmlFor="admin-carrier">택배사</Label>
                <select
                  id="admin-carrier"
                  className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
                  value={carrierCode}
                  onChange={(event) => setCarrierCode(event.target.value)}
                >
                  {CARRIERS.map((carrier) => (
                    <option key={carrier.code} value={carrier.code}>
                      {carrier.label}
                    </option>
                  ))}
                </select>
                <Label htmlFor="admin-tracking">송장번호</Label>
                <Input
                  id="admin-tracking"
                  size="admin"
                  inputMode="numeric"
                  placeholder="송장번호 입력"
                  value={trackingNo}
                  onChange={(event) => setTrackingNo(event.target.value)}
                />
                <Button type="submit" variant="primary" size="admin-40">
                  {registerInvoiceMutation.isPending ? "등록 중…" : "송장 등록"}
                </Button>
                <p className="m-0 text-[12px] text-muted-foreground">
                  등록하면 배송중으로 함께 변경됩니다.
                </p>
              </form>
            ) : (
              <p className="m-0 mt-1.5 text-[12px] text-muted-foreground">
                배송 준비중 상태에서 송장을 등록할 수 있어요.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">주문자</h2>
          <p className="m-0 mt-2 text-[13px]">
            {orderDetail.orderer.name}
            {orderDetail.isGuestOrder ? (
              <span className="ml-1.5 rounded-[4px] bg-muted px-1.5 py-0.5 text-[11px]">비회원</span>
            ) : null}
          </p>
          <p className="m-0 text-[13px] text-muted-foreground">{orderDetail.orderer.phone}</p>
          {orderDetail.orderer.email ? (
            <p className="m-0 text-[13px] text-muted-foreground">{orderDetail.orderer.email}</p>
          ) : null}
        </section>

        <Button variant="outline" size="admin-40" asChild>
          <Link href="/admin/orders">주문 목록으로</Link>
        </Button>
      </aside>
    </div>
  )
}
