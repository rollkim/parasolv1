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

import { ProductQnaPanel } from "@/components/store/product-qna-panel"
import { ProductReviewPanel } from "@/components/store/product-review-panel"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export type ProductDetailTabsProps = {
  /** 짧은 소개문 — 상세 설명이 없을 때의 대체 본문 */
  productSummary: string | null
  /**
   * 관리자가 입력한 상세 설명 — **살균을 마친 HTML**이다.
   *
   * 관리자 폼이 서식 에디터(Tiptap)라 HTML이 들어온다. 저장 시 서버가 허용 목록으로 씻으므로
   * (admin-product.service → html-sanitize.service) 여기 오는 값은 이미 안전하다.
   * 씻는 자리를 저장 한 곳으로 못박은 이유: 렌더 시점에 씻으면 이 값을 쓰는 화면이 늘 때마다
   * 잊을 수 있고, 잊은 화면 하나가 곧 저장형 XSS 구멍이 된다.
   *
   * 옛 데이터(평문)도 그대로 그려진다 — 태그가 없으니 글자로 보인다.
   */
  descriptionText: string | null
  /** 세로로 이어붙는 상세 이미지 스택 (관리자 '상세 이미지' 등록 반영) */
  detailImages: { path: string; alt: string }[]
  /** 리뷰·문의 패널이 조회할 대상 */
  productId: number
  /** 비회원 문의 입력칸을 띄울지 — 로그인 상태는 서버가 알려준다 */
  isMember: boolean
}

export function ProductDetailTabs({
  productSummary,
  descriptionText,
  detailImages,
  productId,
  isMember,
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
            /* 서식 본문(HTML)을 그린다. **저장 시 서버가 이미 살균했다**
               (admin-product.service → html-sanitize.service) — 씻은 것만 DB에 들어가므로
               여기서 다시 씻지 않는다. 렌더 시점에 씻으면 화면이 늘 때마다 잊을 수 있고,
               잊은 화면 하나가 곧 구멍이다.
               태그별 여백·목록 표시는 여기서 준다 — 저장된 HTML에는 style이 없다(살균이 버린다) */
            <div
              className="text-base leading-[1.8] [&_blockquote]:my-5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_h2]:mt-7 [&_h2]:mb-2.5 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-extrabold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-bold [&_img]:my-5 [&_img]:max-w-full [&_img]:rounded-lg [&_li]:mb-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-primary [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: descriptionText }}
            />
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

        {/* ── 리뷰 ── */}
        <TabsContent
          value="reviews"
          className="mx-auto w-full max-w-[720px] py-7"
        >
          <ProductReviewPanel productId={productId} />
        </TabsContent>

        {/* ── 문의 ── */}
        <TabsContent
          value="inquiries"
          className="mx-auto w-full max-w-[720px] py-7"
        >
          <ProductQnaPanel productId={productId} isMember={isMember} />
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
