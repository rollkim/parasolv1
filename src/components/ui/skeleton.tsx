// 핸드오프 규격: PaRaSOL 오버레이모음.dc.html — 로딩 상태 섹션(.skel 정의 :69, 상품 행 사용례 :138)

import { cn } from "@/lib/utils"

/**
 * 로딩 자리표시 블록.
 *
 * 자체 크기를 갖지 않는다 — 실제 콘텐츠와 1:1로 맞춘 치수를 사용처에서 className으로 준다.
 * (핸드오프 :138 스켈레톤 썸네일 64px ↔ :141 로드 완료 썸네일 64px — 레이아웃 시프트 방지 설계)
 *
 * radius 6px는 핸드오프 고정값이며 --radius 파생이 아니다. 카드 전체를 덮는 스켈레톤처럼
 * 다른 곡률이 필요하면 className에 rounded-lg를 넘겨 덮어쓴다.
 *
 * 주의: shimmer는 background-position을 -200px→200px로 이동시키므로 반짝임 이동 폭이
 * 요소 폭과 무관하게 고정이다. 폭이 아주 넓은 블록에 쓸 때는 육안 확인이 필요하다.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // 블록이 여러 개일 때 같은 안내가 반복 낭독되지 않도록, 안내는 SkeletonGroup이 한 번만 맡는다
      aria-hidden="true"
      className={cn(
        "animate-shimmer rounded-[6px] bg-[image:linear-gradient(90deg,var(--muted)_25%,color-mix(in_oklch,var(--muted)_60%,var(--card))_37%,var(--muted)_63%)] bg-size-[400px_100%]",
        className
      )}
      {...props}
    />
  )
}

/**
 * 스켈레톤 묶음의 접근성 경계. 로딩 영역 하나당 한 번만 감싸고, 그 안에 Skeleton을 배치한다.
 *
 * aria-busy는 일부러 걸지 않는다 — 라이브 리전에 aria-busy="true"를 함께 두면 busy가
 * 해제될 때까지 낭독이 보류되는데, 로딩이 끝나면 이 묶음 자체가 언마운트되어 해제 시점이 없다.
 */
function SkeletonGroup({
  loadingLabel,
  children,
  ...props
}: React.ComponentProps<"div"> & { loadingLabel: string }) {
  return (
    <div data-slot="skeleton-group" role="status" {...props}>
      <span className="sr-only">{loadingLabel}</span>
      {children}
    </div>
  )
}

export { Skeleton, SkeletonGroup }
