"use client"

// 가로 스크롤 레일 — 카테고리 칩 스트립(상위·하위)이 공유한다.
//
// 핸드오프("카테고리 레일 수정" v1.0)에서 **어포던스 3종만** 가져왔다:
//   ① 좌·우 페이드   ② 우측 화살표 버튼   ③ 하단 진행 트랙
// 스티키 2단·진입 넛지·scrollLeft 복원은 채택하지 않았다(기존 동작 우선).
// 색은 핸드오프의 hex(#2F5D3F 등)가 아니라 **프로젝트 토큰**을 쓴다 — 하드코딩하면
// 리스킨 시 이 레일만 원래 색으로 남는다(RULE-11).
//
// 페이드 색은 레일이 놓인 배경과 같아야 회색 띠로 보이지 않는다 → surface prop으로 받는다.

import * as React from "react"

import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type ScrollRailProps = {
  children: React.ReactNode
  /** 레일이 놓인 배경 — 페이드 그라디언트가 이 색으로 만들어진다 */
  surface?: "card" | "background"
  /** 스크롤 컨테이너에 얹을 클래스(간격·패딩 등 기존 값을 그대로 넘긴다) */
  className?: string
  /** 바깥 래퍼에 얹을 클래스 — 부모 flex 안에서의 배치(basis·flex-1 등)를 여기로 넘긴다 */
  wrapperClassName?: string
  /**
   * 데스크톱에서 장식(페이드·화살표·트랙)을 숨긴다.
   * md에서 flex-wrap으로 바뀌어 스크롤이 사라지는 레일에 쓴다 — 스크롤이 없는데
   * 화살표가 남으면 누를 수 있는 것처럼 보인다.
   */
  decorationsMobileOnly?: boolean
  /** 진행 트랙 표시 여부 — 칩이 몇 개 없는 하위 레일에서는 끌 수 있다 */
  showTrack?: boolean
  "aria-label"?: string
  role?: string
}

export function ScrollRail({
  children,
  surface = "card",
  className,
  wrapperClassName,
  decorationsMobileOnly = false,
  showTrack = true,
  role,
  "aria-label": ariaLabel,
}: ScrollRailProps) {
  const railRef = React.useRef<HTMLDivElement>(null)
  // 끝단 상태 — 시작/끝에 닿으면 해당 방향 페이드와 화살표를 숨긴다
  const [atStart, setAtStart] = React.useState(true)
  const [atEnd, setAtEnd] = React.useState(true)
  /** 트랙 썸 — 보이는 비율(width%)과 진행률(left%) */
  const [thumb, setThumb] = React.useState({ widthRatio: 1, leftRatio: 0 })

  const syncRail = React.useCallback(() => {
    const rail = railRef.current
    if (!rail) return
    const maxScroll = rail.scrollWidth - rail.clientWidth
    // 2px 여유 — 브라우저가 소수점 스크롤을 남겨 끝에 닿아도 max에 미달하는 경우가 있다
    setAtStart(rail.scrollLeft <= 2)
    setAtEnd(maxScroll <= 2 || rail.scrollLeft >= maxScroll - 2)
    setThumb({
      widthRatio: rail.scrollWidth > 0 ? Math.min(1, rail.clientWidth / rail.scrollWidth) : 1,
      leftRatio: maxScroll > 0 ? rail.scrollLeft / maxScroll : 0,
    })
  }, [])

  React.useEffect(() => {
    const rail = railRef.current
    if (!rail) return

    // rAF 스로틀 — 스크롤마다 setState하면 관성 스크롤 구간에서 렌더가 밀린다
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        syncRail()
      })
    }

    // 선택된 항목이 화면 밖이면 보이게 당긴다. 대분류가 열몇 개라 뒤쪽 카테고리로
    // 들어오면 그 탭이 오른쪽 바깥에 있어, 지금 어디인지 알 수 없다.
    // 첫 렌더에서 부드럽게 움직이면 화면이 저절로 흔들린 것처럼 보이므로 즉시 이동한다.
    const selected = rail.querySelector<HTMLElement>(
      '[aria-current="page"],[aria-pressed="true"]',
    )
    if (selected) {
      selected.scrollIntoView({ inline: "center", block: "nearest" })
    }

    syncRail()
    rail.addEventListener("scroll", onScroll, { passive: true })
    // 폰트 로드·화면 회전·칩 데이터 지연 도착으로 폭이 바뀐다 —
    // 초기 렌더에서 scrollWidth가 0이면 트랙 폭이 잘못 잡히므로 반드시 다시 잰다
    const resizeObserver = new ResizeObserver(syncRail)
    resizeObserver.observe(rail)
    for (const child of Array.from(rail.children)) resizeObserver.observe(child)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      rail.removeEventListener("scroll", onScroll)
      resizeObserver.disconnect()
    }
  }, [syncRail])

  /** 한 번에 가시폭의 72% — 다음 칩이 반쯤 걸쳐 "더 있다"가 계속 보인다 */
  function scrollByPage() {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: rail.clientWidth * 0.72, behavior: "smooth" })
  }

  // 칩이 전부 들어가면 페이드·화살표·트랙을 모두 숨긴다(없는 스크롤을 암시하지 않는다)
  const isScrollable = !(atStart && atEnd)
  const fadeColor = surface === "card" ? "var(--card)" : "var(--background)"

  const decorationVisibility = decorationsMobileOnly ? "md:hidden" : ""

  return (
    <div className={cn("relative", wrapperClassName)}>
      <div
        ref={railRef}
        role={role}
        aria-label={ariaLabel}
        className={cn(
          // 스크롤바는 숨긴다 — 트랙이 그 역할을 대신한다
          // (hidden = display:none. display-none은 Tailwind 유틸이 아니라 클래스가 생성되지 않는다)
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {children}
      </div>

      {/* 좌·우 페이드 — 레일 배경과 같은 색이라야 회색 띠로 보이지 않는다 */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 transition-opacity duration-200",
          decorationVisibility,
          atStart && "opacity-0",
        )}
        style={{ background: `linear-gradient(90deg, ${fadeColor}, transparent)` }}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 transition-opacity duration-200",
          decorationVisibility,
          atEnd && "opacity-0",
        )}
        style={{ background: `linear-gradient(270deg, ${fadeColor}, transparent)` }}
      />

      {/* 화살표 — 장식이자 보조 수단이라 스크린리더·키보드에서 제외한다.
          키보드 사용자는 Tab으로 칩을 옮기면 브라우저가 알아서 스크롤한다 */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={scrollByPage}
        className={cn(
          "absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-border bg-card shadow-[0_1px_5px_rgba(0,0,0,0.10)] transition-opacity duration-200",
          decorationVisibility,
          atEnd && "pointer-events-none opacity-0",
        )}
      >
        <ChevronRightIcon className="size-4 text-primary" aria-hidden="true" />
      </button>

      {/* 진행 트랙 — 스크롤바를 숨긴 대신 "얼마나 남았는지"를 알린다 */}
      {showTrack && isScrollable ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-4 bottom-0 h-[3px] overflow-hidden rounded-full bg-muted",
            decorationVisibility,
          )}
        >
          <span
            className="block h-full rounded-full bg-primary/70 transition-transform duration-100"
            style={{
              width: `${Math.max(20, thumb.widthRatio * 100)}%`,
              transform: `translateX(${thumb.leftRatio * (100 / Math.max(0.2, thumb.widthRatio) - 100)}%)`,
            }}
          />
        </span>
      ) : null}
    </div>
  )
}
