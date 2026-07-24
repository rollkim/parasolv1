/**
 * 시드 데이터 — 빈 DB를 "쓸 수 있는 상태"로 만드는 초기값.
 *
 * 재판매 시 이 파일이 업체별 교체 대상이다(로직은 index.ts가 담당).
 * 규약: 코드값은 영문 소문자, 한글은 표시명(name)에만 — DB CHECK 제약으로 강제된다.
 */

// =============================================================
// 공통코드 — 관리자가 편집하는 코드셋만 (시스템 상태값은 DB enum)
// =============================================================

type CommonCodeSeed = {
  groupCode: string;
  code: string;
  name: string;
  meta?: Record<string, unknown>;
};

/**
 * 클레임 사유의 meta.fault(귀책)는 배송비 부담 주체를 정한다.
 * 금액은 여기 저장하지 않는다 — site_setting(shipping_policy)의 기본 배송비에서
 * 파생한다(반품=편도 1배, 교환=왕복 2배, 판매자 귀책·취소=0).
 * 배송비를 바꾸면 클레임 비용이 자동으로 따라오게 하기 위함.
 *
 * meta.claimTypes는 해당 사유를 고를 수 있는 클레임 종류다.
 */
export const COMMON_CODES: CommonCodeSeed[] = [
  // ── 택배사
  { groupCode: "carrier", code: "cj", name: "CJ대한통운" },
  { groupCode: "carrier", code: "hanjin", name: "한진택배" },
  { groupCode: "carrier", code: "lotte", name: "롯데택배" },
  { groupCode: "carrier", code: "post", name: "우체국택배" },

  // ── 1:1 문의 유형
  { groupCode: "qna_type", code: "delivery", name: "배송" },
  { groupCode: "qna_type", code: "order_payment", name: "주문/결제" },
  { groupCode: "qna_type", code: "exchange_refund", name: "교환/환불" },
  { groupCode: "qna_type", code: "product", name: "상품" },
  { groupCode: "qna_type", code: "member", name: "회원" },
  { groupCode: "qna_type", code: "etc", name: "기타" },

  // ── FAQ 분류 (문의 유형과 별개 — 고객센터 화면 기준)
  { groupCode: "faq_category", code: "order_payment", name: "주문·결제" },
  { groupCode: "faq_category", code: "delivery", name: "배송" },
  { groupCode: "faq_category", code: "exchange_return", name: "교환·반품" },
  { groupCode: "faq_category", code: "member_benefit", name: "회원·혜택" },
  { groupCode: "faq_category", code: "product", name: "상품" },

  // ── 공지 분류
  { groupCode: "notice_category", code: "general", name: "일반" },
  { groupCode: "notice_category", code: "delivery", name: "배송" },
  { groupCode: "notice_category", code: "event", name: "이벤트" },
  { groupCode: "notice_category", code: "maintenance", name: "점검" },

  // ── 클레임 사유 (귀책 = 배송비 부담 주체)
  {
    groupCode: "claim_reason",
    code: "change_mind",
    name: "단순 변심",
    meta: { fault: "buyer", claimTypes: ["cancel", "return"] },
  },
  {
    groupCode: "claim_reason",
    code: "order_mistake",
    name: "주문 실수",
    meta: { fault: "buyer", claimTypes: ["cancel"] },
  },
  {
    groupCode: "claim_reason",
    code: "faster_elsewhere",
    name: "다른 곳에서 더 빨리 받고 싶어요",
    meta: { fault: "buyer", claimTypes: ["cancel"] },
  },
  {
    groupCode: "claim_reason",
    code: "wrong_option",
    name: "옵션을 잘못 선택함",
    meta: { fault: "buyer", claimTypes: ["exchange"] },
  },
  {
    groupCode: "claim_reason",
    code: "wrong_item",
    name: "다른 상품이 배송됨",
    meta: { fault: "seller", claimTypes: ["return", "exchange"] },
  },
  {
    groupCode: "claim_reason",
    code: "damaged",
    name: "파손·불량",
    meta: { fault: "seller", claimTypes: ["return", "exchange"] },
  },
  {
    groupCode: "claim_reason",
    code: "not_as_described",
    name: "상품 설명과 다름",
    meta: { fault: "seller", claimTypes: ["return", "exchange"] },
  },
  {
    groupCode: "claim_reason",
    code: "delivery_delay",
    name: "배송 지연",
    meta: { fault: "seller", claimTypes: ["cancel", "return"] },
  },
  {
    // 기타는 상담 후 관리자가 귀책을 조정한다. 기본값을 seller(무료)로 두어
    // 사유가 불분명한 상태에서 고객에게 배송비가 청구되지 않게 한다.
    groupCode: "claim_reason",
    code: "etc",
    name: "기타",
    meta: { fault: "seller", claimTypes: ["cancel", "return", "exchange"] },
  },

  // ── 리뷰 만족도 태그
  { groupCode: "review_tag", code: "tasty", name: "맛있어요" },
  { groupCode: "review_tag", code: "fresh", name: "신선해요" },
  { groupCode: "review_tag", code: "well_packed", name: "포장이 꼼꼼해요" },
  { groupCode: "review_tag", code: "fast_delivery", name: "배송이 빨라요" },
  { groupCode: "review_tag", code: "good_for_gift", name: "선물하기 좋아요" },
  { groupCode: "review_tag", code: "good_price", name: "가격이 합리적이에요" },

  // ── 배너 슬롯
  { groupCode: "banner_slot", code: "hero", name: "히어로 배너" },
  { groupCode: "banner_slot", code: "strip", name: "띠배너" },

  // ── 단체구매 유형
  { groupCode: "bulk_type", code: "gift", name: "명절 선물세트", meta: { summary: "설·추석 단체 선물" } },
  { groupCode: "bulk_type", code: "corp", name: "기업/임직원", meta: { summary: "복지·행사 답례품" } },
  { groupCode: "bulk_type", code: "group", name: "단체/기관", meta: { summary: "대량 구매" } },

  // ── 적립금 사유 태그 [2차]
  { groupCode: "point_tag", code: "purchase", name: "구매적립" },
  { groupCode: "point_tag", code: "review", name: "리뷰적립" },
  { groupCode: "point_tag", code: "photo_review", name: "포토리뷰" },
  { groupCode: "point_tag", code: "event", name: "이벤트" },
  { groupCode: "point_tag", code: "manual", name: "수동지급" },
  { groupCode: "point_tag", code: "use", name: "사용" },
  { groupCode: "point_tag", code: "expire", name: "유효기간 만료" },
];

