import { redirect } from "next/navigation";

/**
 * FAQ 경로 별칭 — 푸터 '자주 묻는 질문'이 /faq로 링크한다(링크 파일은 수정 금지 배정).
 * 정식 주소는 헤더 STORE_ROUTE.faq와 같은 /support/faq 하나로 유지한다.
 */
export default function FaqAliasPage() {
  redirect("/support/faq");
}
