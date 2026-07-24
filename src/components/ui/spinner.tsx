// 핸드오프 규격: PaRaSOL 오버레이모음.dc.html — 로딩 상태 섹션 스피너(링 :146, 캡션 :147)

import { cn } from "@/lib/utils"

/**
 * 진행 중 표시. 링(34px, 두께 3px, 진행 호만 --primary)과 캡션 텍스트가 한 벌이다.
 *
 * 캡션은 sr-only가 아니라 화면에 보이는 텍스트다 — 상태를 모션·색만으로 전달하지 않기 위한
 * 핸드오프 설계이므로 시각적으로 감추지 않는다(KWCAG AA).
 */
function Spinner({
  loadingLabel = "불러오는 중…",
  className,
  ...props
}: React.ComponentProps<"div"> & { loadingLabel?: string }) {
  return (
    <div
      data-slot="spinner"
      role="status"
      className={cn("flex flex-col items-center gap-2.5", className)}
      {...props}
    >
      {/* 링은 장식 — 상태 전달은 아래 캡션이 맡는다 */}
      <div
        aria-hidden="true"
        className="size-[34px] animate-spin-slow rounded-full border-[3px] border-muted border-t-primary"
      />
      <span className="text-xs text-muted-foreground">{loadingLabel}</span>
    </div>
  )
}

export { Spinner }
