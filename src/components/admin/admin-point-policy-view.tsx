"use client"

// 관리자 적립금 정책 — 핸드오프에 전용 화면이 없어 관리자 설정 규격(섹션 카드 · 라벨+인풋 · 하단 저장)을 준용한다.
//
// **여기 숫자가 돈을 만든다.** 적립률·보너스는 저장하는 순간부터 모든 구매·가입·리뷰에 적용되고,
// 잘못 지급된 적립금은 회수 경로가 없다(반품 회수는 주문에 묶인 적립분만 걷는다).
// 그래서 화면이 계산 결과를 미리 보여주고, 서버(saveAdminPointPolicy)가 상한을 다시 본다.
//
// 적립률은 **0.1% 단위 정수**다(10 = 1%). site_setting의 earnRate 저장 형태를 그대로 쓴다 —
// 화면에서 %로 바꿔 저장하면 이미 저장된 값이 통째로 어긋난다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { calcPurchaseEarnAmount, type PointPolicy } from "@/domain/point"
import { formatKrw } from "@/lib/format"
import { useTRPC } from "@/trpc/client"

/** 미리보기 기준 주문액 — 운영자가 "1만원 사면 얼마?"로 감을 잡는 값 */
const PREVIEW_ORDER_AMOUNTS = [10_000, 30_000, 100_000]

type PolicyFieldKey = Exclude<keyof PointPolicy, "earnRatePerMille">

const POLICY_FIELDS: { key: PolicyFieldKey; label: string; hint: string }[] = [
  {
    key: "expiryDays",
    label: "소멸 기한 (일)",
    hint: "적립일로부터 이 기간이 지나면 소멸합니다. 이미 적립된 건의 기한은 바뀌지 않습니다.",
  },
  {
    key: "minUsePoint",
    label: "최소 사용 금액 (원)",
    hint: "이보다 적으면 결제에 쓸 수 없습니다. 0이면 제한이 없습니다.",
  },
  {
    key: "useUnitPoint",
    label: "사용 단위 (원)",
    hint: "이 배수로만 사용할 수 있습니다. 최소 사용 금액은 이 값의 배수여야 합니다.",
  },
  {
    key: "signupBonusPoint",
    label: "회원가입 축하 적립 (원)",
    hint: "가입 즉시 지급됩니다. 0이면 지급하지 않습니다.",
  },
  {
    key: "reviewBonusPoint",
    label: "리뷰 작성 적립 (원)",
    hint: "구매한 상품에 리뷰를 남기면 지급됩니다.",
  },
  {
    key: "photoReviewBonusPoint",
    label: "포토리뷰 추가 적립 (원)",
    hint: "사진이 있으면 리뷰 적립에 이 금액이 더해집니다.",
  },
]

export function AdminPointPolicyView() {
  const trpc = useTRPC()
  const settingQuery = useQuery(trpc.adminSetting.get.queryOptions())

  if (settingQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">적립금 정책을 불러오는 중입니다</span>
      </div>
    )
  }

  if (settingQuery.isError || !settingQuery.data) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
        적립금 정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  return <PointPolicyForm initial={settingQuery.data.pointPolicy} />
}

