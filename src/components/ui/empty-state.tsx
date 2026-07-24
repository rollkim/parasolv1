// 핸드오프 규격: PaRaSOL 오류빈상태.dc.html(page 티어 원본 9종) + 장바구니·위시리스트·최근본상품(section) / 상품목록(panel) / 관리자 목록류·쿠폰·통합검색(inline)

import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export type EmptyStateTone = "brand" | "neutral" | "danger" | "warning"
export type EmptyStateSize = "page" | "section" | "panel" | "inline"

export type EmptyStateAction = {
  label: string
  /** 액션이 2개면 primary가 앞에 온다. 점검 케이스만 ghost 단독(원본 L228) — primary를 강제하지 않는다 */
  actionVariant?: "primary" | "ghost"
  /** href가 있으면 <a>로 렌더 — 원본은 이동(고객센터·로그인)과 콜백(재시도)이 섞여 있다 */
  href?: string
  onAction?: () => void
}

const emptyStateVariants = cva("flex w-full justify-center", {
  variants: {
    size: {
      // cqw는 page 티어에서만 쓴다. 셸(#pmstore)에 컨테이너가 없어도 반응형이 죽지 않도록
      // 이 래퍼 자체를 컨테이너로 세운다 — 래퍼가 전폭이라 원본과 기준 폭이 사실상 같다.
      page: "@container px-4 pt-[clamp(30px,7cqw,80px)] pb-[clamp(40px,8cqw,96px)] @min-[768px]:px-10",
      section: "px-5 py-20",
      panel: "rounded-lg border border-border bg-card px-5 py-16",
      inline: "px-5 py-14 text-muted-foreground",
    },
  },
  defaultVariants: { size: "page" },
})

// stateTone을 size보다 먼저 선언한다 — panel의 배경 해제가 twMerge 마지막-우선 규칙으로 톤 배경을 덮어야 한다
const emptyStateIconVariants = cva(
  "flex shrink-0 items-center justify-center rounded-full",
  {
    variants: {
      stateTone: {
        brand: "bg-secondary text-primary",
        neutral: "bg-muted text-muted-foreground",
        danger:
          "bg-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] text-destructive",
        warning:
          "bg-[color-mix(in_oklch,var(--accent)_20%,var(--card))] text-accent-foreground",
      },
      size: {
        page: "mb-[26px] size-[clamp(120px,28cqw,160px)]",
        section: "mb-5 size-[88px]",
        // panel 원본은 원형 배경 없이 이모지 한 글자만 노출한다
        panel: "mb-2 size-auto rounded-none bg-transparent leading-none",
        inline: "mb-[18px] size-[72px]",
      },
    },
    defaultVariants: { stateTone: "neutral", size: "page" },
  }
)

const emptyStateTitleVariants = cva("m-0 text-balance", {
  variants: {
    size: {
      page: "mb-3 font-heading text-[clamp(22px,3.4cqw,28px)] leading-[1.3] font-extrabold",
      section: "mb-2 font-heading text-[20px] leading-[1.3] font-extrabold",
      // panel·inline 원본은 디스플레이 서체를 쓰지 않는다
      panel: "mb-1.5 text-[18px] leading-[1.4] font-extrabold",
      inline: "mb-1.5 text-[15px] leading-[1.4] font-bold",
    },
  },
  defaultVariants: { size: "page" },
})

const emptyStateDescriptionVariants = cva("m-0 text-pretty", {
  variants: {
    size: {
      page: "max-w-[400px] text-[15px] leading-[1.75] text-muted-foreground",
      section: "text-sm leading-[1.6] text-muted-foreground",
      panel: "text-sm leading-[1.6] text-muted-foreground",
      // inline은 래퍼가 이미 muted-foreground라 색을 다시 주지 않는다
      inline: "text-[13px] leading-[1.6]",
    },
  },
  defaultVariants: { size: "page" },
})

const emptyStateExtraVariants = cva("w-full", {
  variants: {
    size: {
      page: "mt-[22px]",
      section: "mt-4",
      panel: "mt-4",
      inline: "mt-4",
    },
  },
  defaultVariants: { size: "page" },
})

const emptyStateActionsVariants = cva(
  "flex flex-wrap items-center justify-center gap-2.5",
  {
    variants: {
      size: {
        page: "mt-7",
        section: "mt-[22px]",
        panel: "mt-4",
        inline: "mt-4",
      },
    },
    defaultVariants: { size: "page" },
  }
)

/** 티어별 액션 규격은 Button이 소유한다 — 여기서는 매핑만 한다 */
const ACTION_BUTTON_SIZE = {
  page: "md-50",
  section: "md-48",
  panel: "sm-44",
  inline: "sm-44",
} as const