// =============================================================
// 게시판 — 고정 3종
// =============================================================

export const BOARDS = [
  { slug: "notice", name: "공지사항", boardKind: "notice" as const },
  { slug: "faq", name: "자주 묻는 질문", boardKind: "faq" as const },
  { slug: "qna", name: "1:1 문의", boardKind: "qna" as const },
];

// =============================================================
// 카테고리 — 관리자 트리를 정본으로, 스토어 화면에만 있던 그래놀라 보강
// slug는 하이픈만 허용(CHECK ^[a-z0-9-]+$), 전역 유니크라 충돌 없게 구체적으로 짓는다
// =============================================================

type CategorySeed = {
  slug: string;
  name: string;
  isActive?: boolean;
  children?: { slug: string; name: string; isActive?: boolean }[];
};

export const CATEGORIES: CategorySeed[] = [
  {
    slug: "bakery",
    name: "쿠키·베이커리",
    children: [
      { slug: "oat-cookie", name: "오트·통밀 쿠키" },
      { slug: "choco-cookie", name: "초코·버터 쿠키" },
      { slug: "madeleine", name: "마들렌·파운드" },
    ],
  },
  {
    slug: "coffee",
    name: "커피·차",
    children: [
      { slug: "coffee-bean", name: "핸드드립 원두" },
      // 목업에서 비노출 상태 — 카테고리는 만들되 숨김으로 둔다
      { slug: "drip-bag", name: "드립백·티백", isActive: false },
    ],
  },
  {
    slug: "traditional",
    name: "전통과자·건과",
    children: [
      { slug: "dried-fruit", name: "대추칩·곶감" },
      { slug: "hangwa", name: "한과" },
    ],
  },
  { slug: "jam", name: "잼·스프레드" },
  { slug: "granola", name: "그래놀라·시리얼" },
  {
    slug: "gift",
    name: "선물세트",
    children: [
      { slug: "holiday-set", name: "명절 선물세트" },
      // 'return'은 예약어 성격이라 라우팅·ORM 혼동 위험이 있어 souvenir로 둔다
      { slug: "souvenir", name: "답례품" },
    ],
  },
];

// =============================================================
// 회원 등급 [2차] — bonusRate는 0.1% 단위 정수 (10 = 1.0%)
// =============================================================

export const CUSTOMER_GRADES = [
  { code: "basic", name: "일반", bonusRate: 0, sortOrder: 1 },
  { code: "gold", name: "단골", bonusRate: 10, sortOrder: 2 },
  { code: "vip", name: "VIP", bonusRate: 20, sortOrder: 3 },
];

