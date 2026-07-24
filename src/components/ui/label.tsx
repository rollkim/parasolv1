"use client"

// 핸드오프 규격: 1대1문의·단체구매문의·관리자 상품등록의 폼 라벨(13px/700) + 관리자 표 내부 소형 라벨(12px/700)

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const labelVariants = cva(
  "flex items-center gap-1 font-bold leading-none select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
  {
    variants: {
      size: {
        form: "text-[13px]",
        "admin-dense": "text-xs",
      },
    },
    defaultVariants: {
      size: "form",
    },
  }
)

type LabelProps = React.ComponentProps<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants> & {
    // 목업은 별표(*) 색만으로 필수를 전달한다 — 색 단독 전달 금지(KWCAG AA)라 스크린리더용 "(필수)"를 병기한다.
    required?: boolean
  }

function Label({
  className,
  size = "form",
  required = false,
  children,
  ...props
}: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      data-size={size}
      className={cn(labelVariants({ size, className }))}
      {...props}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
          <span className="sr-only">(필수)</span>
        </>
      ) : null}
    </LabelPrimitive.Root>
  )
}

export { Label, labelVariants }
