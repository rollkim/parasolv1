import { describe, expect, it } from "vitest";

import { calcReadMinutes } from "./article";

describe("calcReadMinutes", () => {
  it("짧은 글도 최소 1분", () => {
    expect(calcReadMinutes("한 줄.")).toBe(1);
    expect(calcReadMinutes("")).toBe(1);
  });

  it("분당 500자 기준으로 올림한다", () => {
    expect(calcReadMinutes("가".repeat(500))).toBe(1);
    expect(calcReadMinutes("가".repeat(501))).toBe(2);
    expect(calcReadMinutes("가".repeat(1800))).toBe(4);
  });

  it("공백은 분량에서 뺀다 — 줄바꿈이 많다고 오래 걸리지 않는다", () => {
    expect(calcReadMinutes("가 ".repeat(500))).toBe(1);
    expect(calcReadMinutes("가\n\n".repeat(500))).toBe(1);
  });
});
