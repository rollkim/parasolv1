// 핸드오프 규격: PaRaSOL 공지FAQ.dc.html FAQ 탭 — h1 "자주 묻는 질문" 22px/800 · 본문 최대폭 820px.
// 검색·분류·아코디언 실측 규격은 클라이언트 컴포넌트(faq-accordion.tsx)가 소유한다.
//
// 서버/클라이언트 분리: 데이터(FAQ 전량·분류 목록)는 여기서 서비스로 1회 조회해 주입하고,
// 검색·필터·펼침 같은 즉답 상호작용만 클라이언트가 든다 — 항목 수가 적은 FAQ 특성상
// 필터마다 서버 왕복(쿼리 파라미터)을 태울 이유가 없다(getFaqList 주석의 사용 전제와 동일).

import type { Metadata } from "next";

import {
  FaqAccordion,
  type FaqCategoryChip,
} from "@/components/store/faq-accordion";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { getFaqList } from "@/server/services/board.service";

export const metadata: Metadata = { title: "자주 묻는 질문" };

export default async function FaqPage() {
  const faqItems = await getFaqList(db);

  // 분류 칩은 글이 있는 분류만 — 등장 순서(등록순)를 유지하며 중복 제거
  const faqCategories: FaqCategoryChip[] = [];
  for (const faqItem of faqItems) {
    if (faqItem.categoryCode === null || faqItem.categoryName === null) continue;
    if (
      !faqCategories.some(
        (existingChip) => existingChip.categoryCode === faqItem.categoryCode,
      )
    ) {
      faqCategories.push({
        categoryCode: faqItem.categoryCode,
        categoryName: faqItem.categoryName,
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 mb-[18px] font-heading text-[22px] font-extrabold">
        자주 묻는 질문
      </h1>

      {faqItems.length === 0 ? (
        <EmptyState
          size="panel"
          icon={<span>💬</span>}
          iconSize={40}
          title="등록된 질문이 없어요"
          description="자주 묻는 질문이 준비되면 이곳에서 안내드릴게요."
          actions={[{ label: "1:1 문의하기", href: "/support/qna" }]}
        />
      ) : (
        <FaqAccordion faqItems={faqItems} faqCategories={faqCategories} />
      )}
    </div>
  );
}
