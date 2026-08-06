"use client"

// 핸드오프 규격: 관리자 클레임.dc.html 상세 — 처리 단계 · 신청 정보 · 대상 상품 · 처리 이력 ·
// 정산 요약 + 상태별 액션 · 관리자 메모.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 액션 버튼을 **서버 판정으로만** 그린다(availableActions). 목업은 상태별 버튼을 화면에서
//    분기하는데, 그러면 전이표가 두 벌이 되어 어긋난다.
//  - 환불 확인 모달에 **채널 선택(D10)** 을 넣었다. 목업에는 '환불 진행' 하나뿐이지만,
//    실무는 PG 콘솔 수동 환불·계좌 송금이 자주 필요하고 그때도 사이트 기록은 남아야 한다.
//  - 반품·교환 완료 모달에 **재입고 여부**를 넣었다. 파손품을 판매 재고로 올리면 안 되는데
//    귀책으로 유추할 수 없다(오배송은 판매자 귀책이지만 멀쩡하다).
//  - 적립금 복원 줄은 두지 않았다 — 적립금은 2차 범위다.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type ClaimAction =
  | "approve"
  | "reject"
  | "markCollected"
  | "refund"
  | "completeExchange"
  | "settleFee"

const REFUND_CHANNELS: { channel: "pg_api" | "pg_console" | "bank_transfer"; label: string; hint: string }[] = [
  { channel: "pg_api", label: "자동(PG API)", hint: "토스에 부분취소를 요청합니다." },
  {
    channel: "pg_console",
    label: "PG 관리자에서 처리함",
    hint: "PG 콘솔에서 이미 환불한 건을 기록만 합니다.",
  },
  {
    channel: "bank_transfer",
    label: "계좌 송금으로 처리함",
    hint: "고객 계좌로 송금한 건을 기록만 합니다.",
  },
]

