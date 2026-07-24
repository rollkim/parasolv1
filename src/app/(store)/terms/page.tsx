// 핸드오프 규격: PaRaSOL 약관문서.dc.html — 문서 전환 필(40px·radius 999px·13px/700, 활성 primary 반전) ·
// 본문 상단 메타(시행일 13px muted) · 콘텐츠 최대폭 1040px
// [탭 순서] 1 로고 → 2 문서 전환 → 3 목차 → 4 본문 (로고는 공통 헤더 몫)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 문서 전환이 목업의 button+state가 아니라 ?doc= 쿼리 링크 — URL이 상태 원본이라
//    푸터 딥링크(/terms/tos 별칭 라우트 경유)·새로고침·공유가 보존된다(상품목록 페이지네이션 선례).
//  - 문서 키는 목업(tos)이 아니라 terms_document.code(terms) — DB가 단일 소스이며
//    목업 키 tos는 별칭으로만 흡수한다(푸터 링크가 이 키를 쓴다).
//  - 목업 4번째 탭 '사업자 정보(biz)'는 미구현 — terms_document가 아니라 site_setting 소유 데이터이고
//    법정 표기는 이미 전 화면 푸터에 상시 노출된다(RULE-11). 별도 문서화가 필요하면 후속 결정.
//  - 사이드 목차(sticky)·'이전 버전 보기'는 미구현 — 본문이 구조화되지 않은 평문(시드 placeholder)이라
//    섹션 앵커를 만들 근거가 없고, 버전 이력 화면도 없다. 실제 약관 문안(섹션 구조) 확정 시 함께 도입.
//  - 시행일 메타의 '최종 개정'은 스키마에 없어(effective_at 단일) 버전 표기로 대체한다.
//  - 필 높이 40px → 44px 상향(터치 타겟 KWCAG — 헤더 칩 선례), 활성 표시는 색 + aria-current 이중 전달.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { formatDateDot } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import {
  getTermsDocument,
  getTermsDocuments,
} from "@/server/services/terms.service";

export const metadata: Metadata = { title: "약관 및 정책" };

/**
 * 열람 탭으로 노출할 문서 코드 — 등록순(getTermsDocuments)이 아니라 이 배열 순서가 탭 순서다.
 * 동의 전용 스니펫(age·marketing·third_party·purchase_confirm)은 가입·체크아웃 흐름 소유라 제외.
 */
const TERMS_TAB_CODES = ["terms", "privacy", "delivery"] as const;

/** 목업·푸터가 쓰는 키 → DB 코드 별칭. 새 별칭은 여기 한 곳에만 추가한다. */
const TERMS_CODE_ALIASES: Record<string, string> = { tos: "terms" };

type TermsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TermsPage({ searchParams }: TermsPageProps) {
  const { doc } = await searchParams;
  const requestedDocCode = (Array.isArray(doc) ? doc[0] : doc) ?? "terms";
  const termsCode = TERMS_CODE_ALIASES[requestedDocCode] ?? requestedDocCode;

  const [allTermsDocuments, activeDocument] = await Promise.all([
    getTermsDocuments(db),
    getTermsDocument(db, termsCode),
  ]);
  // 없는 코드는 잘못된 주소 — 빈 화면 대신 404로 원인을 드러낸다
  if (!activeDocument) notFound();

  // 탭은 실제 존재하는 문서만 — 시드 누락 코드가 깨진 링크로 노출되지 않게 한다
  const termsTabs = TERMS_TAB_CODES.flatMap((tabCode) => {
    const tabDocument = allTermsDocuments.find(
      (documentSummary) => documentSummary.termsCode === tabCode,
    );
    return tabDocument ? [tabDocument] : [];
  });

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 font-heading text-[22px] font-extrabold">
        약관 및 정책
      </h1>

      {/* 좁은 폭에서는 목업처럼 가로 스크롤 — 줄바꿈으로 필이 접히지 않는다 */}
      <nav
        aria-label="약관 문서 전환"
        className="mt-3.5 flex gap-2 overflow-x-auto pb-1"
      >
        {termsTabs.map((termsTab) => {
          const isActiveTab = termsTab.termsCode === activeDocument.termsCode;
          return (
            <Link
              key={termsTab.termsCode}
              // 기본 문서(terms)는 파라미터를 생략해 정규 URL을 유지한다(상품목록 href 조립 규칙과 동일)
              href={
                termsTab.termsCode === "terms"
                  ? "/terms"
                  : `/terms?doc=${termsTab.termsCode}`
              }
              aria-current={isActiveTab ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[13px] font-bold whitespace-nowrap transition-colors",
                isActiveTab
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-foreground",
              )}
            >
              {termsTab.title}
            </Link>
          );
        })}
      </nav>

      <article className="mt-6">
        <h2 className="m-0 font-heading text-[clamp(20px,2.6vw,26px)] leading-[1.35] font-extrabold">
          {activeDocument.title}
        </h2>
        <p className="mt-2 mb-6 text-[13px] text-muted-foreground">
          시행일: {formatDateDot(activeDocument.effectiveAt)} · 버전{" "}
          {activeDocument.version}
        </p>
        {/* 본문은 평문 저장(terms_document.content) — 줄바꿈만 보존해 그대로 그린다 */}
        <div className="text-[15px] leading-[1.85] whitespace-pre-line">
          {activeDocument.content}
        </div>
      </article>
    </div>
  );
}
