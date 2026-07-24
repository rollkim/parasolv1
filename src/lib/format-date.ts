/**
 * 날짜 표기 YYYY.MM.DD — 핸드오프 게시판·약관 화면 공통 포맷(공지FAQ·약관문서·1대1문의 목업 실측).
 * 서버 컴포넌트에서 포맷을 끝내 클라이언트 시간대·로케일 차이가 표기에 끼어들지 않게 한다.
 * (format.ts는 이번 배정 외 파일이라 수정하지 않고 별도 모듈로 둔다 — 병합은 후속 판단)
 */
export function formatDateDot(dateValue: Date): string {
  const fullYear = dateValue.getFullYear();
  const paddedMonth = String(dateValue.getMonth() + 1).padStart(2, "0");
  const paddedDay = String(dateValue.getDate()).padStart(2, "0");
  return `${fullYear}.${paddedMonth}.${paddedDay}`;
}
