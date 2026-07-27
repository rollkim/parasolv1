/**
 * 주문·클레임 번호 형식 — 순수 문자열 규칙.
 * 채번(시퀀스 nextval)은 서비스가, 형식 조립·파싱은 여기가 담당한다.
 * 날짜 접두는 표시용(주문일 KST), 일련번호는 전역 누적(일별 리셋 없음).
 */

export type ClaimType = "cancel" | "exchange" | "return";
export type ClaimPrefix = "CN" | "EX" | "RT";

const CLAIM_PREFIX: Record<ClaimType, ClaimPrefix> = {
  cancel: "CN",
  exchange: "EX",
  return: "RT",
};

const MIN_SEQ_DIGITS = 4;

/** 일련번호를 최소 4자리로, 초과 시 자연 확장(하드 캡 없음) */
function padSeq(seq: number): string {
  return String(seq).padStart(MIN_SEQ_DIGITS, "0");
}

/** 'YYYYMMDD-####' — ymd는 8자리 숫자 문자열 */
export function formatOrderNo(ymd: string, seq: number): string {
  return `${ymd}-${padSeq(seq)}`;
}

export function claimPrefix(type: ClaimType): ClaimPrefix {
  return CLAIM_PREFIX[type];
}

/** '{CN|EX|RT}-YYYYMMDD-####' */
export function formatClaimNo(type: ClaimType, ymd: string, seq: number): string {
  return `${claimPrefix(type)}-${ymd}-${padSeq(seq)}`;
}

const DAILY_NO_PATTERN = /^(?:(CN|EX|RT)-)?(\d{8})-(\d{4,})$/;

/** 주문/클레임 번호를 분해 — 형식이 어긋나면 null */
export function parseDailyNo(
  value: string,
): { prefix?: ClaimPrefix; ymd: string; seq: number } | null {
  const matched = DAILY_NO_PATTERN.exec(value.trim());
  if (!matched) return null;
  const [, prefix, ymd, seqText] = matched;
  return {
    ...(prefix ? { prefix: prefix as ClaimPrefix } : {}),
    ymd,
    seq: Number(seqText),
  };
}
