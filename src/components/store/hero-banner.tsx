"use client"

// 핸드오프 규격: 메인.dc.html L199~237(마크업) · L540~576(SLIDES·자동재생 로직) —
// 트랙 transform .55s cubic-bezier(.22,.61,.36,1), 5000ms 자동 순환, 호버 일시정지,
// 수동 조작(화살표·점) 후 타이머 재시작, prefers-reduced-motion 시 자동재생 미시작.
//
// 목업과 의도적으로 다르게 간 부분(사유 — 추출 규격의 접근성 보강 권고 반영):
//  - 슬라이더에 role="region"+aria-roledescription, 비활성 슬라이드에 inert+aria-hidden을 추가 —
//    목업은 화면 밖 슬라이드의 CTA에 키보드 포커스가 닿는다(보강 권고 3).
//  - 자동재생 일시정지가 hover뿐 아니라 포커스 진입(onFocus/onBlur 버블링)에도 반응한다(보강 권고 4).
//  - 인디케이터 점은 시각 8px 유지 + 히트 영역을 세로 44px·가로는 인접 점과 겹치지 않는
//    한계(15px)까지 확장(보강 권고 1). 가로 44px은 점 간격 7px 규격과 물리적으로 양립 불가.
//  - 배너 1건이면 화살표·인디케이터·자동재생을 모두 생략한다(목업 미규정 — 추출 규격 권고).
//  - 배너 0건 처리는 페이지 몫 — 페이지가 섹션 자체를 렌더하지 않는다.
//  - 자동재생 정지/재생 토글 버튼(우하단, 44px)을 추가 — 목업에 없는 UI. 터치 기기는 hover가
//    없고 iOS Safari는 탭 시 포커스를 주지 않아, 이 버튼 없이는 자동재생을 멈출 수단이 없다
//    (WCAG 2.2.2 / KWCAG '정지 기능 제공'). 배치·모양은 디자인 확정 전 임시안.

import * as React from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { HomeBanner } from "@/server/services/display.service"

import { ImagePlaceholder } from "./image-placeholder"

const AUTOPLAY_INTERVAL_MS = 5000

export type HeroBannerSliderProps = {
  /** display.service getHomeDisplay의 heroBanners — 호출부(페이지)가 1건 이상일 때만 렌더한다 */
  heroBanners: HomeBanner[]
}

