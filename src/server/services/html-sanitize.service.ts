import "server-only";

import sanitizeHtml from "sanitize-html";

/**
 * 관리자가 쓴 서식 있는 본문(상품 설명·이야기)을 안전한 HTML로 씻는다.
 *
 * **저장할 때 씻고, 렌더할 때는 씻지 않는다.** 이유:
 *  - 씻은 것만 DB에 들어가므로 화면은 여러 곳이어도 한 번만 신경 쓰면 된다.
 *    렌더 시점에 씻으면 새 화면을 만들 때마다 잊을 수 있고, 잊은 화면 하나가 곧 구멍이다.
 *  - 렌더는 읽기가 훨씬 잦다 — 매번 파싱할 이유가 없다.
 *
 * 허용 목록 방식이다. 에디터(Tiptap)가 만드는 태그만 남기고 나머지는 전부 버린다.
 * 정상 사용에는 영향이 없고, **API를 직접 두드려 넣은 것만** 걸린다.
 *
 * 왜 필요한가: 관리자가 여럿인 몰에서 살균 없이 dangerouslySetInnerHTML을 쓰면
 * 관리자 한 명이 다른 관리자 세션을 훔치는 경로가 열린다(저장형 XSS).
 * 그 본문은 스토어 화면에도 그대로 나가 고객까지 닿는다.
 */

/** 에디터가 실제로 만드는 태그만. 여기 없는 것은 내용만 남기고 태그는 사라진다 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "img",
];

/**
 * 업로드한 이미지만 허용한다 — 외부 URL을 허용하면 본문에 추적 픽셀을 심을 수 있고,
 * 그 도메인이 죽으면 지난 글이 통째로 깨진다.
 */
const UPLOAD_IMAGE_SRC_PATTERN = /^\/api\/uploads\/[a-z]+\/\d{6}\/[a-f0-9]+\.(jpg|png|webp|avif)$/;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // alt는 반드시 남긴다 — 대체텍스트가 사라지면 접근성 규칙(KWCAG)이 무너진다
    img: ["src", "alt"],
    a: ["href", "target", "rel"],
  },
  // javascript: · data: URL 차단. 링크는 평범한 웹 주소와 메일만
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: [] }, // img는 스킴 없는 내부 경로만(아래 transform이 검사)
  // 스타일 속성을 통째로 막는다 — style로도 화면을 덮어 클릭을 가로챌 수 있다
  allowedStyles: {},
  // 태그가 사라져도 글자는 남긴다. script·style은 내용까지 버린다(코드가 본문에 새지 않게)
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  transformTags: {
    // 외부에서 온 링크는 새 창으로 열고 opener를 끊는다(탭 내빙 방지)
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = attribs.href ?? "";
      if (!href) return { tagName, attribs: {} };
      return {
        tagName,
        attribs: { href, target: "_blank", rel: "noopener noreferrer" },
      };
    },
    img: (tagName, attribs): sanitizeHtml.Tag => {
      const src = attribs.src ?? "";
      // 우리 업로드 경로가 아니면 이미지를 통째로 버린다(빈 src로 남기면 깨진 아이콘만 남는다)
      if (!UPLOAD_IMAGE_SRC_PATTERN.test(src)) {
        return { tagName: "span", attribs: {} };
      }
      return { tagName, attribs: { src, alt: attribs.alt ?? "" } };
    },
  },
};

/**
 * 서식 본문 살균. 비어 있거나 태그만 남는 입력은 빈 문자열로 돌려준다 —
 * "<p></p>"가 저장되면 화면에 빈 줄이 생기고 "설명 없음" 판정도 빗나간다.
 */
export function sanitizeRichText(rawHtml: string | null | undefined): string {
  if (!rawHtml) return "";
  const cleaned = sanitizeHtml(rawHtml, SANITIZE_OPTIONS).trim();
  // 태그를 걷어낸 뒤 글자도 이미지도 없으면 빈 본문이다
  const hasText = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} }).trim().length > 0;
  const hasImage = /<img\b/i.test(cleaned);
  return hasText || hasImage ? cleaned : "";
}

/**
 * 목록·검색·메타태그에 쓸 순수 텍스트. 태그를 전부 걷어낸다.
 * 요약을 만들 때 HTML을 잘라 쓰면 태그가 중간에서 끊겨 화면이 깨진다.
 */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}
