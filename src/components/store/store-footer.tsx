// 핸드오프 규격: PaRaSOL 메인.dc.html 412-459 (마스터 푸터)
//
// [탭 순서] 푸터: 1 고객지원 4링크 → 2 쇼핑정보 4링크 → 3 고객센터 전화
// DOM 순서가 곧 탭 순서다 — tabindex를 조작하지 않는다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업의 container query(@container store)·cqw를 뷰포트 기준 md:(768px)·vw로 환산.
//  - 목업은 페이지 전체가 1280px 컨테이너 안이라 푸터도 그 폭이지만, 프로덕션은 bg-muted가
//    뷰포트 전폭을 덮어야 하므로 폭 제한을 내부 래퍼로 옮겼다.
//  - 전화번호는 목업에서 <div>지만 모바일 다이얼 연결을 위해 tel: 링크로 감쌌다.
//  - 링크·전화 히트영역을 모바일에서 44px로 키웠다(목업 9px 간격은 md: 이상에서 유지 · KWCAG).
//  - 결제수단 칩 라운드는 목업 6px이나 Badge의 tag 규격(rounded-sm)을 따른다 — 리터럴 대신
//    --radius 파생값을 써야 리스킨 시 라운드가 함께 움직인다(badge.tsx 규약).
//  - 축약형(compact)은 목업이 없다. 스펙서 "체크아웃은 축약형 푸터 허용(사업자 표기는 유지)"에 따름.

import { Fragment } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { BusinessInfo } from "@/server/services/site-setting.service"

import { ParasolMark } from "./store-header"

/* 결제수단 표기 — 업체가 아니라 결제 스택(토스페이먼츠)에 종속된 값이라 코드가 소유한다.
   BusinessInfo에 해당 필드가 없으므로 임의 추가 대신 이 상수 한 곳을 교체 지점으로 둔다.
   아이콘이 아니라 텍스트인 이유: 색·이미지만으로 정보를 전달하지 않는다(KWCAG). */
const PAYMENT_METHOD_LABELS = ["CARD", "BANK", "toss pay", "kakao pay"]

/* 링크 구성은 라우트라 site_setting이 아니라 코드가 소유한다(리스킨 교체 대상 아님).
   TODO(라우트 미구현): /notice · /faq · /qna · /order-lookup · /terms/* 페이지는 아직 없다.
   약관 문서 키(tos/privacy/delivery)는 목업 약관문서.dc.html의 DOCS 배열을 따랐다. */
const FOOTER_LINK_GROUPS = [
  {
    groupKey: "support",
    groupTitle: "고객지원",
    groupLinks: [
      { linkLabel: "공지사항", linkHref: "/notice" },
      { linkLabel: "자주 묻는 질문", linkHref: "/faq" },
      { linkLabel: "1:1 문의", linkHref: "/qna" },
      { linkLabel: "비회원 주문조회", linkHref: "/order-lookup" },
    ],
  },
  {
    groupKey: "shopping",
    groupTitle: "쇼핑정보",
    groupLinks: [
      { linkLabel: "배송안내", linkHref: "/terms/delivery" },
      // 교환·반품은 배송 약관 문서의 해당 섹션으로 보낸다(목업은 주문상세로 연결돼 있었음)
      { linkLabel: "교환·반품", linkHref: "/terms/delivery#s2" },
      { linkLabel: "이용약관", linkHref: "/terms/tos" },
      { linkLabel: "개인정보처리방침", linkHref: "/terms/privacy" },
    ],
  },
]

type LegalEntry = { legalLabel: string; legalValue: string }

export type StoreFooterProps = {
  /** 루트 레이아웃에서 getBusinessInfo(db)로 조회해 내려준다 — 푸터는 db를 직접 보지 않는다. */
  businessInfo: BusinessInfo
  /** compact = 체크아웃 전용 축약형. 결제 집중을 위해 법정 표기만 남긴다. */
  variant?: "full" | "compact"
}

/**
 * 전 스토어프론트 공통 푸터(서버 컴포넌트 — 상태·핸들러가 없다).
 * 업체가 바뀌면 달라지는 값은 전부 businessInfo 경유다(RULE-11 재판매 리스킨).
 */