function formatDateTime(value: Date | null): string | null {
  if (!value) return null
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 이력의 actor 문자열(admin:3 / system / customer:8)을 읽을 수 있게 */
function actorLabel(actor: string): string {
  if (actor === "system") return "시스템"
  if (actor.startsWith("admin:")) return `관리자 #${actor.slice(6)}`
  if (actor.startsWith("customer:")) return "고객"
  return actor
}

export function AdminClaimDetailView({ claimNo }: { claimNo: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const detailQuery = useQuery(trpc.adminClaim.detail.queryOptions({ claimNo }))

  const approveMutation = useMutation(trpc.adminClaim.approve.mutationOptions())
  const rejectMutation = useMutation(trpc.adminClaim.reject.mutationOptions())
  const markCollectedMutation = useMutation(trpc.adminClaim.markCollected.mutationOptions())
  const settleFeeMutation = useMutation(trpc.adminClaim.settleFee.mutationOptions())
  const completeExchangeMutation = useMutation(trpc.adminClaim.completeExchange.mutationOptions())
  const refundMutation = useMutation(trpc.adminClaim.refund.mutationOptions())
  const saveMemoMutation = useMutation(trpc.adminClaim.saveMemo.mutationOptions())

  const [pendingAction, setPendingAction] = React.useState<ClaimAction | null>(null)
  const [actionMemo, setActionMemo] = React.useState("")
  const [refundChannel, setRefundChannel] =
    React.useState<(typeof REFUND_CHANNELS)[number]["channel"]>("pg_api")
  const [refundReference, setRefundReference] = React.useState("")
  const [restockable, setRestockable] = React.useState(true)
  const [adminMemoInput, setAdminMemoInput] = React.useState<string | null>(null)

  const claimDetail = detailQuery.data
  const isProcessing =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    markCollectedMutation.isPending ||
    settleFeeMutation.isPending ||
    completeExchangeMutation.isPending ||
    refundMutation.isPending

  function closeDialog() {
    setPendingAction(null)
    setActionMemo("")
    setRefundReference("")
  }

  function afterProcessed(message: string) {
    showToast(message, { toastVariant: "info" })
    closeDialog()
    void queryClient.invalidateQueries(trpc.adminClaim.pathFilter())
  }

  // 뮤테이션마다 오류 타입이 달라 message만 받는다 — 서버가 이미 사람이 읽을 문구로 번역해 준다
  function failed(processError: { message: string }) {
    showToast(processError.message, { toastVariant: "error" })
  }

  function runPendingAction() {
    if (isProcessing || !pendingAction) return
    const handlers = { onError: failed } as const

    if (pendingAction === "approve") {
      approveMutation.mutate(
        { claimNo, memo: actionMemo.trim() || undefined },
        { ...handlers, onSuccess: () => afterProcessed("승인했어요. 회수 요청 단계로 넘어갑니다.") },
      )
      return
    }
    if (pendingAction === "reject") {
      if (!actionMemo.trim()) {
        showToast("반려 사유를 입력해 주세요.", { toastVariant: "error" })
        return
      }
      rejectMutation.mutate(
        { claimNo, memo: actionMemo.trim() },
        { ...handlers, onSuccess: () => afterProcessed("반려 처리했어요.") },
      )
      return
    }
    if (pendingAction === "markCollected") {
      markCollectedMutation.mutate(
        { claimNo, memo: actionMemo.trim() || undefined },
        { ...handlers, onSuccess: () => afterProcessed("회수 완료로 변경했어요. 검수를 진행하세요.") },
      )
      return
    }
    if (pendingAction === "settleFee") {
      settleFeeMutation.mutate(
        { claimNo, memo: actionMemo.trim() || undefined },
        { ...handlers, onSuccess: () => afterProcessed("배송비 입금을 확인했어요.") },
      )
      return
    }
    if (pendingAction === "completeExchange") {
      completeExchangeMutation.mutate(
        { claimNo, restockable, memo: actionMemo.trim() || undefined },
        { ...handlers, onSuccess: () => afterProcessed("검수 완료 · 교환품 발송으로 처리했어요.") },
      )
      return
    }
    // refund — 수동 채널은 참조가 필수다(서버도 같은 조건으로 막는다)
    if (refundChannel !== "pg_api" && !refundReference.trim()) {
      showToast("PG 취소번호 또는 이체 확인 정보를 입력해 주세요.", { toastVariant: "error" })
      return
    }
    refundMutation.mutate(
      {
        claimNo,
        refundChannel,
        refundReference: refundReference.trim() || undefined,
        restockable,
        memo: actionMemo.trim() || undefined,
      },
      { ...handlers, onSuccess: () => afterProcessed("환불을 완료 처리했어요.") },
    )
  }

  function submitAdminMemo(event: React.FormEvent) {
    event.preventDefault()
    if (saveMemoMutation.isPending || adminMemoInput === null) return
    saveMemoMutation.mutate(
      { claimNo, memo: adminMemoInput },
      {
        onSuccess: () => {
          showToast("메모를 저장했어요.", { toastVariant: "info" })
          setAdminMemoInput(null)
          void queryClient.invalidateQueries(trpc.adminClaim.pathFilter())
        },
        onError: failed,
      },
    )
  }

  if (detailQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">클레임을 불러오는 중입니다</span>
      </div>
    )
  }

  if (detailQuery.isError || !claimDetail) {
    return (
      <div className="py-12 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {detailQuery.error?.message ?? "클레임을 불러오지 못했습니다."}
        </p>
        <Button variant="outline" size="admin-40" className="mt-4" asChild>
          <Link href="/admin/claims">클레임 목록으로</Link>
        </Button>
      </div>
    )
  }

  const isExchange = claimDetail.claimType === "exchange"
  const isCancel = claimDetail.claimType === "cancel"

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 flex items-center gap-2">
                <span className="font-mono text-base font-bold">{claimDetail.claimNo}</span>
                <span className="rounded-[6px] bg-secondary px-2 py-0.5 text-[12px] font-bold text-secondary-foreground">
                  {claimDetail.claimTypeLabel}
                </span>
              </p>
              <p className="m-0 text-[12px] text-muted-foreground">
                {formatDateTime(claimDetail.requestedAt)} 접수
              </p>
            </div>
            <span
              className={cn(
                "rounded-[5px] border px-2.5 py-1 text-[13px] font-bold",
                claimDetail.claimStatus === "requested"
                  ? "border-destructive text-destructive"
                  : claimDetail.claimStatus === "rejected"
                    ? "border-border text-muted-foreground"
                    : "border-primary text-primary",
              )}
            >
              {claimDetail.claimStatusLabel}
            </span>
          </div>

          {/* 처리 단계 — 반려는 정상 경로 밖이라 타임라인을 그리지 않는다 */}
          {claimDetail.timeline.outOfTimeline ? null : (
            <ol className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-2 border-t border-border p-0 pt-3">
              {claimDetail.timeline.steps.map((stepLabel, stepIndex) => {
                const isDone =
                  claimDetail.timeline.currentStep !== null &&
                  stepIndex <= claimDetail.timeline.currentStep
                return (
                  <li
                    key={stepLabel}
                    className={cn(
                      "flex items-center gap-1.5 text-[13px]",
                      isDone ? "font-bold text-primary" : "text-muted-foreground",
                    )}
                  >
                    <span aria-hidden="true">{isDone ? "●" : "○"}</span>
                    {stepLabel}
                    {/* 색·모양만으로 전달하지 않는다 */}
                    {isDone ? <span className="sr-only">(완료)</span> : null}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">신청 정보</h2>
          <dl className="m-0 mt-2.5 flex flex-col gap-2 text-[13px]">
            <div className="flex gap-3">
              <dt className="w-[76px] shrink-0 text-muted-foreground">원주문</dt>
              <dd className="m-0">
                <Link
                  href={`/admin/orders/${claimDetail.order.orderNo}`}
                  className="font-mono font-bold text-primary underline-offset-2 hover:underline"
                >
                  {claimDetail.order.orderNo}
                </Link>
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[76px] shrink-0 text-muted-foreground">신청자</dt>
              <dd className="m-0">
                {claimDetail.order.ordererName} · {claimDetail.order.ordererPhone}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[76px] shrink-0 text-muted-foreground">사유</dt>
              <dd className="m-0">
                {claimDetail.request.reasonLabel}{" "}
                <span className="text-muted-foreground">({claimDetail.request.faultLabel})</span>
              </dd>
            </div>
            {claimDetail.request.detail ? (
              <div className="flex gap-3">
                <dt className="w-[76px] shrink-0 text-muted-foreground">상세 사유</dt>
                <dd className="m-0 whitespace-pre-wrap">{claimDetail.request.detail}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">대상 상품</h2>
          {claimDetail.items.length === 0 ? (
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">
              주문 전체가 대상입니다(취소).
            </p>
          ) : (
            <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
              {claimDetail.items.map((item) => (
                <li key={item.claimItemId} className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <b className="font-semibold">{item.productName}</b>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {[
                        item.optionLabel,
                        `${item.claimQuantity} / ${item.orderedQuantity}개 신청`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 font-bold">{formatKrw(item.lineAmount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">처리 이력</h2>
          {claimDetail.history.length === 0 ? (
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">아직 처리 이력이 없어요.</p>
          ) : (
            <ol className="m-0 mt-2.5 flex list-none flex-col gap-2.5 p-0">
              {claimDetail.history.map((historyRow, historyIndex) => (
                <li key={`${historyRow.at}-${historyIndex}`} className="text-[13px]">
                  <b className="font-semibold">{historyRow.toStatusLabel}</b>
                  {historyRow.memo ? (
                    <span className="ml-1.5 text-muted-foreground">— {historyRow.memo}</span>
                  ) : null}
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {formatDateTime(historyRow.at)} · {actorLabel(historyRow.actor)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">
            {isExchange ? "교환 정산" : "환불 정산"}
          </h2>
          <dl className="mt-2.5 flex flex-col gap-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">대상 상품금액</dt>
              <dd className="m-0 font-bold">{formatKrw(claimDetail.amounts.goodsAmount)}</dd>
            </div>
            {isCancel ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">최초 배송비 환불</dt>
                <dd className="m-0 font-bold">{formatKrw(claimDetail.order.orderShippingFee)}</dd>
              </div>
            ) : (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  {isExchange ? "교환 배송비" : "반품 배송비"}
                </dt>
                <dd className="m-0 font-bold">
                  {claimDetail.amounts.shippingFee === 0
                    ? "없음"
                    : `- ${formatKrw(claimDetail.amounts.shippingFee)}`}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5">
              <dt className="font-bold">{isExchange ? "환불 없음" : "환불 예정액"}</dt>
              <dd className="m-0 font-heading text-base font-extrabold">
                {formatKrw(claimDetail.amounts.refundAmount)}
              </dd>
            </div>
          </dl>
          <p className="m-0 mt-2 text-[12px] text-muted-foreground">
            {claimDetail.request.faultLabel}
            {claimDetail.request.fault === "seller" ? " — 배송비를 청구하지 않습니다." : ""}
          </p>

          {/* 가상계좌 결제 주문만 뜬다 — 아래 승인 버튼을 누르면 이 계좌로 실제 돈이 나간다.
              오타(특히 예금주명)를 여기서 한 번 더 확인하고 진행할 것. */}
          {claimDetail.refundAccount ? (
            <div className="m-0 mt-2 rounded-[calc(var(--radius)-4px)] border border-primary bg-secondary px-2.5 py-2 text-[12px]">
              <p className="m-0 font-bold text-secondary-foreground">
                환불 계좌 — 승인 시 이 계좌로 입금됩니다
              </p>
              <p className="m-0 mt-0.5 text-secondary-foreground/80">
                {claimDetail.refundAccount.bankName}{" "}
                <span className="font-mono">{claimDetail.refundAccount.accountNumber}</span>
                {" · "}
                {claimDetail.refundAccount.accountHolder}
              </p>
            </div>
          ) : null}

          {/* 배송비 수취 — 상태와 별개 축이라 따로 보여준다.
              환불금 차감은 받을 것이 없으므로 '입금 대기'로 쓰면 안 된다(없는 할 일이 생긴다) */}
          {claimDetail.fee.method ? (
            <p className="m-0 mt-2 rounded-[calc(var(--radius)-4px)] bg-muted px-2.5 py-2 text-[12px]">
              배송비 {claimDetail.fee.methodLabel}
              {!claimDetail.fee.requiresDeposit
                ? " · 환불 시 자동 정산"
                : claimDetail.fee.settledAt
                  ? ` · 입금 확인 ${formatDateTime(claimDetail.fee.settledAt)}`
                  : " · 입금 대기"}
              {claimDetail.fee.memo ? ` · ${claimDetail.fee.memo}` : ""}
            </p>
          ) : null}

          {claimDetail.paymentSummary ? (
            <p className="m-0 mt-2 text-[12px] text-muted-foreground">
              결제 {claimDetail.paymentSummary.method ?? "수단 미확인"} ·{" "}
              {formatKrw(claimDetail.paymentSummary.amount)} · 상태{" "}
              {claimDetail.paymentSummary.status}
            </p>
          ) : null}

          {/* 서버가 허용한 행동만 버튼이 된다 — 눌러야 아는 버튼을 만들지 않는다 */}
          {claimDetail.availableActions.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              {claimDetail.availableActions.map((actionOption) => (
                <Button
                  key={actionOption.action}
                  type="button"
                  variant={actionOption.destructive ? "destructive-outline" : "primary"}
                  size="admin-40"
                  disabled={isProcessing}
                  onClick={() => {
                    setPendingAction(actionOption.action as ClaimAction)
                    setActionMemo("")
                    setRefundReference("")
                    setRestockable(true)
                  }}
                >
                  {actionOption.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="m-0 mt-3 border-t border-border pt-3 text-[12px] text-muted-foreground">
              처리가 끝난 클레임입니다.
            </p>
          )}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">
            관리자 메모 <span className="text-[12px] font-normal text-muted-foreground">(내부용)</span>
          </h2>
          <form className="mt-2.5 flex flex-col gap-2" onSubmit={submitAdminMemo}>
            <Label htmlFor="admin-claim-memo" className="sr-only">
              관리자 메모
            </Label>
            <Textarea
              id="admin-claim-memo"
              size="compact"
              placeholder="처리 관련 내부 메모를 남기세요."
              value={adminMemoInput ?? claimDetail.adminMemo ?? ""}
              onChange={(event) => setAdminMemoInput(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              size="admin-38"
              disabled={adminMemoInput === null || saveMemoMutation.isPending}
            >
              {saveMemoMutation.isPending ? "저장 중…" : "메모 저장"}
            </Button>
          </form>
        </section>

        <Button variant="outline" size="admin-40" asChild>
          <Link href="/admin/claims">클레임 목록으로</Link>
        </Button>
      </aside>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {claimDetail.availableActions.find((option) => option.action === pendingAction)
                ?.label ?? "처리"}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === "reject"
                ? "반려 사유는 고객에게 그대로 안내됩니다."
                : pendingAction === "refund"
                  ? `${formatKrw(claimDetail.amounts.refundAmount)}을 환불하고 클레임을 종결합니다.`
                  : pendingAction === "completeExchange"
                    ? "검수를 통과 처리하고 교환품을 발송 상태로 만듭니다."
                    : pendingAction === "settleFee"
                      ? "배송비 입금을 확인 처리합니다. 확인 후 교환품을 발송할 수 있어요."
                      : "이 처리는 되돌릴 수 없습니다."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 flex flex-col gap-3">
            {/* 환불 채널 — 자동이 안 될 때 밖에서 처리하고 기록만 남기는 경로(D10) */}
            {pendingAction === "refund" ? (
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-[13px] font-bold">환불 방법</legend>
                {REFUND_CHANNELS.map((channelOption) => (
                  <label
                    key={channelOption.channel}
                    className="flex cursor-pointer items-start gap-2 text-[13px]"
                  >
                    <input
                      type="radio"
                      name="refund-channel"
                      className="mt-0.5 size-4 accent-[var(--primary)]"
                      checked={refundChannel === channelOption.channel}
                      onChange={() => setRefundChannel(channelOption.channel)}
                    />
                    <span>
                      <b className="font-semibold">{channelOption.label}</b>
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {channelOption.hint}
                      </span>
                    </span>
                  </label>
                ))}
                {refundChannel !== "pg_api" ? (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <Label htmlFor="refund-reference">
                      {refundChannel === "pg_console" ? "PG 취소번호" : "이체 확인 정보"}
                    </Label>
                    <Input
                      id="refund-reference"
                      size="admin"
                      placeholder={
                        refundChannel === "pg_console"
                          ? "PG 콘솔의 취소 거래번호"
                          : "입금자명·이체일시 등"
                      }
                      value={refundReference}
                      onChange={(event) => setRefundReference(event.target.value)}
                    />
                    <p className="m-0 text-[12px] text-muted-foreground">
                      시스템이 확인할 수 없는 처리라 근거를 남깁니다.
                    </p>
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            {/* 재입고 여부 — 취소는 배송 전이라 항상 복원한다(선택지가 없다) */}
            {(pendingAction === "completeExchange" ||
              (pendingAction === "refund" && claimDetail.claimType === "return")) ? (
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
                <Checkbox
                  aria-label="회수품을 판매 재고로 되돌립니다"
                  checked={restockable}
                  onCheckedChange={(checked) => setRestockable(checked === true)}
                />
                <span>
                  <b className="font-semibold">회수품을 판매 재고로 되돌립니다</b>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    파손·오염 등으로 재판매할 수 없으면 체크를 해제하세요. 해제하면 재고가 늘지
                    않습니다.
                  </span>
                </span>
              </label>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="claim-action-memo">
                {pendingAction === "reject" ? "반려 사유 (필수)" : "처리 메모 (선택)"}
              </Label>
              <Textarea
                id="claim-action-memo"
                size="compact"
                placeholder={
                  pendingAction === "reject"
                    ? "반려 사유를 입력하세요. 고객에게 안내됩니다."
                    : pendingAction === "settleFee"
                      ? "입금자명 등 확인 근거"
                      : "처리 관련 메모"
                }
                value={actionMemo}
                onChange={(event) => setActionMemo(event.target.value)}
                aria-required={pendingAction === "reject"}
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" size="admin-40" onClick={closeDialog}>
              닫기
            </Button>
            <Button
              type="button"
              variant={pendingAction === "reject" ? "destructive" : "primary"}
              size="admin-40"
              disabled={isProcessing}
              onClick={runPendingAction}
            >
              {isProcessing ? "처리 중…" : "확인"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
