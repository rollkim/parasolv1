"use client"

// 핸드오프 규격: 체크아웃 배송지 선택(카드 전체가 선택 영역, 선택 시 border primary,
// 라디오 22px·선택 시 두꺼운 테두리로 내부 점 표현).
//
// 목업은 <button> + <span data-radio>로 그려 role·aria-checked가 없고 화살표 키 이동도
// 안 된다. Radix RadioGroup으로 재구현해 라디오 그룹의 키보드 규약(화살표 이동·자동 선택)과
// 스크린리더 노출을 확보한다. 히트 영역은 카드 전체(Item에 카드 스타일)로 44px 이상이다.

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("flex flex-col gap-2.5", className)}
      {...props}
    />
  )
}

/** 라디오 표식 — 카드형 항목 안에서 쓰며, 선택 상태는 색이 아니라 두께 변화로도 구분된다 */
function RadioGroupIndicator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="radio-indicator"
      className={cn(
        "mt-0.5 size-[22px] shrink-0 rounded-full border-2 border-border transition-[border-width,border-color]",
        "group-data-[state=checked]:border-[6px] group-data-[state=checked]:border-primary",
        className
      )}
    />
  )
}

/**
 * 카드형 라디오 항목 — 카드 전체가 선택 영역이다.
 * 선택 표시는 테두리 색만으로 전달하지 않는다(내부 라디오 두께 + aria-checked 병행).
 */
function RadioGroupCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        "group flex w-full items-start gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "data-[state=checked]:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupIndicator />
      <span className="min-w-0 flex-1">{children}</span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupCard, RadioGroupIndicator }
