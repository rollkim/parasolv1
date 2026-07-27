/**
 * 휴대폰 번호 정규화 — 저장·조회가 반드시 같은 형태를 쓰게 하는 단일 진실원.
 *
 * 저장은 하이픈 포함인데 조회는 숫자만(또는 반대)이면 정당한 주문자가 자기 주문을
 * 영구히 못 찾는다. 화면 입력은 '010-1234-5678'이 기본이므로 **숫자만 남겨 저장**하고
 * 비교도 정규화된 값끼리 한다. 표시용 하이픈은 화면이 붙인다.
 */

/** 숫자 외 문자를 모두 제거한다 */
export function normalizePhone(rawPhone: string): string {
  return rawPhone.replace(/[^0-9]/g, "");
}

/** 국내 휴대폰 번호 형식인가 — 010·011·016·017·018·019 + 7~8자리 */
export function isMobilePhone(normalizedPhone: string): boolean {
  return /^01[016789][0-9]{7,8}$/.test(normalizedPhone);
}

/** 표시용 하이픈 삽입: 01012345678 → 010-1234-5678 */
export function formatPhone(normalizedPhone: string): string {
  if (!isMobilePhone(normalizedPhone)) return normalizedPhone;
  const head = normalizedPhone.slice(0, 3);
  const tail = normalizedPhone.slice(-4);
  const middle = normalizedPhone.slice(3, -4);
  return `${head}-${middle}-${tail}`;
}
