import { describe, expect, it } from "vitest";

import {
  resolveCategoryPlacement,
  type StoreNavCategory,
} from "./category.service";

/**
 * 칩의 역할은 "현재 위치에서 한 단계 더 좁히기"다 — 상단 GNB가 이미 대분류를 담당하므로
 * 목록이 대분류를 한 번 더 그리면 같은 층이 두 번 나온다(사용자 지적, 2026-07-28).
 */
const NAV: StoreNavCategory[] = [
  {
    slug: "bakery",
    name: "쿠키·베이커리",
    children: [
      { slug: "oat-cookie", name: "오트·통밀 쿠키" },
      { slug: "choco-cookie", name: "초코·버터 쿠키" },
    ],
  },
  {
    slug: "coffee",
    name: "커피·차",
    children: [{ slug: "coffee-bean", name: "핸드드립 원두" }],
  },
  // 자식 없는 대분류 — 더 좁힐 것이 없다
  { slug: "gift", name: "선물세트", children: [] },
];

describe("카테고리 계층 위치", () => {
  it("전체 보기: 대분류가 칩으로 온다(진입점) · '전체'는 미필터", () => {
    const placement = resolveCategoryPlacement(NAV, null);
    expect(placement.root).toBeNull();
    expect(placement.child).toBeNull();
    expect(placement.chips.map((chip) => chip.slug)).toEqual(["bakery", "coffee", "gift"]);
    expect(placement.chipsAllSlug).toBeNull();
  });

  it("대분류 선택: 칩이 그 대분류의 중분류로 바뀐다 — 대분류 중복 렌더 없음", () => {
    const placement = resolveCategoryPlacement(NAV, "bakery");
    expect(placement.root).toEqual({ slug: "bakery", name: "쿠키·베이커리" });
    expect(placement.child).toBeNull();
    expect(placement.chips.map((chip) => chip.slug)).toEqual(["oat-cookie", "choco-cookie"]);
    // 이 문맥의 '전체'는 '쿠키·베이커리 전체'다
    expect(placement.chipsAllSlug).toBe("bakery");
  });

  it("중분류 선택: 형제 중분류가 칩으로 유지되고 부모를 알 수 있다", () => {
    const placement = resolveCategoryPlacement(NAV, "choco-cookie");
    expect(placement.root).toEqual({ slug: "bakery", name: "쿠키·베이커리" });
    expect(placement.child).toEqual({ slug: "choco-cookie", name: "초코·버터 쿠키" });
    expect(placement.chips.map((chip) => chip.slug)).toEqual(["oat-cookie", "choco-cookie"]);
    expect(placement.chipsAllSlug).toBe("bakery");
  });

  it("중분류로 진입해도 해당 칩이 활성 대상이 된다(이전에는 아무 칩도 안 잡혔다)", () => {
    const placement = resolveCategoryPlacement(NAV, "oat-cookie");
    expect(placement.chips.some((chip) => chip.slug === "oat-cookie")).toBe(true);
  });

  it("자식 없는 대분류: 칩 줄을 비운다 — 대분류로 폴백하면 그 줄의 의미가 흔들린다", () => {
    const placement = resolveCategoryPlacement(NAV, "gift");
    expect(placement.root).toEqual({ slug: "gift", name: "선물세트" });
    // 상품은 이미 대분류로 걸러져 나온다. 단지 더 좁힐 수단이 없을 뿐이다
    expect(placement.chips).toEqual([]);
    expect(placement.chipsAllSlug).toBeNull();
  });

  it("알 수 없는 slug: unknown으로 표시하고 대분류 진입점을 준다", () => {
    const placement = resolveCategoryPlacement(NAV, "no-such-category");
    expect(placement.unknown).toBe(true);
    expect(placement.root).toBeNull();
    expect(placement.chips.map((chip) => chip.slug)).toEqual(["bakery", "coffee", "gift"]);
  });

  it("빈 카테고리 트리에서도 터지지 않는다", () => {
    expect(resolveCategoryPlacement([], null).chips).toEqual([]);
    expect(resolveCategoryPlacement([], "bakery").unknown).toBe(true);
  });
});