/** 원본이 케이스별로 지정한 아이콘 실측값(page 58~64, section 40~44, panel 40, inline 34)의 티어 기본값 */
const DEFAULT_ICON_PX: Record<EmptyStateSize, number> = {
  page: 60,
  section: 42,
  panel: 40,
  inline: 34,
}

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** 24x24 viewBox · stroke="currentColor" 규약. 색은 톤에서 상속되므로 아이콘에 색을 넣지 않는다 */
  icon?: React.ReactNode
  iconSize?: number
  stateTone?: EmptyStateTone
  size?: EmptyStateSize
  errorCode?: string
  /** 최대 2개 (원본 9종 중 2개가 4건·1개가 5건) */
  actions?: EmptyStateAction[]
  footnote?: React.ReactNode
  /** page는 1, 나머지 티어는 페이지에 이미 h1이 있으므로 2 이하 */
  headingLevel?: 1 | 2 | 3
  /** 검색어 재노출·추천 키워드처럼 케이스 전용 부가 UI 주입 슬롯 */
  children?: React.ReactNode
}

/**
 * 오류·빈 상태 공통 골격.
 *
 * 카피는 컴포넌트에 넣지 않는다 — 9종 문구, 고객센터 번호, 무료배송 임계값, 점검 일시는
 * 업체마다 달라지므로 호출부(site_setting·배송 도메인 모듈)에서 주입한다.
 * 본문은 "원인 + 해결"을 함께 적는다(핸드오프 UX 규칙 6).
 *
 * 클라이언트에서 기존 화면을 이 컴포넌트로 교체하는 경로(네트워크·서버 오류)에는
 * 호출부가 role="status"(비차단) 또는 role="alert"(차단성)을 넘겨야 스크린리더가 변화를 읽는다.
 * 원본에는 라이브 리전이 없어 접근성 보완으로 열어 둔 자리다.
 */
function EmptyState({
  className,
  title,
  description,
  icon,
  iconSize,
  stateTone = "neutral",
  size = "page",
  errorCode,
  actions,
  footnote,
  headingLevel,
  children,
  ...props
}: EmptyStateProps) {
  const HeadingTag = `h${headingLevel ?? (size === "page" ? 1 : 2)}` as
    | "h1"
    | "h2"
    | "h3"
  const iconSizeStyle = {
    "--empty-state-icon-size": `${iconSize ?? DEFAULT_ICON_PX[size]}px`,
  } as React.CSSProperties

  return (
    <div
      data-slot="empty-state"
      data-size={size}
      data-tone={stateTone}
      className={cn(emptyStateVariants({ size }), className)}
      {...props}
    >
      <div
        className={cn(
          "flex w-full flex-col items-center text-center",
          size === "page" && "max-w-[460px]"
        )}
      >
        {icon ? (
          <div
            data-slot="empty-state-icon"
            // 아이콘은 순수 장식 — 상태 의미는 제목·본문이 전달한다(색만으로 상태 전달 금지)
            aria-hidden="true"
            style={iconSizeStyle}
            className={cn(
              emptyStateIconVariants({ stateTone, size }),
              "text-[length:var(--empty-state-icon-size)] [&_svg]:size-[var(--empty-state-icon-size)]"
            )}
          >
            {icon}
          </div>
        ) : null}

        {errorCode ? (
          <div
            data-slot="empty-state-code"
            className="mb-2 font-heading text-[14px] font-extrabold tracking-[.08em] text-muted-foreground"
          >
            {errorCode}
          </div>
        ) : null}

        <HeadingTag
          data-slot="empty-state-title"
          className={cn(emptyStateTitleVariants({ size }))}
        >
          {title}
        </HeadingTag>

        {description ? (
          <p
            data-slot="empty-state-description"
            className={cn(emptyStateDescriptionVariants({ size }))}
          >
            {description}
          </p>
        ) : null}

        {children ? (
          <div
            data-slot="empty-state-extra"
            className={cn(emptyStateExtraVariants({ size }))}
          >
            {children}
          </div>
        ) : null}

        {actions && actions.length > 0 ? (
          <div
            data-slot="empty-state-actions"
            className={cn(emptyStateActionsVariants({ size }))}
          >
            {actions.map((action) => {
              const buttonProps = {
                variant:
                  action.actionVariant === "ghost"
                    ? ("outline" as const)
                    : ("primary" as const),
                size: ACTION_BUTTON_SIZE[size],
                // page 티어만 원본 실측(24px 여백 · 700)이 Button 기본 규격과 달라 되돌린다
                className: size === "page" ? "px-6 font-bold" : undefined,
              }

              return action.href ? (
                <Button key={action.label} asChild {...buttonProps}>
                  <a href={action.href} onClick={action.onAction}>
                    {action.label}
                  </a>
                </Button>
              ) : (
                <Button
                  key={action.label}
                  type="button"
                  onClick={action.onAction}
                  {...buttonProps}
                >
                  {action.label}
                </Button>
              )
            })}
          </div>
        ) : null}

        {footnote ? (
          <p
            data-slot="empty-state-footnote"
            className="mt-[22px] mb-0 text-[13px] text-muted-foreground"
          >
            {footnote}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { EmptyState, emptyStateVariants }
