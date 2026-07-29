"use client"

// 핸드오프 규격: 상품상세.dc.html L284~382(탭 4종: 상세설명·리뷰·문의·배송안내) —
// [탭 순서](L115) 상 상세 탭은 구매 CTA 뒤. 탭 min-height 54px·활성 하단바 2px = Tabs variant "underline".
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 리뷰·문의 탭 본문은 3~4주차 기능이라 EmptyState(inline) '준비 중'으로 대체(스텁 규칙).
//    TODO(4주차): 리뷰 요약 카드·리뷰 목록(L317~349) / 문의 목록·배지(L351~369) 규격으로 교체.
//  - 정보 테이블(원재료·중량·보관방법·알레르기)·보호작업장 각주는 대응 데이터(스키마 컬럼·site_setting)가
//    아직 없어 제외 — 데이터 확보 시 추가.
//  - 배송안내는 지시대로 목업 문구를 정적 렌더. 배송비·정책 문구는 리스킨 규약(RULE-11)상
//    site_setting 연동 대상 — TODO(3주차): 배송 도메인 작업 때 주입 방식으로 교체.
//  - 목업에는 tabpanel role·화살표 키 이동이 없다(미발견) — Radix Tabs가 보강한다.

import * as React from "react"
import { MessageCircleQuestionIcon, StarIcon } from "lucide-react"

import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export type ProductDetailTabsProps = {
  /** 짧은 소개문 — 상세 설명이 없을 때의 대체 본문 */
  productSummary: string | null
  /**
   * 관리자가 입력한 상세 설명 — **평문**이다.
   *
   * 관리자 상품 폼이 일반 textarea라 HTML을 만드는 곳이 없다. 그런데도 HTML로 렌더하면
   * ① 관리자가 붙여넣은 스크립트가 전 방문자에게 실행되고(저장형 XSS)
   * ② "5 < 10" 같은 평범한 문장이 태그로 먹혀 본문이 깨진다.
   * 서식 편집기를 붙이는 시점에 **새니타이저(DOMPurify 계열)를 함께** 도입하고
   * 그때 이 prop을 HTML로 되돌린다 — 편집기 없이 HTML 렌더만 열어두면 얻는 것 없이 위험만 남는다.
   */
  descriptionText: string | null
  /** 세로로 이어붙는 상세 이미지 스택 (관리자 '상세 이미지' 등록 반영) */
  detailImages: { path: string; alt: string }[]
}

export function ProductDetailTabs({
  productSummary,
  descriptionText,
  detailImages,
}: ProductDetailTabsProps) {
  const [activeTabValue, setActiveTabValue] = React.useState("description")

  // 구매정보 열의 "리뷰 N개" 링크가 #reviews 해시로 진입하면 리뷰 탭을 활성화한다 —
  // 컴포넌트 간 직접 참조 없이 URL 해시를 매개로 결합을 끊는다(목업 L472 pickTab 대응).
  React.useEffect(() => {
    const activateReviewsFromHash = () => {
      if (window.location.hash === "#reviews") setActiveTabValue("reviews")
    }
    activateReviewsFromHash()
    window.addEventListener("hashchange", activateReviewsFromHash)
    return () => window.removeEventListener("hashchange", activateReviewsFromHash)
  }, [])

  const hasDescriptionText = Boolean(descriptionText || productSummary)

  return (
    // id="reviews"는 별점 행 앵커의 목적지(목업 실측) — 탭 영역 전체로 스크롤한다
    <section
      id="reviews"
      className="mt-[clamp(32px,5vw,56px)] scroll-mt-4 pb-12"
    >
      <Tabs value={activeTabValue} onValueChange={setActiveTabValue}>
        <TabsList variant="underline" aria-label="상품 정보">
          <TabsTrigger value="description">상세설명</TabsTrigger>
          <TabsTrigger value="reviews">리뷰</TabsTrigger>
          <TabsTrigger value="inquiries">문의</TabsTrigger>
          <TabsTrigger value="shipping">배송안내</TabsTrigger>
        </TabsList>

        {/* ── 상세설명 ── */}
        <TabsContent
          value="description"
          className="mx-auto w-full max-w-[720px] py-7"
        >
          {descriptionText ? (
            /* 평문을 그대로 그린다 — 줄바꿈만 살리고 태그는 글자로 보인다.
               HTML로 넣지 않는 것이 이 화면의 XSS 방어 자체다(prop 주석 참고) */
            <p className="whitespace-pre-wrap text-base leading-[1.8]">{descriptionText}</p>
          ) : productSummary ? (
            <p className="text-base leading-[1.8]">{productSummary}</p>
          ) : null}

          {detailImages.length > 0 && (
            <div
              className={cn(
                "flex flex-col gap-0.5 overflow-hidden rounded-lg border border-border",
                hasDescriptionText && "mt-6"
              )}
            >
              {detailImages.map((detailImage) => (
                // 이미지 최적화(next/image)는 5주차 — 그전까지 일반 img
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={detailImage.path}
                  src={detailImage.path}
                  alt={detailImage.alt}
                  loading="lazy"
                  className="block w-full"
                />
              ))}
            </div>
          )}

          {!hasDescriptionText && detailImages.length === 0 && (
            <EmptyState
              size="inline"
              title="상세 설명 준비 중"
              description="상품 상세 정보가 등록되면 이곳에서 보실 수 있어요."
            />
          )}
        </TabsContent>

        {/* ── 리뷰 — TODO(4주차): 요약 카드·리뷰 목록·리뷰 작성 진입으로 교체 ── */}
        <TabsContent
          value="reviews"
          className="mx-auto w-full max-w-[720px] py-7"
        >
          <EmptyState
            size="inline"
            stateTone="brand"
            icon={<StarIcon strokeWidth={1.5} />}
            title="리뷰 준비 중"
            description="리뷰 작성과 조회는 준비 중이에요. 오픈되면 구매 후기를 이곳에서 확인하실 수 있어요."
          />
        </TabsContent>

        {/* ── 문의 — TODO(4주차): 문의 목록·상태 배지·문의 작성 진입으로 교체 ── */}
        <TabsContent
          value="inquiries"
          className="mx-auto w-full max-w-[720px] py-7"
        >
          <EmptyState
            size="inline"
            icon={<MessageCircleQuestionIcon strokeWidth={1.5} />}
            title="상품 문의 준비 중"
            description="상품 문의 작성과 답변 확인은 준비 중이에요. 그동안 급한 문의는 고객센터를 이용해 주세요."
          />
        </TabsContent>

        {/* ── 배송안내 — 목업 문구 정적 렌더(문구·금액은 site_setting 연동 예정) ── */}
        <TabsContent
          value="shipping"
          className="mx-auto w-full max-w-[720px] py-7"
        >
          <div className="text-sm leading-[1.9]">
            <h2 className="mb-1.5 text-sm font-extrabold">배송 안내</h2>
            <p className="mb-4 text-muted-foreground">
              택배 배송 · 기본 배송비 3,000원 (3만원 이상 구매 시 무료) · 평일
              14시 이전 결제 건은 당일 출고되며, 주문 후 평균 1~3일 내 수령하실
              수 있습니다.
            </p>
            <h2 className="mb-1.5 text-sm font-extrabold">교환·반품 안내</h2>
            <p className="text-muted-foreground">
              식품 특성상 단순 변심에 의한 교환·반품은 제한됩니다. 상품
              하자·오배송의 경우 수령 후 7일 이내 고객센터로 연락 주시면 신속히
              처리해 드립니다.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  )
}
