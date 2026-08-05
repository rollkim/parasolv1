import { describe, expect, it } from "vitest";

import { emailInput, mobilePhoneInput, optionalMobilePhoneInput } from "./shared-input";

/**
 * 주문 라우터가 연락처를 **길이만** 검사해서 아무 글자나 통과하던 결함을 막는다.
 * 회원가입은 정규식으로 걸렀는데 주문은 아니었다 — 같은 값에 규칙이 달랐던 사고다.
 */
describe("mobilePhoneInput", () => {
  it("하이픈·공백을 지우고 숫자만 남긴다", () => {
    expect(mobilePhoneInput.parse("010-1234-5678")).toBe("01012345678");
    expect(mobilePhoneInput.parse("010 1234 5678")).toBe("01012345678");
    expect(mobilePhoneInput.parse(" 01012345678 ")).toBe("01012345678");
  });

  it("휴대폰이 아닌 값을 거절한다", () => {
    for (const invalid of ["ㅁㄴㅇㄹ", "abc", "12345", "021234567", "0101234567890", ""]) {
      expect(mobilePhoneInput.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  it("011·016~019 구형 번호도 받는다", () => {
    expect(mobilePhoneInput.parse("011-123-4567")).toBe("0111234567");
    expect(mobilePhoneInput.parse("019-1234-5678")).toBe("01912345678");
  });
});

describe("optionalMobilePhoneInput", () => {
  it("빈 값은 null로 흘려보낸다 — 선택 입력칸에서 쓴다", () => {
    expect(optionalMobilePhoneInput.parse("")).toBeNull();
    expect(optionalMobilePhoneInput.parse("   ")).toBeNull();
  });

  it("값이 있으면 형식을 검사한다", () => {
    expect(optionalMobilePhoneInput.parse("010-1234-5678")).toBe("01012345678");
    expect(optionalMobilePhoneInput.safeParse("ㅁㄴㅇㄹ").success).toBe(false);
  });
});

describe("emailInput", () => {
  it("소문자로 눕힌다 — 대소문자가 섞이면 같은 주소가 중복 가입된다", () => {
    expect(emailInput.parse("Rollkim@Gmail.COM")).toBe("rollkim@gmail.com");
    expect(emailInput.parse("  a@b.com  ")).toBe("a@b.com");
  });

  it("형식이 틀리면 거절한다", () => {
    for (const invalid of ["a@", "@b.com", "abc", ""]) {
      expect(emailInput.safeParse(invalid).success, invalid).toBe(false);
    }
  });
});
