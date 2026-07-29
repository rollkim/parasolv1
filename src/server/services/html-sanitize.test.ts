import { describe, expect, it } from "vitest";

import { richTextToPlainText, sanitizeRichText } from "./html-sanitize.service";

describe("sanitizeRichText — 에디터가 만드는 것은 통과", () => {
  it("문단·강조·목록·소제목·인용을 남긴다", () => {
    const html =
      "<p>안녕하세요 <strong>굵게</strong> <em>기울임</em> <u>밑줄</u></p>" +
      "<h2>소제목</h2><h3>작은 제목</h3>" +
      "<ul><li>첫째</li><li>둘째</li></ul>" +
      "<ol><li>하나</li></ol>" +
      "<blockquote>인용</blockquote>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  it("업로드한 이미지는 src·alt를 유지한다", () => {
    const html = '<img src="/api/uploads/products/202607/abc123.jpg" alt="통밀 쿠키" />';
    const cleaned = sanitizeRichText(html);
    expect(cleaned).toContain('src="/api/uploads/products/202607/abc123.jpg"');
    expect(cleaned).toContain('alt="통밀 쿠키"');
  });
});

describe("sanitizeRichText — 공격 입력 차단", () => {
  it("script 태그는 내용까지 사라진다", () => {
    const cleaned = sanitizeRichText('<p>안녕</p><script>alert(document.cookie)</script>');
    expect(cleaned).not.toContain("script");
    expect(cleaned).not.toContain("alert");
    expect(cleaned).toContain("안녕");
  });

  it("on* 이벤트 속성을 버린다", () => {
    const cleaned = sanitizeRichText('<p onclick="steal()">누르지 마세요</p>');
    expect(cleaned).not.toContain("onclick");
    expect(cleaned).toContain("누르지 마세요");
  });

  it("이미지 onerror도 버린다 — 가장 흔한 저장형 XSS 경로다", () => {
    const cleaned = sanitizeRichText(
      '<img src="/api/uploads/products/202607/abc123.jpg" onerror="steal()" />',
    );
    expect(cleaned).not.toContain("onerror");
  });

  it("javascript: 링크를 버린다", () => {
    const cleaned = sanitizeRichText('<a href="javascript:alert(1)">눌러보세요</a>');
    expect(cleaned).not.toContain("javascript:");
    expect(cleaned).toContain("눌러보세요");
  });

  it("data: URL 이미지를 버린다", () => {
    const cleaned = sanitizeRichText('<img src="data:text/html;base64,PHNjcmlwdD4=" />');
    expect(cleaned).not.toContain("data:");
  });

  it("외부 이미지를 버린다 — 추적 픽셀·죽는 링크를 막는다", () => {
    const cleaned = sanitizeRichText('<img src="https://evil.example.com/pixel.gif" alt="x" />');
    expect(cleaned).not.toContain("evil.example.com");
  });

  it("업로드 경로처럼 보이는 위조 경로도 버린다", () => {
    const cleaned = sanitizeRichText(
      '<img src="/api/uploads/../../etc/passwd" alt="x" />',
    );
    expect(cleaned).not.toContain("passwd");
  });

  it("style 속성을 버린다 — 화면을 덮어 클릭을 가로챌 수 있다", () => {
    const cleaned = sanitizeRichText(
      '<p style="position:fixed;inset:0;z-index:9999">덮개</p>',
    );
    expect(cleaned).not.toContain("style");
    expect(cleaned).toContain("덮개");
  });

  it("iframe·object를 버린다", () => {
    const cleaned = sanitizeRichText('<iframe src="https://evil.example.com"></iframe><p>본문</p>');
    expect(cleaned).not.toContain("iframe");
    expect(cleaned).toContain("본문");
  });

  it("허용 태그 밖이어도 글자는 남긴다 — 운영자 글이 통째로 사라지면 안 된다", () => {
    const cleaned = sanitizeRichText("<div><span>남아야 하는 글</span></div>");
    expect(cleaned).toContain("남아야 하는 글");
  });
});

describe("sanitizeRichText — 빈 본문", () => {
  it("빈 입력은 빈 문자열", () => {
    expect(sanitizeRichText("")).toBe("");
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
  });

  it("태그만 남는 입력도 빈 문자열 — '<p></p>'가 저장되면 빈 줄이 생긴다", () => {
    expect(sanitizeRichText("<p></p>")).toBe("");
    expect(sanitizeRichText("<p><br></p>")).toBe("");
    expect(sanitizeRichText("<script>alert(1)</script>")).toBe("");
  });

  it("이미지만 있어도 빈 본문이 아니다", () => {
    const cleaned = sanitizeRichText(
      '<p><img src="/api/uploads/products/202607/abc123.jpg" alt="사진" /></p>',
    );
    expect(cleaned).not.toBe("");
  });
});

describe("richTextToPlainText", () => {
  it("태그를 걷어내고 공백을 정리한다", () => {
    expect(richTextToPlainText("<p>첫 줄</p>\n<p>둘째  줄</p>")).toBe("첫 줄 둘째 줄");
  });

  it("빈 입력은 빈 문자열", () => {
    expect(richTextToPlainText(null)).toBe("");
  });
});