// =============================================================
// 메인 진열 섹션 — 고객에게 보이는 문구를 저장한다(관리자도 같은 값을 편집)
// =============================================================

export const DISPLAY_SECTIONS = [
  { kicker: "CURATED", title: "이달의 파라솔 큐레이션", sectionKind: "manual", sortOrder: 1, isActive: true },
  { kicker: null, title: "방금 들어온 신상품", sectionKind: "new", sortOrder: 2, isActive: true },
  { kicker: null, title: "지금 잘 팔리는", sectionKind: "best", sortOrder: 3, isActive: true },
];

// =============================================================
// 약관 문서
//
// content는 법무 검토가 필요한 실제 약관 본문이 들어갈 자리다.
// 업체가 확정한 문안으로 교체해야 하며, 시드는 구조와 동의 이력 연결만 세운다.
// =============================================================

const PLACEHOLDER_NOTICE =
  "[교체 필요] 업체가 확정한 약관 본문으로 교체하세요. 관리자 > 설정에서 수정할 수 있습니다.";

export const TERMS_DOCUMENTS = [
  {
    code: "terms",
    title: "이용약관",
    version: "1.0",
    isRequired: true,
    content: PLACEHOLDER_NOTICE,
  },
  {
    code: "privacy",
    title: "개인정보 수집·이용 동의",
    version: "1.0",
    isRequired: true,
    content: PLACEHOLDER_NOTICE,
  },
  {
    code: "third_party",
    title: "개인정보 제3자 제공 동의 (배송)",
    version: "1.0",
    isRequired: true,
    content: PLACEHOLDER_NOTICE,
  },
  {
    code: "marketing",
    title: "마케팅 정보 수신 동의",
    version: "1.0",
    isRequired: false,
    content: PLACEHOLDER_NOTICE,
  },
  {
    // 문서 열람 화면은 없지만 동의 이력을 남겨야 해서 문서로 만든다
    // (terms_agreement.terms_document_id가 필수값)
    code: "age",
    title: "만 14세 이상입니다",
    version: "1.0",
    isRequired: true,
    content: "만 14세 미만 아동은 법정대리인의 동의 없이 회원가입 및 주문을 할 수 없습니다.",
  },
  {
    code: "purchase_confirm",
    title: "구매조건 확인 및 결제진행 동의",
    version: "1.0",
    isRequired: true,
    content: "주문 상품의 정보·가격·배송조건을 확인하였으며 결제 진행에 동의합니다.",
  },
  {
    // 동의 대상이 아닌 열람용 정책 문서
    code: "delivery",
    title: "배송·교환·반품 안내",
    version: "1.0",
    isRequired: false,
    content: PLACEHOLDER_NOTICE,
  },
];

// =============================================================
// 사이트 설정 — 업체 교체 1순위 대상
// =============================================================

export const SITE_SETTINGS: { key: string; value: unknown }[] = [
  {
    key: "business_info",
    value: {
      brandName: "PaRaSOL",
      companyName: "파라솔 협동조합",
      ceoName: "홍정성",
      businessNo: "123-45-67890",
      mailOrderNo: "제2026-서울마포-0000호",
      address: "서울특별시 마포구 만리재로 00, 3층",
      privacyOfficer: "김보람",
      hostingProvider: "PaRaSOL Cloud",
      csPhone: "1544-0000",
      csHours: ["평일 10:00–17:00 (점심 12:00–13:00)", "주말·공휴일 휴무"],
      brandTagline:
        "좋은 재료로 정성껏 만든 먹거리를 고르고 담아 전하는 커머스, 파라솔입니다.",
      copyrightNotice:
        "ⓒ 2026 PaRaSOL. 모든 상품은 장애인 보호작업장에서 정성으로 생산됩니다.",
    },
  },
  {
    // 클레임 배송비가 여기서 파생된다 — baseFee를 바꾸면 반품·교환 비용이 함께 바뀐다
    key: "shipping_policy",
    value: { baseFee: 3000, freeThreshold: 30000 },
  },
  {
    // 귀책이 구매자일 때만 부과. 반품=편도(1배), 교환=왕복(2배), 취소=0
    key: "claim_policy",
    value: { returnFeeMultiplier: 1, exchangeFeeMultiplier: 2, cancelFeeMultiplier: 0 },
  },
  {
    // [2차] 적립금 정책 — earnRate도 0.1% 단위 정수(10 = 1.0%)
    key: "point_policy",
    value: {
      earnRate: 10,
      expiryDays: 365,
      signupBonusPoint: 2000,
      reviewBonusPoint: 500,
      photoReviewBonusPoint: 200,
    },
  },
];
