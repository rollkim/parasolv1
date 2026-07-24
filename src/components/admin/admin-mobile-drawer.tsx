"use client"

// 목업 규격: PaRaSOL 관리자 셸.dc.html:98(버거 40×40) · 152-170(드로어 오버레이·패널 min(276px,82vw))
//
// 목업의 자체 오버레이 대신 Sheet(Radix Dialog)를 쓴다 — 포커스 트랩·ESC·스크롤 락·포커스 복귀가
// 목업에는 없고 Sheet에는 이미 있다. 진입 모션(drawerIn .26s cubic-bezier)은 Sheet side="left"와 동일.

import * as React from "react"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

import { AdminBrandMark } from "./admin-brand-mark"
import { AdminSidebarNav } from "./admin-sidebar"
import { type AdminNavBadgeCounts } from "./admin-nav"

type AdminMobileDrawerProps = {
  siteName: string
  navBadgeCounts?: AdminNavBadgeCounts
}

function AdminMobileDrawer({ siteName, navBadgeCounts }: AdminMobileDrawerProps) {
  const [isDrawerOpen, setIsDrawerOpen] = React.useState(false)

  // 900px 이상에서는 사이드바가 드러나고 버거(=닫기 트리거)가 사라진다 — 열린 채로 남는 상태를 막는다
  React.useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 900px)")
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setIsDrawerOpen(false)
    }

    desktopQuery.addEventListener("change", closeOnDesktop)
    return () => desktopQuery.removeEventListener("change", closeOnDesktop)
  }, [])

  return (
    <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-admin"
          aria-label="메뉴 열기"
          className="text-foreground min-[900px]:hidden"
        >
          <Menu className="size-6" strokeWidth={2} aria-hidden="true" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        // 설명 문단이 없는 내비게이션 드로어 — Radix의 aria-describedby 경고를 끈다
        aria-describedby={undefined}
        className="w-[min(276px,82vw)] bg-nav text-nav-foreground"
      >
        <SheetHeader className="border-b-0 p-4">
          <SheetTitle className="sr-only">관리자 메뉴</SheetTitle>
          <AdminBrandMark siteName={siteName} compact />
          <SheetCloseButton className="bg-nav-panel text-nav-foreground hover:brightness-125" />
        </SheetHeader>

        <SheetBody>
          {/* 메뉴로 이동한 뒤 드로어가 본문을 덮은 채 남지 않게 한다 */}
          <AdminSidebarNav
            variant="drawer"
            navBadgeCounts={navBadgeCounts}
            onNavigate={() => setIsDrawerOpen(false)}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

export { AdminMobileDrawer }
