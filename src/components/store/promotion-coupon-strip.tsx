"use client"

// 기획전 쿠폰 스트립 — 핸드오프 '기획전.dc.html'의 쿠폰 받기 줄.
// 발급 가능 여부(수량·기간·인당 한도)는 전부 서버(발급 서비스)가 판정한다 —
// 화면은 결과 문구를 그대로 보여줄 뿐이다.

import * as React from "react"

import Link from "next/link"

import { useMutation } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { useTRPC } from "@/trpc/client"

type CouponStripProps = {
  couponId: number
  couponName: string
  discountKind: "fixed" | "percent"
  discountValue: number
  maxDiscountAmount: number | null
  minOrderAmount: number
  /** 비회원이면 받기 대신 로그인으로 보낸다 — 눌러 보고 막히게 하지 않는다 */
  isMember: boolean
  /** 로그인 후 돌아올 곳 */
  returnPath: string
}

function benefitLabel(strip: CouponStripProps): string {
  if (strip.discountKind === "fixed") return `${formatKrw(strip.discountValue)} 할인`
  const percent = `${(strip.discountValue / 10).toFixed(1).replace(/\.0$/, "")}% 할인`
  return strip.maxDiscountAmount === null
    ? percent
    : `${percent} (최대 ${formatKrw(strip.maxDiscountAmount)})`
}

export function PromotionCouponStrip(props: CouponStripProps) {
  const trpc = useTRPC()
  const { showToast } = useToast()
  const issueMutation = useMutation(trpc.promotion.issueCoupon.mutationOptions())
  const [issued, setIssued] = React.useState(false)

  return (
    <section
      aria-label="기획전 쿠폰"
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-primary bg-secondary px-4 py-3.5"
    >
      <div className="min-w-0 flex-1">
        <b className="block font-heading text-base font-extrabold text-secondary-foreground">
          {benefitLabel(props)}
        </b>
        <span className="text-[12px] text-secondary-foreground/80">
          {props.couponName}
          {props.minOrderAmount > 0 ? ` · ${formatKrw(props.minOrderAmount)} 이상 구매 시` : ""}
        </span>
      </div>

      {props.isMember ? (
        <Button
          type="button"
          variant="primary"
          size="sm-44"
          aria-disabled={issueMutation.isPending || issued}
          onClick={() => {
            if (issueMutation.isPending || issued) return
            issueMutation.mutate(
              { couponId: props.couponId },
              {
                onSuccess: () => {
                  setIssued(true)
                  showToast("쿠폰을 받았어요. 주문서에서 바로 쓸 수 있어요.")
                },
                // "이미 받으신 쿠폰이에요" 등 — 서비스 문구가 원인+다음 행동을 담는다
                onError: (issueError) =>
                  showToast(issueError.message, { toastVariant: "error" }),
              },
            )
          }}
        >
          {issued ? "받았어요" : issueMutation.isPending ? "받는 중…" : "쿠폰 받기"}
        </Button>
      ) : (
        <Button variant="primary" size="sm-44" asChild>
          <Link href={`/login?next=${encodeURIComponent(props.returnPath)}`}>
            로그인하고 받기
          </Link>
        </Button>
      )}
    </section>
  )
}
