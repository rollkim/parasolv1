"use client"

// 기획전 카운트다운 — 핸드오프 '기획전.dc.html'의 실시간 카운트다운 재구현.
// 서버는 endsAt만 주고 째깍임은 클라이언트가 맡는다 — 서버 렌더에 시계를 넣을 수 없다.

import * as React from "react"

/** 남은 시간 조각 — 음수가 되면 전부 0(종료) */
function splitRemaining(endsAtMs: number, nowMs: number) {
  const totalSeconds = Math.max(0, Math.floor((endsAtMs - nowMs) / 1000))
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    isOver: totalSeconds === 0,
  }
}

export function PromotionCountdown({ endsAtIso }: { endsAtIso: string }) {
  const endsAtMs = React.useMemo(() => new Date(endsAtIso).getTime(), [endsAtIso])
  /* 첫 렌더는 null — 서버 HTML과 클라이언트 첫 프레임이 초 단위로 어긋나면
     hydration 불일치가 난다. 마운트 후에만 시계를 그린다 */
  const [nowMs, setNowMs] = React.useState<number | null>(null)

  React.useEffect(() => {
    const tick = () => setNowMs(Date.now())
    // 첫 틱도 타이머로 — 효과 본문에서 동기 setState를 하지 않는다(react-hooks/set-state-in-effect)
    const firstTickId = window.setTimeout(tick, 0)
    const timerId = window.setInterval(tick, 1000)
    return () => {
      window.clearTimeout(firstTickId)
      window.clearInterval(timerId)
    }
  }, [])

  if (nowMs === null) {
    return (
      <div aria-hidden="true" className="h-[74px]" />
    )
  }

  const remaining = splitRemaining(endsAtMs, nowMs)
  if (remaining.isOver) {
    return (
      <p role="status" className="m-0 text-sm font-bold">
        기획전이 종료됐어요
      </p>
    )
  }

  const pieces = [
    { value: remaining.days, unit: "일" },
    { value: remaining.hours, unit: "시간" },
    { value: remaining.minutes, unit: "분" },
    { value: remaining.seconds, unit: "초" },
  ]

  return (
    <div role="timer" aria-label="기획전 종료까지 남은 시간">
      <p className="m-0 mb-1.5 text-[12px] font-bold tracking-wide opacity-80">종료까지</p>
      <div className="flex gap-2">
        {pieces.map((piece) => (
          <div
            key={piece.unit}
            className="flex min-w-[52px] flex-col items-center rounded-[calc(var(--radius)-2px)] bg-[color-mix(in_oklch,var(--foreground)_82%,transparent)] px-2 py-1.5 text-background"
          >
            {/* tabular-nums — 자리수가 바뀌어도 칸이 안 떨린다 */}
            <b className="font-heading text-xl font-extrabold tabular-nums">
              {String(piece.value).padStart(2, "0")}
            </b>
            <span className="text-[11px] opacity-80">{piece.unit}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
