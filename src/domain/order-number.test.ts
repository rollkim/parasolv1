import { describe, expect, it } from "vitest";

import {
  claimPrefix,
  formatClaimNo,
  formatOrderNo,
  parseDailyNo,
} from "./order-number";

describe("주문번호 형식", () => {
  it("YYYYMMDD-#### 최소 4자리", () => {
    expect(formatOrderNo("20260727", 1)).toBe("20260727-0001");
    expect(formatOrderNo("20260727", 42)).toBe("20260727-0042");
  });
  it("4자리 초과 시 자연 확장(하드 캡 없음)", () => {
    expect(formatOrderNo("20260727", 12345)).toBe("20260727-12345");
  });
});

describe("클레임 번호", () => {
  it("타입별 접두", () => {
    expect(claimPrefix("cancel")).toBe("CN");
    expect(claimPrefix("exchange")).toBe("EX");
    expect(claimPrefix("return")).toBe("RT");
  });
  it("{CN|EX|RT}-YYYYMMDD-####", () => {
    expect(formatClaimNo("return", "20260727", 3)).toBe("RT-20260727-0003");
    expect(formatClaimNo("exchange", "20260727", 100)).toBe("EX-20260727-0100");
  });
});

describe("번호 파싱", () => {
  it("주문번호", () => {
    expect(parseDailyNo("20260727-0042")).toEqual({ ymd: "20260727", seq: 42 });
  });
  it("클레임번호", () => {
    expect(parseDailyNo("RT-20260727-0003")).toEqual({
      prefix: "RT",
      ymd: "20260727",
      seq: 3,
    });
  });
  it("형식 위반은 null", () => {
    expect(parseDailyNo("garbage")).toBeNull();
    expect(parseDailyNo("2026-0001")).toBeNull(); // 날짜 8자리 아님
    expect(parseDailyNo("XX-20260727-0001")).toBeNull(); // 알 수 없는 접두
    expect(parseDailyNo("20260727-1")).toBeNull(); // 일련번호 4자리 미만
  });
  it("round-trip: format→parse", () => {
    const parsed = parseDailyNo(formatOrderNo("20260727", 777));
    expect(parsed).toEqual({ ymd: "20260727", seq: 777 });
  });
});
