"use client"

// 핸드오프 규격: 비회원주문조회.dc.html — 조회 폼(주문번호+연락처) → 결과(상태 타임라인·배송요약·
// 주문상품·결제금액·배송지). [탭 순서](L94): 1 로고 → 2 주문번호 → 3 연락처 → 4 조회하기 →
// 5 로그인 링크 · (결과) 6 다시조회 → 7 배송조회 → 8 1:1문의
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 조회 실패는 원인을 구분하지 않는다(목업 규약 유지). '없는 주문번호'와 '연락처 불일치'를
//    구분해 알리면 주문번호 대입만으로 존재 여부를 캐낼 수 있다. 서버도 같은 이유로 한 가지
//    오류만 던지므로 화면은 서버 문구를 그대로 쓴다.
//  - 도착 예정일은 표시하지 않는다: 리드타임 정책이 스펙·site_setting 어디에도 없어 계산 근거가
//    없다(주문완료 화면과 같은 판단). 택배사·송장만 표시한다.
//  - 배송조회는 토스트 안내로 둔다 — 택배사 추적 연동이 없다(shipment에 추적 로그 테이블 없음).
//  - 마스킹 값은 서버가 이미 적용해 내려준 것을 그대로 쓴다. 원값을 받아 화면에서 가리면
//    클라이언트 번들에 PII가 남는다.

import * as React from "react"

import Link from "next/link"

import { useMutation } from "@tanstack/react-query"

import { ImagePlaceholder } from "@/components/store/image-placeholder"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type FormErrors = { orderNo?: string; ordererPhone?: string }

