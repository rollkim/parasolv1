"use client"

// 핸드오프 규격: 오버레이모음.dc.html 확인/폼/섹션형 모달 (장바구니·마이페이지 삭제 확인 동일 규격)

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * 백드롭이 패널을 flex 정렬한다 — 핸드오프 원본 구조.
 * 이 덕분에 패널에 translate 중앙정렬이 필요 없어 popIn의 scale 변형과 충돌하지 않고,
 * 미니카트처럼 상단 정렬이 필요한 변형은 패널 쪽 className(self-start·mt-[8vh])으로 해결된다.
 */
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-[500] flex items-center justify-center bg-foreground/45 p-5 data-open:animate-fade-in",
        className
      )}
      {...props}
    />
  )
}

const dialogContentVariants = cva(
  // 그림자는 핸드오프 실측값(순수 흑백) — 테마 토큰 대상이 아니다
  "relative w-full rounded-lg bg-card text-card-foreground shadow-[0_20px_60px_rgba(0,0,0,0.25)] outline-none data-open:animate-pop-in",
  {
    variants: {
      size: {
        sm: "max-w-[320px]", // 레이어 팝업
        md: "max-w-[340px]", // 쿠폰 다운로드
        default: "max-w-[360px]", // 확인 모달·폼 모달
        lg: "max-w-[400px]", // 미니카트/담기 완료
        xl: "max-w-[520px]", // 라이트박스
      },
      // 섹션형(쿠폰·미니카트·팝업)은 헤더가 풀블리드라 패널 패딩이 없어야 한다
      padded: {
        true: "max-h-full overflow-y-auto p-6",
        false: "overflow-hidden",
      },
    },
    defaultVariants: {
      size: "default",
      padded: true,
    },
  }
)

function DialogContent({
  className,
  children,
  size,
  padded,
  showCloseButton = false,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants> & {
    showCloseButton?: boolean
    /** 백드롭 변형용 — 미니카트(40% 혼합·상단 정렬), 라이트박스(흑색 82%·p-6)처럼 backdrop 규격이 다른 화면에서 덮어쓴다 */
    overlayClassName?: string
  }) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName}>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(dialogContentVariants({ size, padded }), className)}
          {...props}
        >
          {children}
          {/* 핸드오프 모달은 취소/닫기 버튼을 본문에 두므로 X 버튼은 기본 비표시 */}
          {showCloseButton && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-5" aria-hidden="true" />
              <span className="sr-only">닫기</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  )
}

/**
 * 파괴적 확인 모달의 아이콘 배지(오버레이모음:169 실측 46px).
 * 마스터 목업에만 있고 장바구니·마이페이지 실적용 화면에는 없어 opt-in — 기본 렌더하지 않는다.
 * 의미는 제목 문구가 전달하므로 배지는 장식(aria-hidden), 내부 아이콘도 aria-hidden으로 넣을 것.
 */
function DialogIconBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-icon-badge"
      aria-hidden="true"
      className={cn(
        "mb-3.5 flex size-[46px] items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--destructive)_12%,var(--card))] text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("mb-5 flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex gap-2.5", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-lg font-extrabold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm leading-[1.6] text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogIconBadge,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogContentVariants,
}
