/**
 * 이야기(article) 본문 규칙 — 순수 함수만. DB·React를 모른다.
 *
 * 본문은 article.content(text) 한 칸에 경량 규약으로 담고, 여기서 블록 배열로 푼다.
 * HTML을 저장해 그대로 그리지 않는 이유는 상품 설명과 같다 — 관리자 입력이 곧 XSS가 된다.
 * 블록으로 풀어두면 화면은 React 엘리먼트로만 그리므로 주입될 자리가 없다.
 *
 * 규약 (목업 'PaRaSOL 이야기.dc.html'의 4종 블록과 1:1):
 *   ## 소제목            → subheading
 *   > 인용문             → quote
 *   ![캡션](이미지경로)  → image   (캡션이 곧 alt — 빈 캡션은 이미지로 치지 않는다)
 *   그 외 문단           → paragraph
 * 문단은 빈 줄로 나눈다.
 */

export type ArticleBlock =
  | { blockKind: "paragraph"; text: string }
  | { blockKind: "subheading"; text: string }
  | { blockKind: "quote"; text: string }
  | { blockKind: "image"; imagePath: string; caption: string };

/** `![캡션](경로)` — 캡션·경로 모두 비어 있지 않을 때만 이미지로 본다 */
const IMAGE_LINE_PATTERN = /^!\[([^\]]+)\]\(([^)]+)\)$/;

/**
 * 본문 텍스트 → 블록 배열.
 *
 * 규약에 안 맞는 줄은 버리지 않고 문단으로 남긴다 — 운영자가 문법을 틀렸을 때
 * 글이 통째로 사라지는 것보다 그대로 보이는 편이 낫다(원문은 어차피 사람이 쓴 글이다).
 */
export function parseArticleBlocks(content: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  // 빈 줄(공백만 있는 줄 포함)로 문단을 나눈다
  const chunks = content.replace(/\r\n/g, "\n").split(/\n[ \t]*\n+/);

  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim();
    if (chunk === "") continue;

    // 소제목·인용·이미지는 한 줄짜리 블록이라, 문단 안에 섞여 있어도 줄 단위로 본다
    for (const rawLine of chunk.split("\n")) {
      const line = rawLine.trim();
      if (line === "") continue;

      if (line.startsWith("## ")) {
        const text = line.slice(3).trim();
        if (text !== "") {
          blocks.push({ blockKind: "subheading", text });
          continue;
        }
      }

      if (line.startsWith("> ")) {
        const text = line.slice(2).trim();
        if (text !== "") {
          blocks.push({ blockKind: "quote", text });
          continue;
        }
      }

      const imageMatch = IMAGE_LINE_PATTERN.exec(line);
      if (imageMatch) {
        const caption = imageMatch[1].trim();
        const imagePath = imageMatch[2].trim();
        // 캡션이 alt를 겸한다. 둘 중 하나라도 비면 대체텍스트 없는 이미지가 되므로 문단으로 떨군다
        if (caption !== "" && imagePath !== "") {
          blocks.push({ blockKind: "image", imagePath, caption });
          continue;
        }
      }

      // 직전이 문단이면 이어 붙인다 — 한 문단 안의 줄바꿈은 문단을 쪼개지 않는다
      const lastBlock = blocks.at(-1);
      if (lastBlock?.blockKind === "paragraph" && rawChunk.trim() !== line) {
        lastBlock.text = `${lastBlock.text} ${line}`;
      } else {
        blocks.push({ blockKind: "paragraph", text: line });
      }
    }
  }

  return blocks;
}

/**
 * 한국어 성인 평균 묵독 속도 — 분당 500자 기준.
 * 정확한 값이 목적이 아니라 "길이 감"을 주는 표시라 보수적인 중간값을 쓴다.
 */
const CHARS_READ_PER_MINUTE = 500;

/**
 * 읽는 시간(분). 최소 1분.
 *
 * 컬럼으로 저장하지 않는 이유: 본문을 고칠 때마다 같이 고쳐야 하고, 안 고치면 조용히 틀린다.
 * 본문에서 매번 계산하면 어긋날 수가 없다.
 */
export function calcReadMinutes(content: string): number {
  // 마크업 기호는 읽는 분량이 아니다 — 이미지 줄은 캡션만 남기고, 소제목·인용 기호는 뗀다
  const readableText = content
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*(##|>)[ \t]*/gm, "")
    .replace(/\s+/g, "");
  return Math.max(1, Math.ceil(readableText.length / CHARS_READ_PER_MINUTE));
}
