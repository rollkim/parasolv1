import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotpSecret,
  totpCodeAtStep,
  totpStep,
  verifyTotpCode,
} from "./totp";

/**
 * RFC 6238 부록 B 테스트 벡터(SHA-1) — 시크릿 "12345678901234567890"(ASCII).
 * RFC는 8자리를 싣지만 6자리는 같은 계산의 아래 6자리다.
 */
const RFC_SECRET_BASE32 = base32Encode(
  Uint8Array.from(Buffer.from("12345678901234567890", "ascii")),
);

const RFC_VECTORS: { timeSeconds: number; code6: string }[] = [
  { timeSeconds: 59, code6: "287082" },
  { timeSeconds: 1_111_111_109, code6: "081804" },
  { timeSeconds: 1_111_111_111, code6: "050471" },
  { timeSeconds: 1_234_567_890, code6: "005924" },
  { timeSeconds: 2_000_000_000, code6: "279037" },
  { timeSeconds: 20_000_000_000, code6: "353130" },
];

describe("TOTP — RFC 6238 표준 벡터", () => {
  it.each(RFC_VECTORS)("t=$timeSeconds → $code6", ({ timeSeconds, code6 }) => {
    const step = totpStep(timeSeconds * 1000);
    expect(totpCodeAtStep(RFC_SECRET_BASE32, step)).toBe(code6);
  });

  it("verifyTotpCode가 벡터 코드를 그 시각에 승인하고 일치 스텝을 준다", () => {
    for (const vector of RFC_VECTORS) {
      const result = verifyTotpCode({
        secretBase32: RFC_SECRET_BASE32,
        code: vector.code6,
        nowMs: vector.timeSeconds * 1000,
      });
      expect(result?.matchedStep).toBe(totpStep(vector.timeSeconds * 1000));
    }
  });
});

describe("verifyTotpCode — 허용 범위", () => {
  it("±1창(30초 어긋난 시계)은 통과한다", () => {
    const nowMs = 1_111_111_109 * 1000;
    // 한 창 전 코드
    const previousCode = totpCodeAtStep(RFC_SECRET_BASE32, totpStep(nowMs) - 1);
    expect(
      verifyTotpCode({ secretBase32: RFC_SECRET_BASE32, code: previousCode, nowMs }),
    ).not.toBeNull();
  });

  it("두 창(1분) 넘게 어긋나면 거절한다", () => {
    const nowMs = 1_111_111_109 * 1000;
    const staleCode = totpCodeAtStep(RFC_SECRET_BASE32, totpStep(nowMs) - 2);
    expect(
      verifyTotpCode({ secretBase32: RFC_SECRET_BASE32, code: staleCode, nowMs }),
    ).toBeNull();
  });

  it("6자리 숫자 형식이 아니면 계산 없이 거절한다", () => {
    const nowMs = 59_000;
    for (const bad of ["", "12345", "1234567", "abc123", "12 34 5"]) {
      expect(
        verifyTotpCode({ secretBase32: RFC_SECRET_BASE32, code: bad, nowMs }),
      ).toBeNull();
    }
  });

  it("공백이 섞인 올바른 코드는 받아준다 — 앱에서 '287 082'처럼 보여 그대로 옮겨 적는다", () => {
    expect(
      verifyTotpCode({ secretBase32: RFC_SECRET_BASE32, code: "287 082", nowMs: 59_000 }),
    ).not.toBeNull();
  });
});

describe("base32", () => {
  it("왕복이 원본을 보존한다", () => {
    for (const length of [1, 5, 10, 20, 33]) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
  });

  it("소문자·공백·패딩을 관대하게 받는다 — 손으로 옮겨 적는 값이다", () => {
    const secret = generateTotpSecret();
    const sloppy = secret.toLowerCase().replace(/(.{4})/g, "$1 ") + "==";
    expect(base32Decode(sloppy)).toEqual(base32Decode(secret));
  });
});

describe("generateTotpSecret · otpauth URI", () => {
  it("시크릿은 160비트(base32 32자)다", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("URI에 표준 파라미터가 전부 실린다", () => {
    const uri = buildOtpauthUri({
      issuer: "파라솔",
      accountName: "admin",
      secretBase32: "ABCDEFGH",
    });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=ABCDEFGH");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    expect(uri).toContain(encodeURIComponent("파라솔"));
  });
});
