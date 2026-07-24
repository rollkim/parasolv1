"use client"

// 핸드오프 규격: 관리자 상품등록 .af 셀렉트(:68,:154) · 상품목록 정렬 셀렉트(:230) · 관리자 주문관리 .sel(:56,:129/:132/:251/:333)

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/* 목업의 셀렉트 3종은 상자 스펙(테두리·배경)이 동일하고 타이포·라운드만 다르다.
   높이는 KWCAG 44px 규칙(42/40px는 미달)에 따라 h-11로 통일 — 목업 대비 2~4px 상향. */
const selectTriggerVariants = cva(
  // 테두리 토큰은 --border가 아니라 --input (목업 3파일 공통) — border-border를 쓰면 목업보다 연해진다
  "inline-flex h-11 w-fit cursor-pointer items-center justify-between gap-1.5 border border-input bg-card pr-[9px] pl-3 whitespace-nowrap text-foreground select-none data-placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5",
  {
    variants: {
      // 라운드는 목업이 두 값으로 갈린다(관리자 −5px / 정렬 −4px) — 임의 통일 금지, calc 유지해야 리스킨 시 테마 라운드가 따라온다
      selectPreset: {
        adminForm: "rounded-[calc(var(--radius)-5px)] text-sm font-normal",
        storefrontSort: "rounded-sm text-sm font-semibold",
        adminFilter: "rounded-[calc(var(--radius)-5px)] text-[13px] font-semibold",
      },
    },
    defaultVariants: {
      selectPreset: "adminForm",
    },
  }
)

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  )
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

/* 폭은 기본 콘텐츠 폭(w-fit) — 목업 4곳 중 3곳이 폭 미지정이다.
   전폭(상품등록 카테고리·모달 사유)·고정폭(택배사 140px)은 호출부에서 className으로 지정한다. */
function SelectTrigger({
  className,
  selectPreset,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> &
  VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-select-preset={selectPreset ?? "adminForm"}
      // outline-none을 쓰지 않는다 — 목업의 셀렉트 포커스는 globals.css 전역 :focus-visible 아웃라인이 유일한 표시다
      className={cn(selectTriggerVariants({ selectPreset }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  // 목업 셀렉트는 전부 네이티브라 패널이 OS 렌더링 — 네이티브와 가장 가까운 item-aligned를 기본값으로 둔다
  position = "item-aligned",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        // 그림자는 목업에 셀렉트 패널 실측값이 없어, 같은 중간 고도인 토스트(주문관리:356)의 값을 준용
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_8px_30px_rgba(0,0,0,0.25)] duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "p-1 data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      // 라벨 13px/700 — 상품등록:153 폼 라벨 실측값 준용
      className={cn(
        "px-3 py-1.5 text-[13px] font-bold text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/* 항목도 터치 타겟이므로 min-h-11(44px). 선택 상태는 색이 아니라 체크 아이콘(형태)으로 전달한다. */
function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      // 하이라이트 배경은 목업의 중립 hover 값(상품등록:136 style-hover background:var(--muted))을 준용 — --accent는 브랜드 강조색이라 과하다
      className={cn(
        "relative flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-sm py-2 pr-9 pl-3 text-sm outline-hidden select-none focus:bg-muted focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon aria-hidden="true" className="text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon aria-hidden="true" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon aria-hidden="true" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  selectTriggerVariants,
  SelectValue,
}
