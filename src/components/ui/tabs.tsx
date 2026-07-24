"use client"

// 핸드오프 실측 규격: 상품상세(54px 스크롤 언더라인) · 공지FAQ/1대1문의(46px 무레일) · 로그인/쿠폰/관리자 로그·적립금·프로모션(균등분할 레일) · 관리자 주문·상품·회원관리(컴팩트) · 관리자 클레임(필형)

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/** 목업의 [data-tab] 계열 5종. 언더라인 트랙을 '누가 그리는가'가 변형의 핵심 축이다. */
type TabsAppearance =
  | "underline" // 트랙 = 리스트의 1px 하단선, 버튼은 transparent → primary
  | "underline-plain" // 트랙 없음, 활성 버튼에만 언더라인이 나타남
  | "underline-full" // 트랙 = 버튼 자신의 2px --border 레일 (균등분할)
  | "underline-admin" // underline의 컴팩트판
  | "pill-admin" // 필형 · 활성 시 명도 반전

/** 리스트의 변형을 트리거·카운트가 알아야 해서 컨텍스트로 내린다 (긴 group-data 셀렉터 회피) */
const TabsAppearanceContext = React.createContext<TabsAppearance>("underline")

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva("group/tabs-list flex", {
  variants: {
    variant: {
      underline: "gap-1.5 overflow-x-auto border-b border-border",
      "underline-plain": "gap-5",
      // 화면별 하단 여백이 18~22px로 갈리므로 중앙값 20px을 기본으로 둔다 (className으로 조정)
      "underline-full": "mb-5",
      "underline-admin": "mb-4 gap-0.5 overflow-x-auto border-b border-border",
      "pill-admin": "mb-3.5 flex-wrap items-center gap-2",
    },
  },
  defaultVariants: {
    variant: "underline",
  },
})

function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const appearance = (variant ?? "underline") as TabsAppearance

  return (
    <TabsAppearanceContext.Provider value={appearance}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={appearance}
        className={cn(tabsListVariants({ variant }), className)}
        {...props}
      />
    </TabsAppearanceContext.Provider>
  )
}

const tabsTriggerVariants = cva(
  // 목업 전 화면 공통: 배경 없음 · 비활성 muted-foreground → 활성 foreground · 굵기는 상태와 무관하게 고정
  "group/tabs-trigger inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 bg-transparent whitespace-nowrap text-muted-foreground data-[state=active]:text-foreground disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // overflow-x-auto 컨테이너가 바깥쪽 포커스 링을 잘라내므로 링을 안쪽으로 당긴다
        underline:
          "min-h-[54px] min-w-24 flex-1 border-b-2 border-b-transparent px-1 text-[15px] font-bold data-[state=active]:border-b-primary focus-visible:outline-offset-[-2px]",
        "underline-plain":
          "min-h-[46px] border-b-2 border-b-transparent px-1 text-[15px] font-bold data-[state=active]:border-b-primary",
        "underline-full":
          "min-h-12 flex-1 border-b-2 border-b-border text-[15px] font-bold data-[state=active]:border-b-primary",
        "underline-admin":
          "min-h-11 border-b-2 border-b-transparent px-3.5 text-sm font-bold data-[state=active]:border-b-primary focus-visible:outline-offset-[-2px]",
        "pill-admin":
          "min-h-11 rounded-full border border-border bg-card px-3.5 text-[13px] font-semibold text-foreground data-[state=active]:border-foreground data-[state=active]:bg-foreground data-[state=active]:text-background",
      },
    },
    defaultVariants: {
      variant: "underline",
    },
  }
)

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const appearance = React.useContext(TabsAppearanceContext)

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant: appearance }), className)}
      {...props}
    />
  )
}

/**
 * 탭 라벨 옆 건수 표기 (쿠폰 "사용 가능 3", 관리자 주문·클레임 상태별 건수).
 * 라벨 문자열에 합치지 않고 분리해야 0건·로딩 처리와 색상 분기가 가능하다.
 */
function TabsTriggerCount({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const appearance = React.useContext(TabsAppearanceContext)

  return (
    <span
      data-slot="tabs-trigger-count"
      className={cn(
        "text-xs font-semibold",
        // 필형은 활성 시 명도가 반전되므로 muted 고정색을 쓰면 대비가 깨진다
        appearance === "pill-admin" ? "text-current" : "text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1", className)}
      {...props}
    />
  )
}

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsTriggerCount,
  TabsContent,
  tabsListVariants,
  tabsTriggerVariants,
}
