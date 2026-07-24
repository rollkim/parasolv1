/** 금액 표기 — 전 화면 공통. 금액은 원 단위 integer(RULE-11)라 소수점이 없다. */
const krwFormatter = new Intl.NumberFormat("ko-KR");

export function formatKrw(amountWon: number): string {
  return `₩${krwFormatter.format(amountWon)}`;
}
