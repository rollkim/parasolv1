import { describe, expect, it } from "vitest";

import { bankNameByCode, isValidBankCode, TOSS_BANK_CODES } from "./bank-code";

describe("bank-code", () => {
  it("목록의 코드는 전부 유효하다고 판정한다", () => {
    for (const bank of TOSS_BANK_CODES) {
      expect(isValidBankCode(bank.code)).toBe(true);
    }
  });

  it("목록에 없는 코드·빈 값은 무효로 판정한다", () => {
    expect(isValidBankCode("")).toBe(false);
    expect(isValidBankCode("99")).toBe(false);
    expect(isValidBankCode("abc")).toBe(false);
  });

  it("코드로 은행명을 찾는다 — 없으면 null", () => {
    expect(bankNameByCode("88")).toBe("신한은행");
    expect(bankNameByCode("99")).toBeNull();
  });

  it("코드 중복이 없다 — 중복이 있으면 select 옵션이 두 번 뜬다", () => {
    const codes = TOSS_BANK_CODES.map((bank) => bank.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
