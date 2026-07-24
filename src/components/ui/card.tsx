// 핸드오프 규격: PaRaSOL 상품목록/메인(상품 카드) · 인덱스(링크 카드) · 이야기(스토리 카드) · 패널/빈 상태 카드 계열

"use client"

// radix-ui의 Slot(asChild 지원)이 내부에서 createContext를 쓴다 —
// 서버 컴포넌트가 이 파일을 임포트하면 런타임 오류가 나므로 클라이언트 경계를 명시한다.

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const cardVariants = cva(
  // relative: 상품 카드가 배지·찜 버튼·품절 오버레이를 absolute로 얹는다
  // group/card: 이야기 스토리 카드가 카드 hover로 자식 썸네일을 확대시키는 훅
  "group/card relative flex flex-col text-card-foreground",
  {
    variants: {
      variant: {
        // 상품 카드·패널·통계 타일 — 목업 4곳 모두 hover 선언이 없다(무반응이 규격)
        default: "overflow-hidden rounded-lg border border-border bg-card",
        // 인덱스 링크 카드 — 카드 계열 중 유일하게 상승 hover를 가진다.
        // h-full은 그리드 행 높이를 균등하게 맞추려고 목업이 카드에 직접 건 값.
        interactive:
          "h-full cursor-pointer overflow-hidden rounded-lg border border-border bg-card transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[3px] hover:border-primary hover:no-underline hover:shadow-[0_12px_30px_color-mix(in_oklch,var(--foreground)_12%,transparent)]",
        // 이야기 스토리 카드 — 표면이 없다. 테두리·라운드는 자식 썸네일이 담당한다.
        // text-left/cursor-pointer는 루트가 <button>이라 브라우저 기본값을 되돌리는 용도.
        plain: "cursor-pointer border-0 bg-transparent text-left text-foreground",
      },
      // 루트가 직접 패딩을 갖는 카드용. 상품·링크 카드는 본문(CardContent)이 패딩을 갖는다.
      padding: {
        none: "",
        tile: "px-[18px] py-4",
        panel: "p-[18px]",
        empty: "px-5 py-16 text-center",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "none",
    },
  }
)

function Card({
  className,
  variant = "default",
  padding = "none",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof cardVariants> & { asChild?: boolean }) {
  // 목업의 루트 요소가 <article>(상품)·<a>(링크)·<button>(스토리)로 제각각이라 교체가 필요하다
  const Comp = asChild ? Slot.Root : "div"

  return (
    <Comp
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1 px-3 pt-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto]",
        className
      )}
      {...props}
    />
  )
}

// 상품명 규격(15px/600/1.35)을 기본값으로 삼는다.
// 상품 카드는 여기에 `line-clamp-2 min-h-[2.7em]`을 덧붙여야 카드 높이가 고르게 맞는다.
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-[15px] leading-[1.35] font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn(
        "text-[13px] leading-[1.55] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

// flex-1이 빠지면 가격 행의 mt-auto가 먹히지 않아 그리드 하단 정렬이 무너진다
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex flex-1 flex-col gap-1.5 px-3 pt-3 pb-3.5", className)}
      {...props}
    />
  )
}

// mt-auto: 상품명 길이가 달라도 가격·CTA를 카드 하단에 고정
// items-baseline: 할인율 16px·판매가 17px·정가 12px 혼합 크기를 밑선으로 맞추는 가격 행 규격
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "mt-auto flex flex-wrap items-baseline gap-1.5 px-3 pb-3.5",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
}
