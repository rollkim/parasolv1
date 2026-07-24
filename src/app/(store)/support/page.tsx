// 고객센터 허브 — 전용 목업이 없는 조합 화면. 규격은 이웃 화면에서 준용:
// h1 22px/800(공지FAQ) · 전화 표기(푸터 고객센터 블록: font-heading 22px + tel 링크 + 운영시간 12~13px) ·
// 카드·행 규격(border-border/bg-card·radius-lg) · Q 행(공지FAQ FAQ 아코디언 트리거 축약)
//
// 구성(배정 스펙): 빠른메뉴 · FAQ 발췌 · 1:1 문의 진입 · 전화/운영시간(getBusinessInfo — 레이아웃과 동일 경로)
//
// 의도적으로 뺀 것(사유):
//  - 빠른메뉴의 '비회원 주문조회' — /order-lookup 라우트 미구현(푸터 TODO와 동일). 배선 시 항목만 추가.
//  - FAQ 발췌의 아코디언 펼침 — 발췌는 진입 유도가 목적이라 행 전체를 /support/faq 링크로 둔다(클라이언트 상태 불필요).

import type { Metadata } from "next";
import Link from "next/link";

import {
  HelpCircleIcon,
  MegaphoneIcon,
  MessageSquareIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { getFaqList } from "@/server/services/board.service";
import { getBusinessInfo } from "@/server/services/site-setting.service";

export const metadata: Metadata = { title: "고객센터" };

const FAQ_EXCERPT_COUNT = 4;

/** 링크 구성은 라우트라 코드가 소유한다(푸터 선례 — site_setting 아님) */
const SUPPORT_QUICK_LINKS = [
  {
    quickLabel: "공지사항",
    quickHref: "/notice",
    QuickIcon: MegaphoneIcon,
  },
  {
    quickLabel: "자주 묻는 질문",
    quickHref: "/support/faq",
    QuickIcon: HelpCircleIcon,
  },
  {
    quickLabel: "1:1 문의",
    quickHref: "/support/qna",
    QuickIcon: MessageSquareIcon,
  },
];

export default async function SupportHubPage() {
  const [businessInfo, faqItems] = await Promise.all([
    getBusinessInfo(db),
    getFaqList(db),
  ]);
  const faqExcerpts = faqItems.slice(0, FAQ_EXCERPT_COUNT);

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 mb-[18px] font-heading text-[22px] font-extrabold">
        고객센터
      </h1>

      {/* 전화·운영시간 — 업체 교체 대상 값은 전부 businessInfo 경유(RULE-11 리스킨) */}
      <section
        aria-label="고객센터 연락처"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 md:flex-row md:items-center md:justify-between md:p-6"
      >
        <div>
          <p className="m-0 text-[13px] font-bold text-muted-foreground">
            고객센터 전화
          </p>
          {/* 전역 a 색(primary) 상속을 막으려고 foreground를 명시한다(푸터 선례) */}
          <a
            href={`tel:${businessInfo.csPhone.replace(/[^0-9+]/g, "")}`}
            aria-label={`고객센터 ${businessInfo.csPhone}으로 전화하기`}
            className="mt-0.5 inline-flex min-h-11 items-center font-heading text-[26px] font-extrabold tracking-[0.01em] text-foreground md:min-h-0"
          >
            {businessInfo.csPhone}
          </a>
          <div className="mt-1 text-[13px] leading-[1.7] text-muted-foreground">
            {businessInfo.csHours.map((csHourLine) => (
              <span key={csHourLine} className="block">
                {csHourLine}
              </span>
            ))}
          </div>
        </div>
        <Button asChild variant="primary" size="md-48" className="md:shrink-0">
          <Link href="/support/qna">1:1 문의하기</Link>
        </Button>
      </section>

      <nav
        aria-label="고객센터 빠른 메뉴"
        className="mt-3.5 grid grid-cols-3 gap-2.5"
      >
        {SUPPORT_QUICK_LINKS.map(({ quickLabel, quickHref, QuickIcon }) => (
          <Link
            key={quickHref}
            href={quickHref}
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 text-center text-sm font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <QuickIcon className="size-6" aria-hidden="true" />
            {quickLabel}
          </Link>
        ))}
      </nav>

      {faqExcerpts.length > 0 && (
        <section aria-labelledby="support-faq-heading" className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2
              id="support-faq-heading"
              className="m-0 font-heading text-lg font-extrabold"
            >
              자주 묻는 질문
            </h2>
            <Link
              href="/support/faq"
              className="inline-flex min-h-11 items-center text-[13px] font-semibold text-muted-foreground transition-colors hover:text-primary md:min-h-0"
            >
              전체 보기
            </Link>
          </div>
          <ul className="m-0 mt-2 list-none border-t border-border p-0">
            {faqExcerpts.map((faqExcerpt) => (
              <li key={faqExcerpt.faqPostId} className="border-b border-border">
                <Link
                  href="/support/faq"
                  className="flex min-h-[54px] items-center gap-3 px-1.5 py-3 transition-colors hover:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className="font-heading text-[16px] font-extrabold text-primary"
                  >
                    Q
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {faqExcerpt.question}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    className="size-4 shrink-0 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path
                      d="m9 6 6 6-6 6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
