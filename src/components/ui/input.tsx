// 핸드오프 규격: 로그인 .au-input(50px) · 오버레이모음 모달 인풋(48px) · 체크아웃 .co-input(46px) · 관리자 상품등록 .af(42px)·.vi(34px)

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  [
    "w-full min-w-0 border border-input bg-card text-foreground placeholder:text-muted-foreground",
    // 목업이 outline:none + 3px 링 그림자를 포커스 표시자로 쓴다.
    // 전역 :focus-visible 아웃라인을 지우므로 이 링이 유일한 표시자 — 축소·제거 금지(KWCAG).
    "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/26",
    // 목업의 data-err / JS 인라인 주입을 aria-invalid 하나로 통일 — 스타일과 스크린리더 전달을 동시에 해결.
    // 포커스 상태에서도 에러 색이 이기도록 변형을 겹쳐 특이도를 올린다.
    "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/26",
    "read-only:bg-muted disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
    "file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
  ],
  {
    variants: {
      // 라운드는 calc(var(--radius) - N)을 유지해야 리스킨 시 테마 라운드가 따라온다 — 계산 결과 하드코딩 금지.
      size: {
        auth: "h-[50px] rounded-[calc(var(--radius)-3px)] px-3.5 text-[15px]",
        modal: "h-12 rounded-sm px-3.5 text-sm",
        form: "h-[46px] rounded-sm px-3.5 text-sm",
        admin: "h-[42px] rounded-[calc(var(--radius)-5px)] px-3 text-sm",
        "admin-dense":
          "h-[34px] min-w-16 rounded-[calc(var(--radius)-7px)] px-2 text-[13px]",
      },
    },
    defaultVariants: {
      size: "form",
    },
  }
)

// size는 <input>의 네이티브 문자수 속성과 이름이 겹쳐 제외한다.
type InputProps = Omit<React.ComponentProps<"input">, "size"> &
  VariantProps<typeof inputVariants>

function Input({ className, size = "form", type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(inputVariants({ size, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
