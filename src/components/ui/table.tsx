"use client"

// 핸드오프 규격: 관리자 상품목록·주문관리(목록 테이블) + 관리자 상품등록(.vt 판매단위 매트릭스)

import * as React from "react"

import { cn } from "@/lib/utils"

/** adminList = 관리자 목록 테이블, variantMatrix = 상품등록 판매단위 인라인 편집 테이블 */
type TablePreset = "adminList" | "variantMatrix"

function Table({
  className,
  containerClassName,
  preset = "adminList",
  scrollRegionLabel,
  ...props
}: React.ComponentProps<"table"> & {
  preset?: TablePreset
  containerClassName?: string
  /** variantMatrix 전용 — 가로 스크롤 영역의 접근 가능한 이름 */
  scrollRegionLabel?: string
}) {
  const isVariantMatrix = preset === "variantMatrix"

  return (
    <div
      data-slot="table-container"
      data-table-preset={preset}
      // 가로 스크롤 영역은 키보드로도 스크롤할 수 있어야 한다 (KWCAG 키보드 접근)
      tabIndex={isVariantMatrix ? 0 : undefined}
      role={isVariantMatrix && scrollRegionLabel ? "region" : undefined}
      aria-label={isVariantMatrix ? scrollRegionLabel : undefined}
      className={cn(
        "group/table w-full border border-border",
        // 셀 여백은 프리셋이 변수로 내려주고 th/td는 변수만 참조한다 — 프리셋 분기를 한곳에 모은다
        isVariantMatrix
          ? "overflow-x-auto rounded-[calc(var(--radius)-3px)] [--table-cell-x:--spacing(2.5)] [--table-cell-y:7px] [--table-dim:.55] [--table-head-y:9px]"
          : "overflow-hidden rounded-lg bg-card [--table-cell-x:--spacing(3)] [--table-cell-y:11px] [--table-dim:.6] [--table-head-y:--spacing(2.5)]",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full border-collapse text-[13px]", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  // 헤더 배경은 thead가 아니라 th에 있다 — sticky 헤더 도입 시 배경이 따라가야 하기 때문
  return <thead data-slot="table-header" className={cn(className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      // 매트릭스는 셀이 아래쪽 구분선을 쓰므로, 마지막 행 선이 래퍼 테두리와 겹쳐 2px로 보인다
      className={cn(
        "group-data-[table-preset=variantMatrix]/table:[&>tr:last-child>td]:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({
  className,
  interactive = false,
  dimmed = false,
  onKeyDown,
  ...props
}: React.ComponentProps<"tr"> & {
  /** 행 전체가 클릭 대상인 목록(주문관리)에서만 true */
  interactive?: boolean
  /** 숨김 상품·판매중지 판매단위처럼 비활성 표기가 필요한 행 */
  dimmed?: boolean
}) {
  function handleRowKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>) {
    onKeyDown?.(event)
    if (!interactive || event.defaultPrevented) return
    if (event.key !== "Enter" && event.key !== " ") return
    // 셀 안의 링크·버튼이 받은 키 입력까지 행 클릭으로 중복 실행하지 않는다
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    event.currentTarget.click()
  }

  return (
    <tr
      data-slot="table-row"
      data-dimmed={dimmed ? "true" : undefined}
      // tr은 기본적으로 포커스를 못 받아 키보드로 행을 열 수 없다 — 클릭형 행에만 진입점을 만든다
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={handleRowKeyDown}
      className={cn(
        // 투명도만으로 상태를 전달하지 않도록, 이 행에는 '숨김'·'중지' 텍스트 배지를 함께 둘 것
        "data-[dimmed=true]:opacity-(--table-dim)",
        // 래퍼가 overflow:hidden이라 바깥 방향(offset 2px) 포커스 링이 잘린다 — 행 안쪽으로 그린다
        interactive &&
          "cursor-pointer transition-colors hover:bg-muted focus-visible:-outline-offset-2",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "border-border bg-muted px-(--table-cell-x) py-(--table-head-y) text-left align-middle text-xs font-bold whitespace-nowrap text-muted-foreground",
        "group-data-[table-preset=variantMatrix]/table:border-b",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        // 목록은 위쪽 구분선(첫 행 선이 헤더 구분선을 겸함), 매트릭스는 아래쪽 구분선
        "border-border border-t px-(--table-cell-x) py-(--table-cell-y) align-middle",
        "group-data-[table-preset=variantMatrix]/table:border-t-0 group-data-[table-preset=variantMatrix]/table:border-b",
        className
      )}
      {...props}
    />
  )
}

function TableEmptyRow({
  className,
  emptyTitle,
  children,
  ...props
}: React.ComponentProps<"td"> & { emptyTitle?: React.ReactNode }) {
  return (
    <tr data-slot="table-empty-row">
      <td
        className={cn(
          "px-5 py-14 text-center text-[13px] text-muted-foreground",
          className
        )}
        {...props}
      >
        {emptyTitle ? (
          <p className="mb-1.5 text-[15px] font-bold">{emptyTitle}</p>
        ) : null}
        {children}
      </td>
    </tr>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyRow,
}
