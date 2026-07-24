"use client"

// 핸드오프 규격: 오버레이모음.dc.html 210-227(옵션 바텀시트=마스터) · 상품목록.dc.html 345-368(필터 시트) · 기획전.dc.html 203-247(스토어프론트 좌측 드로어) · 관리자 셸.dc.html 152-170(관리자 좌측 드로어)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - side="right" 미제공: 44개 화면 전체에 우측 드로어 근거가 없다. 필요해지면 규격 확정 후 추가한다.
//  - 닫기 버튼 44px(목업 38/36px), 라운드는 var(--radius) 파생 토큰(필터 시트의 20px 하드코딩 대신) — KWCAG 44px·리스킨 규약 우선.
//  - max-height 82vh + 본문 스크롤을 바텀시트 공통 기본값으로 채택(옵션 시트에는 목업상 선언이 없어 옵션이 많으면 넘침).
//  - 포커스 트랩·ESC·스크롤 락·배경 inert는 목업에 없어 Radix Dialog 기본 동작에 위임한다.
//  - 오버레이 층위: 토스트 600 > 모달·바텀시트 500 > 드로어 400 — 목업 실측(500/400)을 팀 스케일(dialog 500, toast 600)에 정렬.

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { cva } from "class-variance-authority"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-[500] bg-foreground/45 data-open:animate-fade-in data-closed:animate-out data-closed:fade-out-0 data-closed:duration-200",
        className
      )}
      {...props}
    />
  )
}

// 진입 모션은 목업 실측(sheetIn/drawerIn .26s cubic-bezier(.22,1,.36,1))을 따르고,
// 퇴장 모션은 목업에 정의가 없어 역방향 슬라이드 200ms를 신규 정의한다(백드롭 페이드와 동기).
// 좌측 드로어는 globals.css에 drawerIn 키프레임이 없어 tw-animate-css 슬라이드로 같은 값을 재현한다.
const sheetPanelVariants = cva(
  "fixed flex flex-col bg-card text-card-foreground outline-none",
  {
    variants: {
      side: {
        bottom:
          "inset-x-0 bottom-0 z-[500] mx-auto max-h-[82vh] w-[min(460px,100%)] rounded-t-lg px-5 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_rgba(0,0,0,0.2)] data-open:animate-sheet-in data-closed:animate-out data-closed:slide-out-to-bottom data-closed:duration-200",
        left: "inset-y-0 left-0 z-[400] w-[min(320px,84vw)] shadow-[8px_0_40px_rgba(0,0,0,0.2)] data-open:animate-in data-open:slide-in-from-left data-open:duration-[260ms] data-open:ease-[cubic-bezier(0.22,1,0.36,1)] data-closed:animate-out data-closed:slide-out-to-left data-closed:duration-200",
      },
    },
    defaultVariants: {
      side: "bottom",
    },
  }
)

function SheetContent({
  className,
  children,
  side = "bottom",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "bottom" | "left"
}) {
  return (
    <SheetPortal>
      {/* 백드롭 층위를 패널과 동일하게 — 드로어(400)는 확인 모달(500)이 항상 위에 뜨도록 */}
      <SheetOverlay className={side === "left" ? "z-[400]" : undefined} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(sheetPanelVariants({ side }), className)}
        {...props}
      >
        {/* 그립바 — 목업상 스와이프 핸들러가 없는 순수 장식이므로 초점·라벨을 주지 않는다 */}
        {side === "bottom" && (
          <div
            aria-hidden="true"
            className="mx-auto mt-2 mb-4 h-1 w-10 shrink-0 rounded-full bg-border"
          />
        )}
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

// 드로어 헤더 행(로고 + 닫기). 관리자 드로어는 className으로 --nav-* 토큰과 border-b-0을 덮어쓴다.
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b border-border px-[18px] py-4",
        className
      )}
      {...props}
    />
  )
}

// 헤더·CTA는 고정하고 본문만 스크롤 — 스토어프론트 드로어 구조를 바텀시트에도 공통 적용
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex shrink-0 flex-col gap-2 pt-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-extrabold text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

// 드로어 헤더용 원형 닫기 버튼. 목업 38x38px는 터치 타겟 미달이라 44px로 올렸다.
function SheetCloseButton({
  className,
  ...props
}: Omit<React.ComponentProps<typeof SheetPrimitive.Close>, "children">) {
  return (
    <SheetPrimitive.Close
      data-slot="sheet-close-button"
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition hover:brightness-95",
        className
      )}
      {...props}
    >
      <XIcon className="size-5" aria-hidden="true" />
      <span className="sr-only">닫기</span>
    </SheetPrimitive.Close>
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
}