function PointPolicyForm({ initial }: { initial: PointPolicy }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const saveMutation = useMutation(trpc.adminSetting.savePointPolicy.mutationOptions())

  const [form, setForm] = React.useState<PointPolicy>(initial)

  const toNumber = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0
  const patch = (key: keyof PointPolicy, value: number) =>
    setForm((previous) => ({ ...previous, [key]: value }))

  /* 저장 전에 화면이 먼저 거른다 — 서버도 같은 규칙을 보지만, 눌러 보고 나서 알게 되면
     이미 "왜 안 되지"를 한 번 겪는다 */
  const localError = (() => {
    if (form.earnRatePerMille > 200) {
      return "적립률이 20%를 넘습니다. 0.1% 단위로 입력해 주세요(10 = 1%)."
    }
    if (form.useUnitPoint < 1) return "사용 단위는 1원 이상이어야 합니다."
    if (form.minUsePoint > 0 && form.minUsePoint % form.useUnitPoint !== 0) {
      return "최소 사용 금액은 사용 단위의 배수여야 합니다."
    }
    if (form.expiryDays < 1) return "소멸 기한은 1일 이상이어야 합니다."
    return null
  })()

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">적립률</h2>
        <p className="m-0 mt-1 text-[12px] text-muted-foreground">
          <b className="text-foreground">구매 확정 시</b> 지급됩니다. 기준은 배송비와 적립금 사용분을
          뺀 실제 상품 결제액입니다 — 배송비에는 적립하지 않습니다.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex w-[180px] flex-col gap-1.5">
            <Label htmlFor="point-earn-rate">적립률 (0.1% 단위)</Label>
            <Input
              id="point-earn-rate"
              size="admin"
              inputMode="numeric"
              aria-describedby="point-earn-rate-hint"
              value={form.earnRatePerMille}
              onChange={(event) => patch("earnRatePerMille", toNumber(event.target.value))}
            />
          </div>
          <p id="point-earn-rate-hint" className="m-0 pb-2.5 text-[13px]">
            현재 <b className="font-bold">{(form.earnRatePerMille / 10).toFixed(1)}%</b>
            <span className="text-muted-foreground"> (10 = 1%, 5 = 0.5%)</span>
          </p>
        </div>

        {/* 비율을 %로만 보여주면 실제 금액 감각이 안 온다 — 내림까지 반영해 그대로 계산해 보여준다 */}
        <dl className="m-0 mt-3 flex flex-wrap gap-x-6 gap-y-1.5 rounded-[calc(var(--radius)-2px)] border border-border bg-muted/40 px-3.5 py-3 text-[13px]">
          {PREVIEW_ORDER_AMOUNTS.map((previewAmount) => (
            <div key={previewAmount} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground">{formatKrw(previewAmount)} 구매</dt>
              <dd className="m-0 font-bold">
                {formatKrw(calcPurchaseEarnAmount(previewAmount, form))}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">사용 규칙 · 소멸</h2>
        <p className="m-0 mt-1 text-[12px] text-muted-foreground">
          주문서의 적립금 입력 칸이 이 값을 그대로 안내합니다. 소멸 기한은{" "}
          <b className="text-foreground">앞으로 적립되는 건</b>에만 적용됩니다.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {POLICY_FIELDS.map((policyField) => (
            <div key={policyField.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`point-${policyField.key}`}>{policyField.label}</Label>
              <Input
                id={`point-${policyField.key}`}
                size="admin"
                inputMode="numeric"
                aria-describedby={`point-${policyField.key}-hint`}
                value={form[policyField.key]}
                onChange={(event) => patch(policyField.key, toNumber(event.target.value))}
              />
              <p
                id={`point-${policyField.key}-hint`}
                className="m-0 text-[12px] text-muted-foreground"
              >
                {policyField.hint}
              </p>
            </div>
          ))}
        </div>
      </section>

      {localError ? (
        <p
          role="alert"
          className="m-0 rounded-[calc(var(--radius)-2px)] border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-[13px] font-semibold text-destructive"
        >
          {localError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="admin-40"
          disabled={saveMutation.isPending || localError !== null}
          onClick={() => {
            if (saveMutation.isPending || localError) return
            saveMutation.mutate(form, {
              onSuccess: () => {
                showToast("적립금 정책을 저장했어요.", { toastVariant: "info" })
                void queryClient.invalidateQueries(trpc.adminSetting.pathFilter())
              },
              onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
            })
          }}
        >
          {saveMutation.isPending ? "저장 중…" : "저장"}
        </Button>
        <Button
          type="button"
          variant="neutral-solid"
          size="admin-40"
          onClick={() => setForm(initial)}
        >
          되돌리기
        </Button>
      </div>
    </div>
  )
}
