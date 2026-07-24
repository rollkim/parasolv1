// 핸드오프 규격: 관리자 상품목록·주문관리·클레임 + 스토어프론트 상품목록(카드 태그·장바구니 카운트)
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/* 목업의 뱃지는 형태가 셋으로 갈린다 — 필형 상태 뱃지(999px) · 각형 태그(6~7px) ·
   배경 없는 도트+텍스트. 하나로 합치면 규격이 깨져서 Badge / StatusDot / CountBadge 로 나눈다.

   높이(height·min-height)를 주지 않는 이유: 목업의 모든 상태 뱃지가 font-size + padding
   으로만 높이를 만든다. 뱃지는 클릭 핸들러가 없는 비대화형 표시 요소라 44px 터치 타겟
   규칙 대상이 아니다 — asChild 로 링크·버튼화하면 그 순간 호출부가 44px을 책임져야 한다. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center align-middle whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-[13px] [&>svg]:shrink-0",
  {
    variants: {
      // 연한 톤은 color-mix 로 카드 배경에 원색을 섞는다 — 목업의 배합비를 그대로 옮김
      badgeTone: {
        secondary: "bg-secondary text-secondary-foreground",
        muted: "bg-muted text-muted-foreground",
        primary:
          "bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] text-primary",
        info: "bg-[color-mix(in_oklch,var(--info)_15%,var(--card))] text-info",
        accent:
          "bg-[color-mix(in_oklch,var(--accent)_30%,var(--card))] text-accent-foreground",
        pos: "bg-[color-mix(in_oklch,var(--pos)_16%,var(--card))] text-pos",
        destructive:
          "bg-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] text-destructive",
        // --warn 토큰이 아직 없어 accent 를 어둡게 섞어 대체한다 (토큰 승격 시 교체)
        warn: "bg-[color-mix(in_oklch,var(--accent)_20%,var(--card))] text-[color-mix(in_oklch,var(--accent),var(--foreground)_30%)]",
        accentSolid: "bg-accent text-accent-foreground",
        destructiveSolid: "bg-destructive text-destructive-foreground",
        inverse: "bg-foreground text-background",
      },
      badgeSize: {
        xs: "gap-[3px] px-2 py-[3px] text-[11px] font-extrabold",
        sm: "gap-1 px-[9px] py-[3px] text-[11px] font-bold",
        md: "gap-1 px-[11px] py-1 text-[12px] font-bold",
        lg: "gap-[5px] px-3 py-1 text-[13px] font-bold",
        xl: "gap-1.5 px-4 py-1.5 text-[14px] font-bold",
      },
      // tag 는 목업의 6~7px 각형 — 리스킨 추종을 위해 리터럴 대신 --radius 파생값을 쓴다
      badgeShape: {
        pill: "rounded-full",
        tag: "rounded-sm",
      },
    },
    compoundVariants: [
      // 클레임 유형 태그는 같은 12px이라도 상태 필보다 여백이 좁다
      { badgeShape: "tag", badgeSize: "md", className: "px-2 py-0.5" },
    ],
    defaultVariants: {
      badgeTone: "secondary",
      badgeSize: "md",
      badgeShape: "pill",
    },
  }
)

/**
 * 텍스트 뱃지. 색만으로 상태를 전달하면 안 되므로 children 에 반드시 레이블을 넣는다
 * (품절/취소완료, 승인됨/검수 중은 색 조합이 겹쳐 텍스트가 유일한 구분자다).
 * 내부 아이콘은 장식이므로 호출부에서 aria-hidden 을 붙인다.
 */
function Badge({
  className,
  badgeTone = "secondary",
  badgeSize = "md",
  badgeShape = "pill",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-tone={badgeTone}
      className={cn(
        badgeVariants({ badgeTone, badgeSize, badgeShape }),
        className
      )}
      {...props}
    />
  )
}

const statusDotVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-[5px] font-bold whitespace-nowrap",
  {
    variants: {
      dotTone: {
        destructive: "text-destructive",
        info: "text-info",
        warn: "text-[color-mix(in_oklch,var(--accent),var(--foreground)_30%)]",
        success: "text-success",
        muted: "text-muted-foreground",
      },
      dotSize: {
        md: "text-[12px]",
        lg: "text-[13px]",
      },
    },
    defaultVariants: {
      dotTone: "muted",
      dotSize: "md",
    },
  }
)

/**
 * 배경 없는 도트 + 텍스트 표시 (클레임 처리 상태). 도트는 텍스트 색을 그대로 따르므로
 * 색 정보는 도트가, 의미는 텍스트가 전달한다.
 */
function StatusDot({
  className,
  dotTone = "muted",
  dotSize = "md",
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return (
    <span
      data-slot="status-dot"
      data-tone={dotTone}
      className={cn(statusDotVariants({ dotTone, dotSize }), className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "shrink-0 rounded-full bg-current",
          dotSize === "lg" ? "size-2" : "size-[7px]"
        )}
      />
      {children}
    </span>
  )
}

/**
 * 숫자 카운트 뱃지 (GNB 알림·장바구니). 숫자만으로는 무엇의 개수인지 알 수 없으므로
 * 감싸는 버튼·링크에 aria-label 을 두고, 값이 비동기로 바뀌는 자리에는 aria-live 를 넘긴다.
 */
function CountBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="count-badge"
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] leading-none font-bold text-destructive-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Badge, badgeVariants, StatusDot, CountBadge }
