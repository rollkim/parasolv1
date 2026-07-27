"use client"

// 핸드오프 규격: 체크아웃 약관 동의(22px, radius 6px, 체크 시 primary 채움) — 장바구니 선택,
// 1:1문의 비밀글, 회원가입 약관도 같은 모양을 각자 복제해 쓰던 것을 여기로 승격했다.
//
// 목업은 22×22px 상자만 클릭 가능하지만 KWCAG AA 터치 타깃 44px에 미달한다.
// 시각 크기는 22px를 유지하고 히트 영역만 44px로 넓힌다(before 의사요소) — 디자인은 그대로,
// 손가락·보조기기 사용성만 올린다.

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative size-[22px] shrink-0 rounded-[6px] border-[1.5px] border-border bg-card transition-colors",
        // 히트 영역 44px — 시각 크기(22px)는 유지한 채 클릭·터치 범위만 확장
        "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
