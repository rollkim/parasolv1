// 핸드오프 규격: 메인.dc.html L309~321(띠배너) — 전체가 단일 링크, bg accent/color accent-foreground,
// padding clamp(16px,3cqw,22px) clamp(18px,3cqw,28px), 타이틀 clamp(16px,2.4cqw,22px), 우측 CTA 700 nowrap.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 문구·CTA·링크는 banner 테이블(strip 슬롯)에서 온다 — 목업의 하드코딩 카피는 데모 데이터.
//  - 배경 톤은 toneCode(토큰명 저장 — schema.ts L580 주석) → 클래스 사전 매핑. 허용 목록 밖 값·null이면
//    목업 기본값(accent)으로 폴백한다. 색상값 직결 금지(RULE-11 리스킨).
//  - 로고·파라솔 SVG는 currentColor로 그린다 — 톤이 바뀌어도 전경색이 함께 따라온다
//    (목업은 accent-foreground 하드코딩이지만 accent 톤에서 결과가 동일).
//  - linkUrl이 없으면 링크 대신 정적 블록으로 렌더한다(빈 href 금지).
//
// 상호작용·서버 데이터가 없어 서버 컴포넌트다("use client" 불필요).

import Link from "next/link"

import { cn } from "@/lib/utils"
import type { HomeBanner } from "@/server/services/display.service"

/** toneCode(토큰명) → 배경·전경 클래스. 허용 목록에 없는 값은 기본 톤으로 폴백 */
const STRIP_TONE_CLASS_BY_CODE: Record<string, string> = {
  primary: "bg-primary text-primary-foreground",
  accent: "bg-accent text-accent-foreground",
  foreground: "bg-foreground text-background",
}

const STRIP_DEFAULT_TONE_CLASS = STRIP_TONE_CLASS_BY_CODE.accent

export type StripBannerProps = {
  /** display.service getHomeDisplay의 stripBanners 항목 1건 */
  stripBanner: HomeBanner
}

export function StripBanner({ stripBanner }: StripBannerProps) {
  const stripToneClass =
    STRIP_TONE_CLASS_BY_CODE[stripBanner.toneCode ?? ""] ?? STRIP_DEFAULT_TONE_CLASS

  const bannerBody = (
    <>
      <div className="flex items-center gap-3.5">
        <svg width={34} height={34} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
          <path
            fill="currentColor"
            d="M2.4 12a9.6 9.6 0 0 1 19.2 0q-2.4-2.1-4.8 0-2.4-2.1-4.8 0-2.4-2.1-4.8 0Z"
          />
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            d="M12 12v7.4a2 2 0 0 0 4 0"
          />
        </svg>
        <div>
          {stripBanner.title && (
            <div className="font-heading text-[clamp(16px,2.4cqw,22px)] font-extrabold">
              {stripBanner.title}
            </div>
          )}
          {stripBanner.subtitle && (
            <div className="mt-0.5 text-[13px] opacity-[0.82]">{stripBanner.subtitle}</div>
          )}
        </div>
      </div>
      {stripBanner.ctaLabel && (
        <span className="font-bold whitespace-nowrap">{stripBanner.ctaLabel} →</span>
      )}
    </>
  )

  const stripWrapperClass = cn(
    "flex flex-wrap items-center justify-between gap-3.5 rounded-lg px-[clamp(18px,3cqw,28px)] py-[clamp(16px,3cqw,22px)]",
    stripToneClass
  )

  return stripBanner.linkUrl ? (
    <Link
      href={stripBanner.linkUrl}
      className={cn(stripWrapperClass, "transition-[filter] hover:brightness-[0.97]")}
    >
      {bannerBody}
    </Link>
  ) : (
    <div className={stripWrapperClass}>{bannerBody}</div>
  )
}
