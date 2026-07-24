"use client"

// 핸드오프 규격: PaRaSOL 공지FAQ.dc.html FAQ 탭 — 검색 인풋 46px·radius 999px·우측 장식 아이콘 19px ·
// 분류 칩(가로 스크롤·radius 999px·13px/600·활성 primary) · 아코디언(border-top/bottom 1px,
// 트리거 padding 18px 6px, Q 16px/800 display primary, 질문 15px/600, 분류 미니뱃지 11px/700,
// 셰브론 18px 열림 시 180° 회전 transition .2s)
// [탭 순서] 4 검색 → 5 카테고리 → 6 아코디언
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 분류 칩 36px → 44px 상향(터치 타겟 KWCAG — 헤더 칩 선례), 활성은 색 + aria-pressed 이중 전달.
//  - 분류 목록은 하드코딩이 아니라 서버가 내려준 실데이터(faq_category 조인 결과)에서 온다 —
//    코드값 하드코딩 금지(RULE-11)·글 없는 분류의 빈 필터 노출 방지.
//  - 답변(A) 영역 실측이 핸드오프 추출에 없어 Q 행과 대칭 구성으로 보완(14px lh1.75 muted).
//  - 검색·분류 결과 없음은 EmptyState inline 티어 + 초기화 액션(오류빈상태 규격 준용).

import * as React from "react"

import { ChevronDownIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
// 타입 전용 임포트 — 컴파일 시 지워져 server-only 경계를 넘지 않는다(store-footer 선례)
import type { FaqListItem } from "@/server/services/board.service"

/** '전체' 칩의 활성 키 — faq_category에 없는 UI 전용 값 */
const ALL_FAQ_CATEGORY_CODE = "all"

export type FaqCategoryChip = {
  categoryCode: string
  categoryName: string
}

type FaqAccordionProps = {
  /** 서버 컴포넌트(support/faq 페이지)가 getFaqList로 조회해 전량 주입한다 */
  faqItems: FaqListItem[]
  /** 글이 있는 분류만 — 페이지가 faqItems에서 중복 제거해 내려준다 */
  faqCategories: FaqCategoryChip[]
}

export function FaqAccordion({ faqItems, faqCategories }: FaqAccordionProps) {
  const [searchKeyword, setSearchKeyword] = React.useState("")
  const [activeCategoryCode, setActiveCategoryCode] = React.useState(
    ALL_FAQ_CATEGORY_CODE
  )
  // 목업은 다중 펼침 허용(openFaq 객체) — 단일 펼침으로 좁히지 않는다
  const [openFaqIds, setOpenFaqIds] = React.useState<Set<number>>(
    () => new Set()
  )

  const normalizedKeyword = searchKeyword.trim().toLowerCase()
  const filteredFaqItems = faqItems.filter((faqItem) => {
    if (
      activeCategoryCode !== ALL_FAQ_CATEGORY_CODE &&
      faqItem.categoryCode !== activeCategoryCode
    ) {
      return false
    }
    if (normalizedKeyword.length === 0) return true
    return (
      faqItem.question.toLowerCase().includes(normalizedKeyword) ||
      faqItem.answer.toLowerCase().includes(normalizedKeyword)
    )
  })

  const handleToggleFaq = (faqPostId: number) => {
    setOpenFaqIds((previousOpenIds) => {
      const nextOpenIds = new Set(previousOpenIds)
      if (nextOpenIds.has(faqPostId)) nextOpenIds.delete(faqPostId)
      else nextOpenIds.add(faqPostId)
      return nextOpenIds
    })
  }

  const handleResetFilters = () => {
    setSearchKeyword("")
    setActiveCategoryCode(ALL_FAQ_CATEGORY_CODE)
  }

  const categoryChips: FaqCategoryChip[] = [
    { categoryCode: ALL_FAQ_CATEGORY_CODE, categoryName: "전체" },
    ...faqCategories,
  ]

  return (
    <div>
      <div className="relative mb-3.5">
        <Input
          type="search"
          size="form"
          aria-label="자주 묻는 질문 검색"
          placeholder="궁금한 내용을 검색해 보세요"
          className="rounded-full pr-11 pl-4"
          value={searchKeyword}
          onChange={(changeEvent) => setSearchKeyword(changeEvent.target.value)}
        />
        {/* 목업 실측상 장식 — 검색은 입력 즉시 반영이라 제출 버튼이 없다 */}
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute top-1/2 right-4 size-[19px] -translate-y-1/2 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" strokeLinecap="round" />
        </svg>
      </div>

      <div
        role="group"
        aria-label="질문 분류 필터"
        className="mb-[18px] flex gap-2 overflow-x-auto pb-1"
      >
        {categoryChips.map((categoryChip) => {
          const isActiveChip = categoryChip.categoryCode === activeCategoryCode
          return (
            <button
              key={categoryChip.categoryCode}
              type="button"
              aria-pressed={isActiveChip}
              onClick={() => setActiveCategoryCode(categoryChip.categoryCode)}
              className={cn(
                "inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
                isActiveChip
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-foreground"
              )}
            >
              {categoryChip.categoryName}
            </button>
          )
        })}
      </div>

      {filteredFaqItems.length === 0 ? (
        <EmptyState
          size="inline"
          headingLevel={2}
          icon={<span>🔍</span>}
          iconSize={34}
          title="검색 결과가 없어요"
          description="다른 키워드로 검색하거나 분류를 바꿔보세요."
          actions={[{ label: "검색 초기화", onAction: handleResetFilters }]}
        />
      ) : (
        <ul className="m-0 list-none border-t border-border p-0">
          {filteredFaqItems.map((faqItem) => {
            const isOpen = openFaqIds.has(faqItem.faqPostId)
            const questionElementId = `faq-question-${faqItem.faqPostId}`
            const answerElementId = `faq-answer-${faqItem.faqPostId}`
            return (
              <li key={faqItem.faqPostId} className="border-b border-border">
                <button
                  type="button"
                  id={questionElementId}
                  aria-expanded={isOpen}
                  aria-controls={answerElementId}
                  onClick={() => handleToggleFaq(faqItem.faqPostId)}
                  className="flex w-full cursor-pointer items-start gap-3 px-1.5 py-[18px] text-left"
                >
                  <span
                    aria-hidden="true"
                    className="font-heading text-[16px] leading-[1.4] font-extrabold text-primary"
                  >
                    Q
                  </span>
                  <span className="flex-1 text-[15px] leading-[1.4] font-semibold text-foreground">
                    {faqItem.question}
                  </span>
                  {faqItem.categoryName && (
                    <Badge
                      badgeTone="muted"
                      badgeSize="xs"
                      badgeShape="tag"
                      className="mt-0.5 font-bold"
                    >
                      {faqItem.categoryName}
                    </Badge>
                  )}
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 size-[18px] shrink-0 text-muted-foreground transition-transform duration-200",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>

                {isOpen && (
                  <div
                    id={answerElementId}
                    role="region"
                    aria-labelledby={questionElementId}
                    className="flex gap-3 px-1.5 pt-0.5 pb-5"
                  >
                    <span
                      aria-hidden="true"
                      className="font-heading text-[16px] leading-[1.5] font-extrabold text-muted-foreground"
                    >
                      A
                    </span>
                    <p className="m-0 flex-1 text-sm leading-[1.75] whitespace-pre-line text-muted-foreground">
                      {faqItem.answer}
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
