// PaRaSOL 커머스 버튼 — 핸드오프 실측 규격(상품상세·체크아웃·로그인·오버레이모음·관리자 화면)으로 shadcn Button의 색·크기 프리셋을 재정의

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5 border bg-clip-padding text-center leading-snug select-none",
    // asChild로 <a>를 감쌀 때 전역 a:hover 밑줄이 버튼 안에 그어지는 것을 막는다
    "no-underline hover:no-underline",
    // transform은 트랜지션에서 제외 — :active 눌림이 지연 없이 즉시 반응해야 한다
    "transition-[color,background-color,border-color,box-shadow,filter] duration-150",
    "active:translate-y-px",
    // 포커스 링은 globals.css의 전역 :focus-visible이 담당 — 버튼에서 outline을 지우지 않는다(KWCAG)
    // disabled에 pointer-events-none을 쓰지 않는 이유: 핸드오프가 cursor:not-allowed 노출까지 규격으로 지정
    "disabled:cursor-not-allowed disabled:opacity-50",
    // asChild로 <a>를 쓸 때는 native disabled가 없어 aria-disabled로 잠근다
    "aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      // hover는 Tailwind v4에서 이미 @media (hover:hover)로 감싸지므로 터치 기기에 잔상이 남지 않는다
      variant: {
        // border를 항상 1px 실선으로 유지 — outline 변형과 나란히 놓았을 때 높이가 1px씩 어긋나는 것을 막는다
        primary:
          "border-primary bg-primary text-primary-foreground hover:brightness-[0.94]",
        // 배경이 흰색이라 brightness가 시각적으로 작동하지 않는다 → 배경 교체 방식
        "primary-outline":
          "border-primary bg-card text-primary hover:bg-secondary",
        outline: "border-border bg-card text-foreground hover:bg-muted",
        // 원본에 ghost hover 선언이 없어 중립 아웃라인과 동일하게 보완한 값
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        // shadcn 기본값(연한 틴트)이 아니라 solid — 6개 화면에서 동일 규격 확인된 PaRaSOL 확정 스펙
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:brightness-[0.94]",
        // 파괴적 '진입'(확인 모달 트리거)용 — 실제 확정은 모달 안의 destructive solid가 담당
        "destructive-outline":
          "border-destructive bg-card text-destructive hover:bg-[color-mix(in_oklch,var(--destructive)_8%,var(--card))]",
        // 인풋 옆 보조 액션(주소 찾기·인증번호 발송) — 전경/배경 반전
        "neutral-solid":
          "border-foreground bg-foreground text-background hover:brightness-[0.94]",
        // 카드 안에서 primary가 과해지는 자리('담기') — transparent border로 아웃라인과 높이를 맞춘다
        soft: "border-transparent bg-secondary text-secondary-foreground hover:brightness-[0.97]",
        // 선택 상태를 갖는 버튼군(옵션값·결제수단·썸네일). 반드시 aria-pressed와 함께 사용
        // 선택 시 테두리를 2px로 키우지 않고 inset shadow로 두께를 내 레이아웃 시프트를 0으로 만든다
        // 품절/비활성은 색만이 아니라 dashed 테두리 + line-through 3중 표현(KWCAG) — '품절' 텍스트는 사용처가 붙인다
        toggle:
          "border-border bg-card text-foreground hover:border-foreground aria-pressed:border-primary aria-pressed:bg-secondary aria-pressed:text-secondary-foreground aria-pressed:shadow-[inset_0_0_0_1px_var(--primary)] disabled:border-dashed disabled:bg-muted disabled:text-muted-foreground disabled:line-through disabled:opacity-100",
      },
      // 높이는 height가 아니라 min-height — 한글 라벨이 줄바꿈돼도 잘리지 않게 한다
      // 54(결제) / 56(구매) / 52(로그인)은 화면별 의도가 달라 서로 반올림하지 않는다
      size: {
        "xl-56": "min-h-[56px] rounded-md px-6 text-[16px] font-extrabold",
        "lg-54": "min-h-[54px] rounded-md px-6 text-[16px] font-extrabold",
        "lg-52": "min-h-[52px] rounded-md px-5 text-[16px] font-extrabold",
        "md-50": "min-h-[50px] rounded-md px-5 text-[15px] font-extrabold",
        "md-48": "min-h-[48px] rounded-md px-5 text-[15px] font-bold",
        "sm-46": "min-h-[46px] rounded-sm px-4 text-[14px] font-bold",
        // 스토어프론트 최소 허용치(터치 타겟 44px)
        "sm-44": "min-h-[44px] rounded-md px-[18px] text-[14px] font-bold",
        // 관리자 축소 규격 — 데스크톱 밀도를 택한 원본을 따르되, 터치 기기에서는 44px로 올려 KWCAG를 충족시킨다
        "admin-48":
          "min-h-[48px] rounded-md px-5 text-[15px] font-extrabold pointer-coarse:min-h-11",
        "admin-42":
          "min-h-[42px] rounded-sm px-4 text-[14px] font-extrabold pointer-coarse:min-h-11",
        "admin-40":
          "min-h-[40px] rounded-sm px-4 text-[13px] font-bold pointer-coarse:min-h-11",
        "admin-38":
          "min-h-[38px] rounded-sm px-3 text-[12px] font-semibold pointer-coarse:min-h-11",
        "admin-pill-36":
          "min-h-[36px] rounded-full px-3 text-[13px] font-semibold pointer-coarse:min-h-11",
        // 아이콘 전용 — aria-label 또는 sr-only 텍스트 필수
        icon: "size-14 rounded-md [&_svg:not([class*='size-'])]:size-5",
        "icon-sm": "size-11 rounded-md",
        "icon-admin": "size-10 rounded-sm pointer-coarse:size-11",
      },
    },
    // 같은 크기라도 solid와 아웃라인의 굵기가 다른 원본 규격을 반영
    compoundVariants: [
      {
        variant: ["outline", "ghost"],
        size: ["lg-52"],
        className: "text-[15px] font-bold",
      },
      {
        variant: ["outline", "ghost", "toggle"],
        size: ["md-50"],
        className: "font-bold",
      },
      {
        variant: ["outline", "ghost", "destructive-outline", "toggle"],
        size: ["admin-48", "admin-42"],
        className: "font-bold",
      },
      {
        variant: ["primary", "destructive"],
        size: ["admin-48"],
        className: "px-7",
      },
      {
        variant: ["primary", "destructive"],
        size: ["admin-42"],
        className: "px-5",
      },
      // 벌크 pill의 hover는 배경 교체가 아니라 테두리 강조가 원본 규격
      {
        variant: "outline",
        size: "admin-pill-36",
        className: "hover:border-primary hover:bg-card",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md-48",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "md-48",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
