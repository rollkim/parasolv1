// 핸드오프 규격: 1대1문의 .qa(150px) · 단체구매문의 .qa(120px) · 리뷰작성 본문(150px) · 관리자 상품등록 상세설명 에디터(240px)

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const textareaVariants = cva(
  [
    "w-full border border-input bg-card text-sm text-foreground placeholder:text-muted-foreground",
    // 4개 화면 전부 resize:vertical — 가로 리사이즈는 레이아웃을 깨고, 세로 확장은 확대 사용자에게 필요하다.
    "resize-y",
    // 목업이 outline:none + 3px 링 그림자를 포커스 표시자로 쓴다.
    // 전역 :focus-visible 아웃라인을 지우므로 이 링이 유일한 표시자 — 축소·제거 금지(KWCAG).
    "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/26",
    // 목업의 data-err 바인딩을 aria-invalid 하나로 통일 — 스타일과 스크린리더 전달을 동시에 해결.
    // 포커스 상태에서도 에러 색이 이기도록 변형을 겹쳐 특이도를 올린다.
    "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/26",
    // 목업에 textarea 비활성·읽기전용 규격이 없어 Input과 동일 처리로 맞춘다(같은 폼에 나란히 놓인다).
    "read-only:bg-muted disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
  ],
  {
    variants: {
      // 높이는 rows가 아니라 min-height로 준다 — 목업 전 화면이 그렇고, rows 기본값 2와 충돌하지 않는다.
      // 라운드는 calc(var(--radius) - N)을 유지해야 리스킨 시 테마 라운드가 따라온다 — 계산 결과 하드코딩 금지.
      size: {
        form: "min-h-[150px] rounded-sm px-3.5 py-3 leading-[1.6]",
        compact: "min-h-[120px] rounded-sm px-3.5 py-3 leading-[1.6]",
        review: "min-h-[150px] rounded-[calc(var(--radius)-3px)] p-3.5 leading-[1.7]",
        // 위쪽 툴바(border-bottom:none)와 한 박스로 맞물리는 자리라 상단 모서리를 없앤다.
        editor: "min-h-[240px] rounded-b-sm border-border p-4 leading-[1.75]",
      },
    },
    defaultVariants: {
      size: "form",
    },
  }
)

// <textarea>에는 네이티브 size 속성이 없어 Input과 달리 Omit이 필요 없다.
type TextareaProps = React.ComponentProps<"textarea"> &
  VariantProps<typeof textareaVariants>

function Textarea({ className, size = "form", ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      data-size={size}
      className={cn(textareaVariants({ size, className }))}
      {...props}
    />
  )
}

export { Textarea, textareaVariants }
