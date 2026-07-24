import { redirect } from "next/navigation";

/**
 * 1:1 문의 경로 별칭 — 푸터 '1:1 문의'가 /qna로 링크한다(링크 파일은 수정 금지 배정).
 * 정식 주소는 고객센터 하위인 /support/qna 하나로 유지한다.
 */
export default function QnaAliasPage() {
  redirect("/support/qna");
}
