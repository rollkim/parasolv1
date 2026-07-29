import { describe, expect, it } from "vitest";

import { calcReadMinutes, parseArticleBlocks } from "./article";

describe("parseArticleBlocks", () => {
  it("빈 줄로 나눈 덩어리를 문단으로 만든다", () => {
    const blocks = parseArticleBlocks("첫 문단입니다.\n\n둘째 문단입니다.");
    expect(blocks).toEqual([
      { blockKind: "paragraph", text: "첫 문단입니다." },
      { blockKind: "paragraph", text: "둘째 문단입니다." },
    ]);
  });

  it("문단 안의 줄바꿈은 문단을 쪼개지 않는다", () => {
    const blocks = parseArticleBlocks("앞줄\n뒷줄\n\n다음 문단");
    expect(blocks).toEqual([
      { blockKind: "paragraph", text: "앞줄 뒷줄" },
      { blockKind: "paragraph", text: "다음 문단" },
    ]);
  });

  it("소제목·인용·이미지를 각 블록으로 푼다", () => {
    const blocks = parseArticleBlocks(
      [
        "## 같은 맛을 지킨다는 것",
        "",
        "> 서두르면 반죽이 먼저 알아요.",
        "",
        "![갓 구워져 나온 오트 쿠키](/uploads/article/a1-1.jpg)",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { blockKind: "subheading", text: "같은 맛을 지킨다는 것" },
      { blockKind: "quote", text: "서두르면 반죽이 먼저 알아요." },
      {
        blockKind: "image",
        imagePath: "/uploads/article/a1-1.jpg",
        caption: "갓 구워져 나온 오트 쿠키",
      },
    ]);
  });

  it("캡션 없는 이미지는 이미지로 만들지 않는다 — 대체텍스트 없는 이미지를 못 만들게", () => {
    const blocks = parseArticleBlocks("![](/uploads/article/no-alt.jpg)");
    expect(blocks).toEqual([
      { blockKind: "paragraph", text: "![](/uploads/article/no-alt.jpg)" },
    ]);
  });

  it("규약에 안 맞는 줄도 버리지 않고 문단으로 남긴다", () => {
    // 운영자가 문법을 틀렸다고 글이 사라지면 안 된다
    const blocks = parseArticleBlocks("##소제목인줄알았던것\n\n>인용인줄알았던것");
    expect(blocks).toEqual([
      { blockKind: "paragraph", text: "##소제목인줄알았던것" },
      { blockKind: "paragraph", text: ">인용인줄알았던것" },
    ]);
  });

  it("HTML을 넣어도 문단 텍스트로만 남는다 — 화면은 이 값을 텍스트로 그린다", () => {
    const blocks = parseArticleBlocks('<script>alert(1)</script>');
    expect(blocks).toEqual([
      { blockKind: "paragraph", text: "<script>alert(1)</script>" },
    ]);
  });

  it("빈 본문은 빈 배열", () => {
    expect(parseArticleBlocks("")).toEqual([]);
    expect(parseArticleBlocks("\n\n  \n")).toEqual([]);
  });
});

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

  it("공백과 마크업 기호는 분량에서 뺀다", () => {
    // 경로는 읽는 분량이 아니다 — 캡션만 남는다
    const withImage = calcReadMinutes(`![캡션](${"/very/long/path".repeat(50)})`);
    expect(withImage).toBe(1);
  });
});
