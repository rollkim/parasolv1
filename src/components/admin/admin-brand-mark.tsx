// 목업 규격: PaRaSOL 관리자 셸.dc.html:68-71(사이드바 로고 26px) · 157(드로어 로고 24px)
//
// 우산 마크는 리스킨 교체 대상이라 이 파일 한 곳에만 둔다(향후 site_setting 로고 자산으로 대체).
// 워드마크 문자열은 하드코딩하지 않고 site_setting의 siteName을 받는다.

import { cn } from "@/lib/utils"

type AdminBrandMarkProps = {
  siteName: string
  /** 드로어 헤더용 축소 규격(로고 24px · 워드마크 18px) */
  compact?: boolean
}

function AdminBrandMark({ siteName, compact = false }: AdminBrandMarkProps) {
  const markSize = compact ? 24 : 26

  return (
    <div className={cn("flex items-center", compact ? "gap-2" : "gap-[9px]")}>
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M2.4 12a9.6 9.6 0 0 1 19.2 0q-2.4-2.1-4.8 0-2.4-2.1-4.8 0-2.4-2.1-4.8 0Z"
          className="fill-accent"
        />
        <path
          d="M12 12v7.4a2 2 0 0 0 4 0"
          fill="none"
          strokeWidth="1.7"
          strokeLinecap="round"
          className="stroke-nav-foreground"
        />
      </svg>
      <span
        className={cn(
          "font-heading font-extrabold",
          compact ? "text-[18px]" : "text-[19px]"
        )}
      >
        {siteName}
      </span>
      <span className="rounded-[5px] border border-nav-line px-[5px] py-px text-[10px] font-extrabold text-nav-muted">
        ADMIN
      </span>
    </div>
  )
}

export { AdminBrandMark }