export function StoreFooter({
  businessInfo,
  variant = "full",
}: StoreFooterProps) {
  const isCompact = variant === "compact"

  const legalPrimaryEntries: LegalEntry[] = [
    { legalLabel: "상호", legalValue: businessInfo.companyName },
    { legalLabel: "대표", legalValue: businessInfo.ceoName },
    { legalLabel: "사업자등록번호", legalValue: businessInfo.businessNo },
    // 값에 '제'·'호'까지 포함해 저장한다 — 코드에서 접두·접미를 조립하지 않는다(업체별 표기 상이)
    { legalLabel: "통신판매업신고", legalValue: businessInfo.mailOrderNo },
  ]
  const legalSecondaryEntries: LegalEntry[] = [
    { legalLabel: "주소", legalValue: businessInfo.address },
    { legalLabel: "개인정보관리책임자", legalValue: businessInfo.privacyOfficer },
    { legalLabel: "호스팅", legalValue: businessInfo.hostingProvider },
  ]

  return (
    <footer className="mt-[clamp(16px,3vw,32px)] border-t border-border bg-muted">
      <div
        className={cn(
          "mx-auto w-full max-w-[1280px] px-4 md:px-10",
          isCompact ? "py-[clamp(20px,3vw,28px)]" : "py-[clamp(28px,4vw,44px)]"
        )}
      >
        {!isCompact && (
          <div className="grid grid-cols-2 gap-x-[18px] gap-y-[26px] md:grid-cols-[1.6fr_1fr_1fr_1.2fr] md:gap-10">
            <div>
              <div className="flex items-center gap-2 text-foreground">
                <ParasolMark className="size-6 shrink-0" />
                {/* 워드마크는 브랜드명(brandName), 아래 법정 표기는 법인명(companyName) —
                    목업이 "PaRaSOL"과 "파라솔 협동조합"을 구분해 쓴다. 둘 다 site_setting 경유(RULE-11). */}
                <span className="font-heading text-xl font-extrabold">
                  {businessInfo.brandName}
                </span>
              </div>

              <p className="mt-3 max-w-[34ch] text-[13px] leading-[1.7] text-muted-foreground">
                {businessInfo.brandTagline}
              </p>

              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {PAYMENT_METHOD_LABELS.map((paymentLabel) => (
                  <Badge
                    key={paymentLabel}
                    badgeTone="muted"
                    badgeSize="xs"
                    badgeShape="tag"
                    className="border border-border bg-transparent py-1 font-bold"
                  >
                    {paymentLabel}
                  </Badge>
                ))}
              </div>
            </div>

            {FOOTER_LINK_GROUPS.map((linkGroup) => {
              const groupHeadingId = `store-footer-${linkGroup.groupKey}`
              return (
                // 목업은 div+a 나열이지만, 그룹 수·항목 수가 낭독되도록 nav+ul로 올린다
                <nav key={linkGroup.groupKey} aria-labelledby={groupHeadingId}>
                  <h2
                    id={groupHeadingId}
                    className="mb-3 text-[13px] font-extrabold"
                  >
                    {linkGroup.groupTitle}
                  </h2>
                  <ul className="flex flex-col text-[13px] md:gap-[9px]">
                    {linkGroup.groupLinks.map((footerLink) => (
                      <li key={footerLink.linkLabel}>
                        <Link
                          href={footerLink.linkHref}
                          className="flex min-h-11 items-center text-muted-foreground transition-colors hover:text-primary hover:underline md:min-h-0"
                        >
                          {footerLink.linkLabel}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )
            })}

            <div>
              <h2 className="mb-3 text-[13px] font-extrabold">고객센터</h2>
              {/* 전역 a 색(primary) 상속을 막으려고 foreground를 명시한다 */}
              <a
                href={`tel:${businessInfo.csPhone.replace(/[^0-9+]/g, "")}`}
                aria-label={`고객센터 ${businessInfo.csPhone}으로 전화하기`}
                className="inline-flex min-h-11 items-center font-heading text-[22px] font-extrabold tracking-[0.01em] text-foreground md:min-h-0"
              >
                {businessInfo.csPhone}
              </a>
              {/* 목업은 <br> 2줄 하드코딩 — 배열이므로 줄 단위 블록으로 낭독 경계를 만든다 */}
              <div className="mt-1.5 text-xs leading-[1.7] text-muted-foreground">
                {businessInfo.csHours.map((csHourLine) => (
                  <span key={csHourLine} className="block">
                    {csHourLine}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div
          className={cn(
            "text-xs leading-[1.9] text-muted-foreground",
            !isCompact && "mt-7 border-t border-border pt-5"
          )}
        >
          <LegalLine legalEntries={legalPrimaryEntries} />
          <LegalLine legalEntries={legalSecondaryEntries} />
          <span className="mt-2 inline-block">
            {businessInfo.copyrightNotice}
          </span>
        </div>
      </div>
    </footer>
  )
}

/** 법정 표기 한 줄. 구분점 '·'은 시각 구분자라 낭독에서 제외한다(헤더 유틸바와 동일 처리). */
function LegalLine({ legalEntries }: { legalEntries: LegalEntry[] }) {
  return (
    <span className="block">
      {legalEntries.map((legalEntry, entryIndex) => (
        <Fragment key={legalEntry.legalLabel}>
          {entryIndex > 0 && <span aria-hidden="true"> · </span>}
          {legalEntry.legalLabel}: {legalEntry.legalValue}
        </Fragment>
      ))}
    </span>
  )
}
