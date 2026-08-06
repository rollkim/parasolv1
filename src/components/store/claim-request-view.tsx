"use client"

// 핸드오프 규격: 주문상세.dc.html의 클레임 모드 — 대상 상품 선택 + 사유(배송비 태그) +
// 상세 사유 + 우측 '환불 예상 금액' 카드.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 금액은 화면이 **도메인 함수(calcClaimAmounts)로 직접 계산**한다. 목업은 화면 스크립트에
//    3000/6000을 하드코딩했는데, 그러면 배송비 정책이 바뀔 때 접수 금액과 표시 금액이 갈린다.
//    서버는 사실(기본 배송비·사유별 귀책·잔여 수량)만 주고 같은 순수 함수를 양쪽이 쓴다.
//  - 사유별 배송비 태그도 하드코딩 대신 계산 결과다 — 판매자 귀책이면 '무료'가 자동으로 나온다.
//  - 수량 단위 부분 신청 지원(목업은 라인 전량만). 이미 접수된 수량은 잔여에서 빠진다.
//  - 사진 첨부는 범위 밖(이미지 업로드는 5주차) — 목업의 스텁 버튼을 두지 않는다.
//  - 취소는 대상 선택이 없다(전체 주문 단위) — 목업의 모달 대신 같은 화면을 쓴다.

import * as React from "react"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { useMutation, useQuery } from "@tanstack/react-query"

import { ImagePlaceholder } from "@/components/store/image-placeholder"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { TOSS_BANK_CODES } from "@/domain/bank-code"
import {
  calcClaimAmounts,
  calcClaimShippingFee,
  claimTypeLabel,
  type ClaimType,
} from "@/domain/claim"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

/** 유형별 안내 — 신청 전에 무엇이 일어나는지 알린다 */
const CLAIM_HINTS: Record<ClaimType, string> = {
  cancel: "결제 전체가 취소되며 환불이 진행됩니다. 카드 취소는 영업일 기준 2~3일 걸릴 수 있어요.",
  return: "반품 승인 후 회수·검수를 거쳐 환불됩니다. 고객 사유 반품은 반품 배송비가 부과돼요.",
  exchange:
    "상품 회수 후 새 상품을 보내드려요. 고객 사유 교환은 왕복 배송비가 부과되며, 입금 확인 후 발송됩니다.",
}

