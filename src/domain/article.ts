/**
 * 이야기(article) 본문 규칙 — 순수 함수만. DB·React를 모른다.
 *
 * 본문은 서식 에디터(Tiptap)가 만든 HTML을 저장한다. 저장 시 서버가 허용 목록으로 씻으므로
 * (html-sanitize.service) 화면은 그대로 그린다 — 상품 설명과 같은 방식이다.
 *
 * 예전에는 `## 소제목` 같은 경량 규약을 파싱했는데, 관리자 작성 화면이 생기면서
 * 두 벌(상품=HTML, 이야기=규약)을 유지할 이유가 사라졌다. 규약이 남아 있으면 에디터가
 * 만든 `<h2>`가 글자 그대로 보이고, 운영자는 왜 안 되는지 알 수 없다.
 */

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
 *
 * @param plainText 태그를 걷어낸 순수 텍스트(서비스가 richTextToPlainText로 만들어 넘긴다).
 *   HTML을 그대로 세면 태그·경로 문자까지 분량에 들어가 "20분 분량"이 된다.
 */
export function calcReadMinutes(plainText: string): number {
  const readableLength = plainText.replace(/\s+/g, "").length;
  return Math.max(1, Math.ceil(readableLength / CHARS_READ_PER_MINUTE));
}
