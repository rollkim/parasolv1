import { redirect } from "next/navigation";

/**
 * 약관 경로 별칭 — 푸터가 /terms/tos·/terms/privacy·/terms/delivery 형태로 링크한다
 * (링크 파일은 수정 금지 배정이라 라우트 쪽에서 흡수). 약관 화면의 정규 주소는
 * /terms?doc= 쿼리 하나이므로 여기서는 코드 해석 없이 그대로 넘긴다 —
 * 별칭(tos→terms)·존재 검증은 /terms 페이지가 한 곳에서 담당한다.
 */
export default async function TermsDocAliasPage({
  params,
}: {
  params: Promise<{ termsCode: string }>;
}) {
  const { termsCode } = await params;
  redirect(`/terms?doc=${encodeURIComponent(termsCode)}`);
}