export function HeroBannerSlider({ heroBanners }: HeroBannerSliderProps) {
  const slideCount = heroBanners.length
  const [activeSlideIndex, setActiveSlideIndex] = React.useState(0)
  // 호버와 포커스를 따로 추적한다 — 포커스가 안에 있는데 마우스만 떠나도 재생이 재개되면 안 된다
  const [isPointerOver, setIsPointerOver] = React.useState(false)
  const [isFocusWithin, setIsFocusWithin] = React.useState(false)
  // 명시적 정지 — hover·focus 일시정지는 터치 기기에 닿지 않으므로 사용자 조작 토글이 필요하다
  const [isManuallyPaused, setIsManuallyPaused] = React.useState(false)
  const isAutoplayPaused = isManuallyPaused || isPointerOver || isFocusWithin

  // 슬라이드가 바뀔 때마다 타이머를 새로 건다 — 수동 조작 직후 5초가 다시 확보되는
  // 목업의 _restart 동작이 별도 상태 없이 이 재장전 구조로 달성된다.
  React.useEffect(() => {
    if (slideCount <= 1 || isAutoplayPaused) return
    // 움직임 최소화 설정이면 자동재생을 아예 시작하지 않는다(목업 componentDidMount와 동일)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const autoplayTimer = window.setTimeout(() => {
      setActiveSlideIndex((activeSlideIndex + 1) % slideCount)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearTimeout(autoplayTimer)
  }, [activeSlideIndex, isAutoplayPaused, slideCount])

  const goToPrevSlide = () =>
    setActiveSlideIndex((activeSlideIndex - 1 + slideCount) % slideCount)
  const goToNextSlide = () =>
    setActiveSlideIndex((activeSlideIndex + 1) % slideCount)

  return (
    <div
      role="region"
      aria-roledescription="캐러셀"
      aria-label="프로모션 배너"
      className="relative overflow-hidden rounded-lg"
      onMouseEnter={() => setIsPointerOver(true)}
      onMouseLeave={() => setIsPointerOver(false)}
      onFocus={() => setIsFocusWithin(true)}
      onBlur={() => setIsFocusWithin(false)}
    >
      {/* 트랙 — 전역 reduced-motion CSS가 transition을 무력화하므로 여기서 분기하지 않는다 */}
      <div
        className="flex w-full transition-transform duration-[550ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]"
        style={{ transform: `translateX(-${activeSlideIndex * 100}%)` }}
      >
        {heroBanners.map((heroBanner, slideIndex) => {
          const isActiveSlide = slideIndex === activeSlideIndex
          return (
            <div
              key={heroBanner.bannerId}
              role="group"
              aria-roledescription="슬라이드"
              aria-label={`${slideCount}개 중 ${slideIndex + 1}번 배너`}
              // 화면 밖 슬라이드는 포커스·낭독 모두 차단 — 키보드가 보이지 않는 CTA에 걸리지 않게
              aria-hidden={!isActiveSlide}
              inert={!isActiveSlide}
              className="min-w-full"
            >
              <div className="grid bg-secondary @min-[768px]:grid-cols-[1.05fr_0.95fr]">
                {/* 좌측 텍스트 칼럼 */}
                <div className="flex flex-col justify-center gap-3.5 px-4 py-[clamp(30px,5cqw,56px)] @min-[768px]:px-10">
                  {heroBanner.kicker && (
                    // 노출 기간은 별도 요소가 아니라 kicker 문자열에 포함된다('이달의 큐레이션 · ~7/31')
                    <span className="inline-flex items-center gap-[7px] self-start rounded-full bg-[color-mix(in_oklch,var(--accent)_24%,transparent)] px-3 py-[5px] text-xs font-bold text-secondary-foreground">
                      <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          className="fill-accent"
                          d="M2.4 12a9.6 9.6 0 0 1 19.2 0q-2.4-2.1-4.8 0-2.4-2.1-4.8 0-2.4-2.1-4.8 0Z"
                        />
                      </svg>
                      {heroBanner.kicker}
                    </span>
                  )}
                  {heroBanner.title && (
                    // 관리자가 입력한 줄바꿈(\n)을 그대로 렌더한다 — whitespace-pre-line
                    <h2 className="font-heading text-[clamp(27px,5.4cqw,46px)] leading-[1.1] font-black tracking-[-0.02em] whitespace-pre-line text-secondary-foreground">
                      {heroBanner.title}
                    </h2>
                  )}
                  {heroBanner.subtitle && (
                    <p className="max-w-[44ch] text-[clamp(14px,1.5cqw,17px)] leading-[1.55] text-secondary-foreground opacity-[0.82]">
                      {heroBanner.subtitle}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-2.5">
                    {heroBanner.ctaLabel && heroBanner.linkUrl && (
                      <Button asChild size="md-48" className="px-[22px]">
                        <Link href={heroBanner.linkUrl}>{heroBanner.ctaLabel} →</Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" size="md-48">
                      <Link href="/products">전체 상품</Link>
                    </Button>
                  </div>
                </div>

                {/* 우측 이미지 칼럼 — 배너 이미지가 없으면 회색 플레이스홀더(개발 초기·시드 없음 대응) */}
                <div className="relative min-h-[clamp(200px,42cqw,420px)] bg-muted">
                  {heroBanner.imagePath ? (
                    <picture>
                      {heroBanner.mobileImagePath && (
                        <source media="(max-width: 767px)" srcSet={heroBanner.mobileImagePath} />
                      )}
                      {/* 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={heroBanner.imagePath}
                        alt={heroBanner.imageAlt ?? ""}
                        className="absolute inset-0 size-full object-cover"
                      />
                    </picture>
                  ) : (
                    <ImagePlaceholder className="absolute inset-0 h-full" />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {slideCount > 1 && (
        <>
          {/* 화살표 — 데스크톱 전용(목업 only-d). 모바일은 인디케이터+자동재생만 */}
          <button
            type="button"
            onClick={goToPrevSlide}
            aria-label="이전 배너"
            className="absolute top-1/2 left-3 hidden size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-[color-mix(in_oklch,var(--card)_90%,transparent)] text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.1)] @min-[768px]:flex"
          >
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={goToNextSlide}
            aria-label="다음 배너"
            className="absolute top-1/2 right-3 hidden size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-[color-mix(in_oklch,var(--card)_90%,transparent)] text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.1)] @min-[768px]:flex"
          >
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="m10 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* 인디케이터 — 시각 점(8px, 활성 24px 알약)은 버튼 안의 span. 버튼이 히트 영역을 확보한다 */}
          <div
            role="group"
            aria-label="배너 선택"
            className="absolute right-0 bottom-0 left-0 flex justify-center"
          >
            {heroBanners.map((heroBanner, slideIndex) => {
              const isActiveDot = slideIndex === activeSlideIndex
              return (
                <button
                  key={heroBanner.bannerId}
                  type="button"
                  onClick={() => setActiveSlideIndex(slideIndex)}
                  aria-label={`${slideIndex + 1}번 배너로 이동`}
                  aria-current={isActiveDot ? "true" : undefined}
                  className="flex h-11 cursor-pointer items-end justify-center px-[3.5px] pb-[14px]"
                >
                  <span
                    className={cn(
                      "block h-2 rounded-full border transition-[width,background-color] duration-300",
                      isActiveDot
                        ? "w-6 border-primary bg-primary"
                        : "w-2 border-[color-mix(in_oklch,var(--foreground)_25%,transparent)] bg-[color-mix(in_oklch,var(--card)_60%,transparent)]"
                    )}
                  />
                </button>
              )
            })}
          </div>

          {/* 자동재생 정지/재생 토글 — 터치 기기의 유일한 정지 수단(WCAG 2.2.2). 화살표와 달리 모바일에서도 노출.
              APG 미디어 재생/정지 패턴 — 레이블이 상태를 전달하므로 aria-pressed는 쓰지 않는다 */}
          <button
            type="button"
            onClick={() => setIsManuallyPaused(!isManuallyPaused)}
            aria-label={isManuallyPaused ? "배너 자동 재생 시작" : "배너 자동 재생 일시정지"}
            className="absolute right-3 bottom-3 flex size-11 cursor-pointer items-center justify-center rounded-full border border-border bg-[color-mix(in_oklch,var(--card)_90%,transparent)] text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.1)]"
          >
            {isManuallyPaused ? (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5Z" />
              </svg>
            ) : (
              <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 5h3.5v14H7Zm6.5 0H17v14h-3.5Z" />
              </svg>
            )}
          </button>
        </>
      )}
    </div>
  )
}