export function ClaimRequestView({
  orderNo,
  claimType,
}: {
  orderNo: string
  claimType: ClaimType
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const { showToast } = useToast()

  const viewQuery = useQuery(trpc.claim.getRequestView.queryOptions({ orderNo, claimType }))
  const requestMutation = useMutation(trpc.claim.request.mutationOptions())

  const [selectedQuantities, setSelectedQuantities] = React.useState<Record<number, number>>({})
  const [reasonCode, setReasonCode] = React.useState<string>("")
  const [detail, setDetail] = React.useState("")
  const [initialized, setInitialized] = React.useState(false)
  // 가상계좌 결제 주문일 때만 쓰인다(requestView.requiresRefundAccount) — 토스가
  // 이 정보 없이는 취소·환불 API 자체를 거부한다
  const [refundBankCode, setRefundBankCode] = React.useState("")
  const [refundAccountNumber, setRefundAccountNumber] = React.useState("")
  const [refundAccountHolder, setRefundAccountHolder] = React.useState("")

  const requestView = viewQuery.data

  // 기본값: 신청 가능한 수량 전량 선택(목업도 전 품목 체크 상태로 시작한다).
  // effect가 아니라 렌더 중 조정 — effect로 하면 이미 그린 화면을 다시 그려 값이 깜빡인다.
  if (requestView && !initialized) {
    setInitialized(true)
    setSelectedQuantities(
      Object.fromEntries(
        requestView.targets
          .filter((target) => target.claimableQuantity > 0)
          .map((target) => [target.orderItemId, target.claimableQuantity]),
      ),
    )
  }

  if (viewQuery.isPending) {
    return (
      <div className="flex min-h-60 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">신청 정보를 불러오는 중입니다</span>
      </div>
    )
  }

  if (viewQuery.isError || !requestView) {
    return (
      <div className="py-16 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {viewQuery.error?.message ?? "신청 정보를 불러오지 못했습니다."}
        </p>
        <Button variant="outline" size="sm-46" className="mt-4" asChild>
          <Link href={`/order/${orderNo}`}>주문 상세로</Link>
        </Button>
      </div>
    )
  }

  const selectedReason = requestView.reasons.find((reason) => reason.reasonCode === reasonCode)

  /** 선택된 라인 — 취소는 전체 주문이라 대상 선택 없이 전량이 대상이다 */
  const selectedLines = requestView.targets
    .filter((target) =>
      requestView.wholeOrderOnly
        ? target.orderedQuantity > 0
        : (selectedQuantities[target.orderItemId] ?? 0) > 0,
    )
    .map((target) => ({
      target,
      quantity: requestView.wholeOrderOnly
        ? target.orderedQuantity
        : (selectedQuantities[target.orderItemId] ?? 0),
    }))

  // 서버 접수와 **같은 도메인 함수**로 계산한다 — 표시 금액과 실제 금액이 갈릴 자리가 없다
  const amounts =
    selectedReason && selectedLines.length > 0
      ? calcClaimAmounts({
          claimType,
          fault: selectedReason.fault,
          baseFee: requestView.baseShippingFee,
          orderShippingFee: requestView.orderShippingFee,
          orderCouponDiscount: requestView.orderCouponDiscount,
          orderPointUsed: requestView.orderPointUsed,
          lines: selectedLines.map(({ target, quantity }) => ({
            unitPrice: target.unitPrice,
            claimQuantity: quantity,
            orderedQuantity: target.orderedQuantity,
            addonTotal: target.addonTotal,
          })),
        })
      : null

  const blockingReason = (() => {
    if (selectedLines.length === 0) return "신청할 상품을 선택해 주세요."
    if (!reasonCode) return "사유를 선택해 주세요."
    if (requestView.requiresRefundAccount) {
      if (!refundBankCode) return "환불받을 은행을 선택해 주세요."
      if (!refundAccountNumber.trim()) return "환불 계좌번호를 입력해 주세요."
      if (!refundAccountHolder.trim()) return "예금주명을 입력해 주세요."
    }
    return null
  })()

  function setQuantity(orderItemId: number, quantity: number) {
    setSelectedQuantities((previous) => ({ ...previous, [orderItemId]: quantity }))
  }

  function handleSubmit() {
    if (blockingReason) {
      showToast(blockingReason, { toastVariant: "error" })
      return
    }
    requestMutation.mutate(
      {
        orderNo,
        claimType,
        reasonCode,
        detail: detail.trim() ? detail.trim() : undefined,
        targets: requestView?.wholeOrderOnly
          ? undefined
          : selectedLines.map(({ target, quantity }) => ({
              orderItemId: target.orderItemId,
              quantity,
            })),
        refundAccount: requestView?.requiresRefundAccount
          ? {
              bankCode: refundBankCode,
              accountNumber: refundAccountNumber.replace(/[^0-9]/g, ""),
              accountHolder: refundAccountHolder.trim(),
            }
          : undefined,
      },
      {
        onSuccess: (created) => {
          showToast(`${claimTypeLabel(claimType)} 신청이 접수됐어요. (${created.claimNo})`, {
            toastVariant: "info",
          })
          router.push(`/order/${orderNo}`)
        },
        onError: (requestError) => showToast(requestError.message, { toastVariant: "error" }),
      },
    )
  }

  const isSubmitting = requestMutation.isPending
  const typeLabel = claimTypeLabel(claimType)

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-5">
        {/* 대상 상품 — 취소는 전체 주문이라 선택 UI가 없다 */}
        <section
          aria-labelledby="claim-targets-heading"
          className="rounded-[var(--radius)] border border-border bg-card p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="claim-targets-heading" className="m-0 font-heading text-base font-extrabold">
              주문 상품
            </h2>
            <span className="text-[13px] text-muted-foreground">
              {requestView.wholeOrderOnly ? "주문 전체가 취소돼요" : `${typeLabel} 대상 선택`}
            </span>
          </div>

          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {requestView.targets.map((target) => {
              const selected = selectedQuantities[target.orderItemId] ?? 0
              const soldOutForClaim = target.claimableQuantity === 0
              return (
                <li
                  key={target.orderItemId}
                  className={cn(
                    "flex items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-3",
                    soldOutForClaim ? "border-border opacity-60" : "border-border",
                  )}
                >
                  <div className="size-14 shrink-0 overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border">
                    {target.thumbnailPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={target.thumbnailPath}
                        alt={target.thumbnailAlt ?? target.productName}
                        className="size-full object-cover"
                      />
                    ) : (
                      <ImagePlaceholder />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {target.makerName ? (
                      <p className="m-0 text-xs text-muted-foreground">{target.makerName}</p>
                    ) : null}
                    <p className="m-0 text-sm font-bold">{target.productName}</p>
                    <p className="m-0 text-[13px] text-muted-foreground">
                      {[target.optionLabel, `주문 ${target.orderedQuantity}개`]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {target.claimedQuantity > 0 ? (
                      <p className="m-0 text-xs text-muted-foreground">
                        이미 접수 {target.claimedQuantity}개 · 신청 가능 {target.claimableQuantity}개
                      </p>
                    ) : null}
                    {target.addonTotal > 0 ? (
                      <p className="m-0 text-xs text-muted-foreground">
                        추가상품 {formatKrw(target.addonTotal)} — 전량 신청 시에만 포함돼요
                      </p>
                    ) : null}
                  </div>

                  {requestView.wholeOrderOnly ? (
                    <span className="shrink-0 text-sm font-bold">
                      {formatKrw(target.unitPrice * target.orderedQuantity)}
                    </span>
                  ) : soldOutForClaim ? (
                    <span className="shrink-0 text-[13px] text-muted-foreground">신청 완료</span>
                  ) : (
                    <label className="flex shrink-0 items-center gap-2">
                      <span className="text-[13px] text-muted-foreground">수량</span>
                      <select
                        aria-label={`${target.productName} 신청 수량`}
                        className="h-11 cursor-pointer rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-sm"
                        value={selected}
                        onChange={(event) =>
                          setQuantity(target.orderItemId, Number(event.target.value))
                        }
                      >
                        {Array.from({ length: target.claimableQuantity + 1 }, (_, index) => (
                          <option key={index} value={index}>
                            {index}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* 사유 — 고르면 귀책이 정해지고 배송비가 즉시 계산된다 */}
        <section
          aria-labelledby="claim-reason-heading"
          className="rounded-[var(--radius)] border border-primary bg-card p-5"
        >
          <h2 id="claim-reason-heading" className="m-0 font-heading text-base font-extrabold">
            {typeLabel} 사유
          </h2>

          <RadioGroup
            aria-label={`${typeLabel} 사유 선택`}
            value={reasonCode}
            onValueChange={setReasonCode}
            className="mt-3"
          >
            {requestView.reasons.map((reason) => {
              const reasonFee = calcClaimShippingFee({
                claimType,
                fault: reason.fault,
                baseFee: requestView.baseShippingFee,
              })
              return (
                <RadioGroupCard key={reason.reasonCode} value={reason.reasonCode}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold">{reason.name}</span>
                    {/* 배송비 태그도 계산 결과다 — 판매자 귀책이면 자동으로 '무료' */}
                    <span
                      className={cn(
                        "text-[11px] font-bold",
                        reasonFee > 0 ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {reasonFee > 0 ? `${typeLabel} 배송비 ${formatKrw(reasonFee)}` : "무료"}
                    </span>
                  </span>
                </RadioGroupCard>
              )
            })}
          </RadioGroup>

          <label className="mt-3 block">
            <span className="sr-only">상세 사유</span>
            <Textarea
              aria-label="상세 사유"
              placeholder="상세 사유를 입력해 주세요. (선택) 파손·오배송은 고객센터로 사진을 보내주시면 처리가 빨라요."
              className="min-h-24"
              value={detail}
              maxLength={1000}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
        </section>

        {/* 가상계좌 결제 주문만 뜬다 — 카드·계좌이체는 원 결제수단으로 자동환불되어 필요 없다.
            토스는 이 정보 없이는 가상계좌 결제의 취소 API 자체를 거부한다. */}
        {requestView.requiresRefundAccount ? (
          <section
            aria-labelledby="claim-refund-account-heading"
            className="rounded-[var(--radius)] border border-border bg-card p-5"
          >
            <h2 id="claim-refund-account-heading" className="m-0 font-heading text-base font-extrabold">
              환불받을 계좌
            </h2>
            <p className="m-0 mt-1 text-[13px] text-muted-foreground">
              가상계좌로 결제한 주문이라 환불 계좌 정보가 필요해요.
            </p>
            <div className="mt-3 flex flex-col gap-2.5">
              <div>
                <Label htmlFor="claim-refund-bank">은행</Label>
                <select
                  id="claim-refund-bank"
                  value={refundBankCode}
                  onChange={(event) => setRefundBankCode(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-[calc(var(--radius)-2px)] border border-input bg-card px-3 text-[14px]"
                >
                  <option value="">은행 선택</option>
                  {TOSS_BANK_CODES.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="claim-refund-account-number">계좌번호</Label>
                <Input
                  id="claim-refund-account-number"
                  inputMode="numeric"
                  maxLength={20}
                  placeholder="'-' 없이 숫자만"
                  value={refundAccountNumber}
                  onChange={(event) => setRefundAccountNumber(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="claim-refund-account-holder">예금주명</Label>
                <Input
                  id="claim-refund-account-holder"
                  maxLength={60}
                  placeholder="예금주명"
                  value={refundAccountHolder}
                  onChange={(event) => setRefundAccountHolder(event.target.value)}
                />
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {/* 금액 요약 — 서버 접수와 같은 도메인 함수로 계산한 값이다 */}
      <aside className="self-start lg:sticky lg:top-4">
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <h2 className="m-0 font-heading text-base font-extrabold">
            {claimType === "exchange" ? "교환 정보" : "환불 예상 금액"}
          </h2>

          <dl className="mt-3 flex flex-col gap-2 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">대상 상품금액</dt>
              <dd className="m-0 font-bold">
                {amounts ? formatKrw(amounts.goodsAmount) : "-"}
              </dd>
            </div>
            {claimType === "cancel" && requestView.orderShippingFee > 0 ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">배송비 환불</dt>
                <dd className="m-0 font-bold">+{formatKrw(requestView.orderShippingFee)}</dd>
              </div>
            ) : null}
            {claimType !== "cancel" ? (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{typeLabel} 배송비</dt>
                <dd
                  className={cn(
                    "m-0 font-bold",
                    amounts && amounts.shippingFee > 0 ? "text-destructive" : "",
                  )}
                >
                  {amounts
                    ? amounts.shippingFee > 0
                      ? `-${formatKrw(amounts.shippingFee)}`
                      : "무료"
                    : "-"}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-bold">
              {claimType === "exchange" ? "추가 결제" : "환불 예상액"}
            </span>
            <strong className="font-heading text-lg font-extrabold">
              {claimType === "exchange"
                ? amounts && amounts.shippingFee > 0
                  ? formatKrw(amounts.shippingFee)
                  : "없음"
                : amounts
                  ? formatKrw(amounts.refundAmount)
                  : "-"}
            </strong>
          </div>

          {/* 교환 배송비는 환불에서 뺄 수 없다 — 어떻게 내는지 미리 알린다 */}
          {claimType === "exchange" && amounts && amounts.shippingFee > 0 ? (
            <p className="m-0 mt-2 text-xs leading-relaxed text-muted-foreground">
              교환 배송비는 계좌이체로 받습니다. 승인 후 입금 안내를 보내드리며, 입금이 확인되면
              교환품을 발송해요.
            </p>
          ) : null}

          <p className="m-0 mt-3 text-xs leading-relaxed text-muted-foreground">
            {CLAIM_HINTS[claimType]}
          </p>

          {blockingReason ? (
            <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
              {blockingReason}
            </p>
          ) : null}

          <Button
            type="button"
            variant="primary"
            size="lg-52"
            className="mt-3 w-full"
            aria-disabled={blockingReason !== null || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? "접수 중…" : `${typeLabel} 신청하기`}
          </Button>

          <Button variant="ghost" size="sm-46" className="mt-2 w-full" asChild>
            <Link href={`/order/${orderNo}`}>이전으로</Link>
          </Button>
        </div>
      </aside>
    </div>
  )
}
