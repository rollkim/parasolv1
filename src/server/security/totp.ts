import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) — 관리자 2단계 인증의 코어.
 *
 * **외부 패키지를 쓰지 않는다.** 알고리즘이 HMAC-SHA1 + 절단 하나뿐이라 의존성을 들일
 * 이유가 없고, 인증 코드는 공급망 공격의 1순위 표적이다. 정확성은 RFC 부록의
 * 표준 테스트 벡터가 보장한다(totp.test.ts).
 *
 * 구글 OTP·Authy 기본값과 같은 파라미터: SHA-1 · 30초 창 · 6자리.
 */

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
/** 앞뒤 1창(±30초) 허용 — 휴대폰 시계가 조금 어긋나도 로그인이 된다 */
const TOTP_DRIFT_STEPS = 1;

// ── base32 (RFC 4648) — OTP 앱이 시크릿을 받는 표준 표기 ──

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      encoded += BASE32_ALPHABET[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
  }
  if (bitCount > 0) {
    encoded += BASE32_ALPHABET[(bits << (5 - bitCount)) & 31];
  }
  return encoded;
}

export function base32Decode(encoded: string): Uint8Array {
  const cleaned = encoded.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`base32가 아닌 문자: ${char}`);
    bits = (bits << 5) | value;
    bitCount += 5;
    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 255);
      bitCount -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

// ── HOTP/TOTP ─────────────────────────────────────────

/** HOTP 6자리 (RFC 4226) — 카운터의 HMAC-SHA1을 동적 절단한다 */
function hotp6(secretBytes: Uint8Array, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  // JS number로 안전한 범위(2^53)가 스텝 카운터로는 수십만 년 치라 BigInt가 필요 없다
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", Buffer.from(secretBytes)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** 시각 → 30초 스텝 번호 */
export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** 특정 스텝의 코드 — 검증 스크립트·테스트가 기대값을 만들 때도 쓴다 */
export function totpCodeAtStep(secretBase32: string, step: number): string {
  return hotp6(base32Decode(secretBase32), step);
}

/**
 * 코드 검증 — 맞으면 **일치한 스텝 번호**를 돌려준다(재사용 차단의 재료).
 *
 * 비교는 timingSafeEqual — 문자열 ===는 앞자리가 틀리면 빨리 끝나 응답 시간으로
 * 자릿수를 추릴 여지를 준다. 6자리 숫자라 실익은 작지만 비용이 0이다.
 */
export function verifyTotpCode(input: {
  secretBase32: string;
  code: string;
  nowMs: number;
}): { matchedStep: number } | null {
  const normalized = input.code.replace(/\s/g, "");
  if (!/^[0-9]{6}$/.test(normalized)) return null;

  const secretBytes = base32Decode(input.secretBase32);
  const centerStep = totpStep(input.nowMs);
  const codeBuffer = Buffer.from(normalized);

  for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift += 1) {
    const step = centerStep + drift;
    if (step < 0) continue;
    const expected = Buffer.from(hotp6(secretBytes, step));
    if (expected.length === codeBuffer.length && timingSafeEqual(expected, codeBuffer)) {
      return { matchedStep: step };
    }
  }
  return null;
}

/** 새 시크릿 — 20바이트(RFC 4226 권장 160비트) */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * otpauth URI — OTP 앱의 "키 입력"·QR 생성기가 읽는 표준 형식.
 * issuer는 브랜드명(site_setting)을 받는다 — 리스킨 몰마다 앱 목록에 제 이름이 보인다(RULE-11).
 */
export function buildOtpauthUri(input: {
  issuer: string;
  accountName: string;
  secretBase32: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.accountName}`);
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
