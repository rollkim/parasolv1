/**
 * 토스페이먼츠 은행 코드 — 가상계좌 환불 계좌(refundReceiveAccount.bank) 입력용.
 *
 * 값은 토스 공식 문서(기관 및 ENUM 코드)에서 그대로 가져온다 — 지어내지 않는다.
 * 여기 없는 은행은 지원 범위 밖이다(전체 코드는 문서 참고, 주요 은행 위주로 추렸다).
 */
export const TOSS_BANK_CODES: { code: string; name: string }[] = [
  { code: "02", name: "산업은행" },
  { code: "03", name: "기업은행" },
  { code: "06", name: "국민은행" },
  { code: "07", name: "수협은행" },
  { code: "11", name: "농협은행" },
  { code: "20", name: "우리은행" },
  { code: "23", name: "SC제일은행" },
  { code: "27", name: "씨티은행" },
  { code: "31", name: "iM뱅크(대구)" },
  { code: "32", name: "부산은행" },
  { code: "34", name: "광주은행" },
  { code: "37", name: "전북은행" },
  { code: "39", name: "경남은행" },
  { code: "45", name: "새마을금고" },
  { code: "48", name: "신협" },
  { code: "71", name: "우체국예금" },
  { code: "81", name: "하나은행" },
  { code: "88", name: "신한은행" },
  { code: "89", name: "케이뱅크" },
  { code: "90", name: "카카오뱅크" },
  { code: "92", name: "토스뱅크" },
];

export function isValidBankCode(code: string): boolean {
  return TOSS_BANK_CODES.some((bank) => bank.code === code);
}

export function bankNameByCode(code: string): string | null {
  return TOSS_BANK_CODES.find((bank) => bank.code === code)?.name ?? null;
}
