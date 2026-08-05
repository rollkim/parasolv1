"use client"

// 핸드오프 규격: 관리자 회원관리.dc.html 상세 — 기본정보 · 주문 요약 · 배송지 · 관리자 메모 ·
// 계정 상태 변경 · 강제 탈퇴.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **적립금 지급·등급 변경 버튼을 두지 않았다.** 등급은 배치가 산정하고(수동 변경은
//    다음 산정에서 되돌아간다), 우대는 쿠폰 발급으로 한다. 임시 비밀번호 발급은 있다 —
//    메일·알림톡 채널이 없는 동안의 CS 절차(전화 안내)를 지원한다.
//  - 강제 탈퇴 모달이 **무엇이 지워지는지 먼저 밝힌다**. 되돌릴 수 없는 조치라
//    "정말요?"만 묻는 확인은 확인이 아니다.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

function formatDateTime(value: Date): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const PROVIDER_LABELS: Record<string, string> = {
  local: "이메일",
  kakao: "카카오",
  naver: "네이버",
  google: "구글",
}

export function AdminCustomerDetailView({ customerId }: { customerId: number }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const detailQuery = useQuery(trpc.adminCustomer.detail.queryOptions({ customerId }))
  const saveMemoMutation = useMutation(trpc.adminCustomer.saveMemo.mutationOptions())
  const changeActiveMutation = useMutation(trpc.adminCustomer.changeActive.mutationOptions())
  const withdrawMutation = useMutation(trpc.adminCustomer.withdraw.mutationOptions())
  const issueTempPasswordMutation = useMutation(trpc.adminCustomer.issueTempPassword.mutationOptions())
  const [tempPasswordResult, setTempPasswordResult] = React.useState<{
    tempPassword: string
    loginId: string
  } | null>(null)

  const [memoInput, setMemoInput] = React.useState<string | null>(null)
  const [isWithdrawOpen, setIsWithdrawOpen] = React.useState(false)

  const customerDetail = detailQuery.data

  function refreshCustomer() {
    void queryClient.invalidateQueries(trpc.adminCustomer.pathFilter())
  }

  function submitMemo(event: React.FormEvent) {
    event.preventDefault()
    if (memoInput === null || saveMemoMutation.isPending) return
    saveMemoMutation.mutate(
      { customerId, memo: memoInput },
      {
        onSuccess: () => {
          showToast("메모를 저장했어요.", { toastVariant: "info" })
          setMemoInput(null)
          refreshCustomer()
        },
        onError: (memoError) => showToast(memoError.message, { toastVariant: "error" }),
      },
    )
  }

  function toggleActive(nextActive: boolean) {
    if (changeActiveMutation.isPending) return
    changeActiveMutation.mutate(
      { customerId, isActive: nextActive },
      {
        onSuccess: () => {
          showToast(nextActive ? "계정 정지를 해제했어요." : "계정을 정지했어요.", {
            toastVariant: "info",
          })
          refreshCustomer()
        },
        onError: (activeError) => showToast(activeError.message, { toastVariant: "error" }),
      },
    )
  }

  function confirmWithdraw() {
    if (withdrawMutation.isPending) return
    withdrawMutation.mutate(
      { customerId },
      {
        onSuccess: (result) => {
          showToast(
            `탈퇴 처리했어요. 배송지 ${result.removedAddressCount}건·로그인 수단 ${result.removedAuthCount}건을 삭제했습니다.`,
            { toastVariant: "info" },
          )
          setIsWithdrawOpen(false)
          refreshCustomer()
        },
        onError: (withdrawError) => showToast(withdrawError.message, { toastVariant: "error" }),
      },
    )
  }

  if (detailQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">회원 정보를 불러오는 중입니다</span>
      </div>
    )
  }

  if (detailQuery.isError || !customerDetail) {
    return (
      <div className="py-12 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {detailQuery.error?.message ?? "회원 정보를 불러오지 못했습니다."}
        </p>
        <Button variant="outline" size="admin-40" className="mt-4" asChild>
          <Link href="/admin/customers">회원 목록으로</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="m-0 flex items-center gap-1.5 text-base font-bold">
                {customerDetail.name}
                {/* 등급 — 배치가 정한 값. 수동 변경 버튼은 없다(다음 산정에서 되돌아간다) */}
                {customerDetail.gradeName ? (
                  <span className="rounded-full border border-primary px-2 py-0.5 text-[11px] font-bold text-primary">
                    {customerDetail.gradeName}
                  </span>
                ) : null}
              </p>
              <p className="m-0 text-[12px] text-muted-foreground">
                {formatDateTime(customerDetail.joinedAt)} 가입
              </p>
            </div>
            <span
              className={cn(
                "rounded-[5px] border px-2.5 py-1 text-[13px] font-bold",
                customerDetail.isWithdrawn
                  ? "border-border text-muted-foreground"
                  : customerDetail.isActive
                    ? "border-primary text-primary"
                    : "border-destructive text-destructive",
              )}
            >
              {customerDetail.statusLabel}
            </span>
          </div>

          <dl className="m-0 mt-3 flex flex-col gap-2 border-t border-border pt-3 text-[13px]">
            {/* 아이디·회원번호를 맨 위에 둔다 — 상담 중 회원을 특정하는 값이라
                이메일·연락처보다 먼저 눈에 들어와야 한다 */}
            <div className="flex gap-3">
              <dt className="w-[92px] shrink-0 text-muted-foreground">아이디</dt>
              <dd className="m-0 font-medium">
                {customerDetail.localLoginId ?? (
                  <span className="text-muted-foreground">소셜 로그인 전용</span>
                )}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[92px] shrink-0 text-muted-foreground">회원번호</dt>
              <dd className="m-0 tabular-nums">{customerDetail.customerId}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[92px] shrink-0 text-muted-foreground">이메일</dt>
              <dd className="m-0">{customerDetail.email ?? "—"}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[92px] shrink-0 text-muted-foreground">연락처</dt>
              <dd className="m-0">{customerDetail.phone ?? "—"}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[92px] shrink-0 text-muted-foreground">로그인 수단</dt>
              <dd className="m-0">
                {customerDetail.loginProviders.length === 0
                  ? "없음(탈퇴 시 삭제)"
                  : customerDetail.loginProviders
                      .map((provider) => PROVIDER_LABELS[provider] ?? provider)
                      .join(" · ")}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-[92px] shrink-0 text-muted-foreground">마케팅 수신</dt>
              <dd className="m-0">
                문자 {customerDetail.marketing.smsAgreed ? "동의" : "미동의"} · 이메일{" "}
                {customerDetail.marketing.emailAgreed ? "동의" : "미동의"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 font-heading text-[15px] font-extrabold">주문</h2>
            <span className="text-[13px] text-muted-foreground">
              {customerDetail.orderSummary.orderCount}건 · 누적{" "}
              <b className="text-foreground">
                {formatKrw(customerDetail.orderSummary.totalSpending)}
              </b>
            </span>
          </div>

          {customerDetail.recentOrders.length === 0 ? (
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">아직 주문이 없어요.</p>
          ) : (
            <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
              {customerDetail.recentOrders.map((order) => (
                <li key={order.orderNo}>
                  <Link
                    href={`/admin/orders/${order.orderNo}`}
                    className="flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)-4px)] border border-border p-2.5 text-[13px] transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="font-mono font-bold">{order.orderNo}</span>
                    <span className="text-muted-foreground">{order.orderStatus}</span>
                    <span className="ml-auto font-bold">{formatKrw(order.grandTotal)}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {formatDateTime(order.orderedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">배송지</h2>
          {customerDetail.addresses.length === 0 ? (
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">
              등록된 배송지가 없어요.
            </p>
          ) : (
            <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0 text-[13px]">
              {customerDetail.addresses.map((addressRow) => (
                <li key={addressRow.addressId} className="rounded-[calc(var(--radius)-4px)] bg-muted p-2.5">
                  <span className="font-semibold">
                    {addressRow.recipient}
                    {addressRow.isDefault ? (
                      <span className="ml-1.5 rounded-[4px] border border-primary px-1.5 text-[11px] font-bold text-primary">
                        기본
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {addressRow.phone} · ({addressRow.zipcode}) {addressRow.addr1}
                    {addressRow.addr2 ? `, ${addressRow.addr2}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">
            관리자 메모{" "}
            <span className="text-[12px] font-normal text-muted-foreground">(내부용)</span>
          </h2>
          <form className="mt-2.5 flex flex-col gap-2" onSubmit={submitMemo}>
            <Label htmlFor="customer-memo" className="sr-only">
              관리자 메모
            </Label>
            <Textarea
              id="customer-memo"
              size="compact"
              placeholder="이 회원에 대한 내부 메모를 남기세요 (CS 특이사항 등)"
              value={memoInput ?? customerDetail.adminMemo ?? ""}
              onChange={(event) => setMemoInput(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              size="admin-38"
              disabled={memoInput === null || saveMemoMutation.isPending}
            >
              {saveMemoMutation.isPending ? "저장 중…" : "메모 저장"}
            </Button>
          </form>
        </section>

        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">계정 조치</h2>
          {customerDetail.isWithdrawn ? (
            <p className="m-0 mt-2 text-[13px] text-muted-foreground">
              탈퇴 처리된 회원입니다. 개인정보는 이미 삭제되었고 주문 이력만 남아 있어요.
            </p>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2">
              <Button
                type="button"
                variant={customerDetail.isActive ? "outline" : "primary"}
                size="admin-40"
                disabled={changeActiveMutation.isPending}
                onClick={() => toggleActive(!customerDetail.isActive)}
              >
                {customerDetail.isActive ? "계정 정지" : "정지 해제"}
              </Button>
              <p className="m-0 text-[12px] text-muted-foreground">
                정지하면 로그인할 수 없습니다. 되돌릴 수 있어요.
              </p>

              <Button
                type="button"
                variant="outline"
                size="admin-40"
                disabled={issueTempPasswordMutation.isPending}
                onClick={() => {
                  if (issueTempPasswordMutation.isPending) return
                  issueTempPasswordMutation.mutate(
                    { customerId: customerDetail.customerId },
                    {
                      onSuccess: (issued) => setTempPasswordResult(issued),
                      onError: (issueError) =>
                        showToast(issueError.message, { toastVariant: "error" }),
                    },
                  )
                }}
              >
                {issueTempPasswordMutation.isPending ? "발급 중…" : "임시 비밀번호 발급"}
              </Button>
              <p className="m-0 text-[12px] text-muted-foreground">
                기존 비밀번호는 즉시 무효가 됩니다. 본인 확인 후에만 발급하세요.
              </p>

              {/* 평문은 이 자리에서 한 번만 보인다 — 저장은 해시뿐이라 닫으면 다시 볼 수 없다 */}
              {tempPasswordResult ? (
                <div
                  role="alert"
                  className="rounded-[calc(var(--radius)-2px)] border border-primary bg-secondary px-3.5 py-3"
                >
                  <b className="block text-[13px] font-extrabold text-secondary-foreground">
                    임시 비밀번호: <code className="select-all">{tempPasswordResult.tempPassword}</code>
                  </b>
                  <p className="m-0 mt-1 text-[12px] text-secondary-foreground/80">
                    아이디 <b>{tempPasswordResult.loginId}</b> · 고객에게 전화로 안내하세요.
                    이 화면을 벗어나면 다시 볼 수 없습니다.
                  </p>
                </div>
              ) : null}

              <Button
                type="button"
                variant="destructive-outline"
                size="admin-40"
                onClick={() => setIsWithdrawOpen(true)}
              >
                강제 탈퇴
              </Button>
            </div>
          )}
        </section>

        {/* 적립금·등급의 소유자를 밝힌다 — 없는 버튼이 있는 것처럼 보이면 안 된다 */}
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">적립금 · 등급</h2>
          <p className="m-0 mt-2 text-[12px] text-muted-foreground">
            등급은 일일 배치가 최근 구매액 기준으로 자동 산정합니다(이름 옆 뱃지). 적립금
            잔액·내역은 원장이 소유하며, 우대가 필요하면 쿠폰 발급으로 처리하세요.
          </p>
        </section>

        <Button variant="outline" size="admin-40" asChild>
          <Link href="/admin/customers">회원 목록으로</Link>
        </Button>
      </aside>

      <Dialog open={isWithdrawOpen} onOpenChange={setIsWithdrawOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>강제 탈퇴 처리할까요?</DialogTitle>
            <DialogDescription>
              되돌릴 수 없습니다. 아래 정보가 즉시 삭제됩니다.
            </DialogDescription>
          </DialogHeader>

          {/* 무엇이 지워지는지 먼저 밝힌다 — '정말요?'만 묻는 확인은 확인이 아니다 */}
          <div className="mt-3 flex flex-col gap-2 text-[13px]">
            <p className="m-0 font-bold">삭제되는 것</p>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              <li>이름 · 이메일 · 연락처 (회원 정보)</li>
              <li>배송지 {customerDetail.addresses.length}건</li>
              <li>
                로그인 수단 {customerDetail.loginProviders.length}건 — 소셜 로그인으로 다시
                들어올 수 없습니다
              </li>
            </ul>
            <p className="m-0 mt-1 font-bold">남는 것</p>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              <li>
                주문 {customerDetail.orderSummary.orderCount}건 — 배송·정산·분쟁 대응에 필요합니다
              </li>
              <li>관리자 메모</li>
            </ul>
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              size="admin-40"
              onClick={() => setIsWithdrawOpen(false)}
            >
              닫기
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="admin-40"
              disabled={withdrawMutation.isPending}
              onClick={confirmWithdraw}
            >
              {withdrawMutation.isPending ? "처리 중…" : "탈퇴 처리"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