export function OrderLookupView() {
  const trpc = useTRPC()
  const { showToast } = useToast()

  const lookupMutation = useMutation(trpc.order.lookupGuestOrder.mutationOptions())

  const [orderNo, setOrderNo] = React.useState("")
  const [ordererPhone, setOrdererPhone] = React.useState("")
  const [formErrors, setFormErrors] = React.useState<FormErrors>({})
  const [lookupFailedMessage, setLookupFailedMessage] = React.useState<string | null>(null)

  const orderView = lookupMutation.data ?? null
  const orderNoRef = React.useRef<HTMLInputElement>(null)
  const phoneRef = React.useRef<HTMLInputElement>(null)

  /** 입력이 바뀌면 실패 배너를 즉시 내린다 — 고친 뒤에도 남아 있으면 무엇이 문제인지 흐려진다 */
  function clearFailure() {
    setLookupFailedMessage(null)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (lookupMutation.isPending) return

    const nextErrors: FormErrors = {}
    if (!orderNo.trim()) nextErrors.orderNo = "주문번호를 입력해 주세요."
    if (!ordererPhone.trim()) nextErrors.ordererPhone = "주문 시 입력한 연락처를 입력해 주세요."
    setFormErrors(nextErrors)

    if (nextErrors.orderNo) {
      orderNoRef.current?.focus()
      return
    }
    if (nextErrors.ordererPhone) {
      phoneRef.current?.focus()
      return
    }

    setLookupFailedMessage(null)
    lookupMutation.mutate(
      { orderNo: orderNo.trim(), ordererPhone: ordererPhone.trim() },
      {
        // 서버가 미존재·불일치를 구분하지 않는 단일 문구를 내려준다 — 그대로 노출한다
        onError: (lookupError) => setLookupFailedMessage(lookupError.message),
      },
    )
  }

  function resetToForm() {
    lookupMutation.reset()
    setLookupFailedMessage(null)
  }

  if (orderView) {
    const { timeline } = orderView
    return (
      <div className="mt-6 flex flex-col gap-5">
        <section className="rounded-[var(--radius)] border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 text-[13px] text-muted-foreground">주문번호</p>
              <p className="m-0 font-heading text-base font-extrabold">{orderView.orderNo}</p>
            </div>
            {/* 상태는 색만으로 전달하지 않는다 — 배지 안에 한글 라벨을 넣는다(KWCAG) */}
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
                      className={cn(
                        "h-1 rounded-full",
                        reached ? "bg-primary" : "bg-border",
                      )}
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
            <p className="m-0 mt-4 text-[13px] text-muted-foreground">
              {orderView.shipmentSummary.carrierCode ?? "택배"} · 송장번호{" "}
              {orderView.shipmentSummary.maskedTrackingNo}
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="lookup-items-heading"
          className="rounded-[var(--radius)] border border-border bg-card p-5"
        >
          <h2 id="lookup-items-heading" className="m-0 font-heading text-base font-extrabold">
            주문 상품
          </h2>
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
                </div>
                <span className="shrink-0 text-sm font-bold">{formatKrw(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-bold">결제금액</span>
            <strong className="font-heading text-lg font-extrabold">
              {formatKrw(orderView.amounts.grandTotal)}
            </strong>
          </div>
        </section>

        <section
          aria-labelledby="lookup-address-heading"
          className="rounded-[var(--radius)] border border-border bg-card p-5"
        >
          <h2 id="lookup-address-heading" className="m-0 font-heading text-base font-extrabold">
            배송지
          </h2>
          <p className="m-0 mt-3 text-sm font-bold">{orderView.shippingAddress.recipient}</p>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {orderView.shippingAddress.phone}
            <br />({orderView.shippingAddress.zipcode}) {orderView.shippingAddress.addr1}
            {orderView.shippingAddress.addr2 ? `, ${orderView.shippingAddress.addr2}` : ""}
          </p>
        </section>

        {/* 결과 화면 필수 액션 2종(핸드오프 탭 순서 6~8) */}
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" size="md-50" onClick={resetToForm}>
            다시 조회
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md-50"
            onClick={() =>
              showToast("배송 조회는 준비 중이에요. 택배사 연동 후 이용하실 수 있어요.", {
                toastVariant: "info",
              })
            }
          >
            배송 조회
          </Button>
          <Button variant="primary" size="md-50" asChild>
            <Link href="/qna">1:1 문의</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto mt-6 w-full max-w-[440px]">
      <p className="m-0 text-center text-sm leading-relaxed text-muted-foreground">
        주문 시 입력하신 주문번호와 연락처로
        <br />
        주문 상태를 확인할 수 있어요.
      </p>

      <form className="mt-5 flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
        <div>
          <Label htmlFor="lookup-order-no" required>
            주문번호
          </Label>
          <Input
            id="lookup-order-no"
            ref={orderNoRef}
            className="mt-1.5"
            placeholder="예: 20260721-0004821"
            value={orderNo}
            aria-invalid={formErrors.orderNo ? true : undefined}
            aria-describedby={formErrors.orderNo ? "err-lookup-order-no" : undefined}
            onChange={(event) => {
              setOrderNo(event.target.value)
              clearFailure()
            }}
          />
          {formErrors.orderNo ? (
            <p id="err-lookup-order-no" role="alert" className="mt-1.5 text-xs text-destructive">
              {formErrors.orderNo}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="lookup-phone" required>
            주문자 연락처
          </Label>
          <Input
            id="lookup-phone"
            ref={phoneRef}
            className="mt-1.5"
            inputMode="numeric"
            placeholder="예: 010-1234-5678"
            value={ordererPhone}
            aria-invalid={formErrors.ordererPhone ? true : undefined}
            aria-describedby={formErrors.ordererPhone ? "err-lookup-phone" : undefined}
            onChange={(event) => {
              setOrdererPhone(event.target.value)
              clearFailure()
            }}
          />
          {formErrors.ordererPhone ? (
            <p id="err-lookup-phone" role="alert" className="mt-1.5 text-xs text-destructive">
              {formErrors.ordererPhone}
            </p>
          ) : null}
        </div>

        {/* 조회 실패 — 원인을 구분하지 않는 단일 문구(존재 여부 누설 차단) */}
        {lookupFailedMessage ? (
          <p
            role="alert"
            className="m-0 rounded-[calc(var(--radius)-2px)] border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-[13px] text-destructive"
          >
            {lookupFailedMessage}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg-52" className="mt-1 w-full">
          {lookupMutation.isPending ? "조회 중…" : "주문 조회하기"}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        회원이신가요?{" "}
        <Link href="/login" className="font-bold text-primary underline-offset-2 hover:underline">
          로그인하고 주문내역 보기 →
        </Link>
      </p>
    </div>
  )
}
