/**
 * 개발용 샘플 상품 시드 — `npm run db:seed:dev`
 *
 * 기본 시드(npm run db:seed)로 카테고리·진열섹션이 준비된 뒤 실행한다.
 * 빈 상품 테이블 전용 — 상품이 하나라도 있으면 통째로 건너뛴다(부분 중복 방지).
 * 실사진이 없어 product_image는 넣지 않는다 — 화면이 플레이스홀더를 렌더한다.
 */

import "dotenv/config";

import { asc, count, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  article,
  banner,
  board,
  category,
  displaySection,
  displaySectionProduct,
  maker,
  post,
  product,
  productAddon,
  productCategory,
  productOption,
  productOptionValue,
  productVariant,
  variantOptionValue,
} from "@/db/schema";

/** 시드가 만든 행의 감사 컬럼 주체 — "admin:{id}"/"customer:{id}"와 구분되는 규약값 */
const SEED_ACTOR = "system";

// =============================================================
// 생산 공방 — 파라솔 자사 상품은 maker에 두지 않는다(makerId null)
// =============================================================

const MAKERS = [
  { name: "볕든 공방", slug: "byeotdeun" },
  { name: "온기제작소", slug: "ongi" },
  { name: "솔키친", slug: "solkitchen" },
  { name: "느린손 공방", slug: "neurinson" },
  { name: "모아 베이커리", slug: "moa" },
  { name: "한아름 베이커리", slug: "hanareum" },
];

// =============================================================
// 샘플 상품 30종 — 배열 순서 = 등록순
// 이 순서대로 insert해야 id 오름차순 = 등록순이 되어 '신상품' 정렬이 목업과 일치한다
// =============================================================

type DevVariantSeed = {
  price: number;
  compareAtPrice?: number;
  stock: number;
  /** 옵션 상품만 — 옵션 값 라벨 조합. 값 라벨은 상품 안에서 유일해야 한다 */
  optionValues?: string[];
};

type DevProductSeed = {
  name: string;
  slug: string;
  /** 복수 매핑 가능 (예: 선물세트 + 대추칩·곶감) */
  categorySlugs: string[];
  /** null = 파라솔 자사 상품 */
  makerSlug: string | null;
  summary?: string;
  badgeLabel?: string;
  salesCount: number;
  options?: { name: string; values: string[] }[];
  variants: DevVariantSeed[];
  addons?: { name: string; price: number; stock: number }[];
};

const PRODUCTS: DevProductSeed[] = [
  { name: "볶은 옥수수차 30T", slug: "roasted-corn-tea", categorySlugs: ["coffee"], makerSlug: "neurinson", salesCount: 60, variants: [{ price: 7500, stock: 30 }] },
  { name: "디카페인 원두 200g", slug: "decaf-beans", categorySlugs: ["coffee-bean"], makerSlug: "ongi", salesCount: 70, variants: [{ price: 15000, stock: 30 }] },
  { name: "오트밀 그래놀라 400g", slug: "oatmeal-granola", categorySlugs: ["granola"], makerSlug: "solkitchen", salesCount: 90, variants: [{ price: 11000, stock: 30 }] },
  { name: "사과 시나몬잼 250g", slug: "apple-cinnamon-jam", categorySlugs: ["jam"], makerSlug: "byeotdeun", salesCount: 80, variants: [{ price: 8500, stock: 30 }] },
  { name: "블루베리잼 250g", slug: "blueberry-jam", categorySlugs: ["jam"], makerSlug: "neurinson", salesCount: 110, variants: [{ price: 9500, stock: 30 }] },
  { name: "레몬 글레이즈 쿠키", slug: "lemon-glaze-cookie", categorySlugs: ["bakery"], makerSlug: "solkitchen", salesCount: 90, variants: [{ price: 9800, stock: 30 }] },
  { name: "수제 카스텔라", slug: "handmade-castella", categorySlugs: ["madeleine"], makerSlug: "ongi", salesCount: 200, variants: [{ price: 9900, compareAtPrice: 11000, stock: 30 }] },
  { name: "다크초코칩 쿠키 (10개입)", slug: "dark-chocochip-cookie", categorySlugs: ["choco-cookie"], makerSlug: "moa", salesCount: 260, variants: [{ price: 10900, compareAtPrice: 12900, stock: 30 }] },
  // 품절 상태 검증용 — 재고 0으로 노출한다(색이 아닌 텍스트로 품절 표시)
  { name: "얼그레이 파운드케이크", slug: "earlgrey-poundcake", categorySlugs: ["madeleine"], makerSlug: "moa", salesCount: 120, variants: [{ price: 13500, stock: 0 }] },
  { name: "소금 카라멜 쿠키", slug: "salted-caramel-cookie", categorySlugs: ["choco-cookie"], makerSlug: "neurinson", salesCount: 130, variants: [{ price: 11500, stock: 30 }] },
  { name: "헤이즐넛 피낭시에 (8개입)", slug: "hazelnut-financier", categorySlugs: ["madeleine"], makerSlug: "byeotdeun", salesCount: 150, variants: [{ price: 12800, stock: 30 }] },
  {
    // 유일한 옵션 상품 — 옵션 선택·조합 품절·추가상품 UI 검증용
    name: "통밀 오트 쿠키 세트",
    slug: "oat-cookie-set",
    categorySlugs: ["oat-cookie"],
    makerSlug: "byeotdeun",
    summary: "국내산 통밀과 압착 귀리를 그대로 반죽해 낮은 온도에서 오래 구운 쿠키",
    salesCount: 320,
    options: [
      { name: "구성", values: ["12개입", "24개입", "36개입"] },
      { name: "포장", values: ["기본 포장", "선물 포장"] },
    ],
    variants: [
      { price: 11700, compareAtPrice: 13800, stock: 20, optionValues: ["12개입", "기본 포장"] },
      { price: 13700, compareAtPrice: 15800, stock: 8, optionValues: ["12개입", "선물 포장"] },
      { price: 20700, compareAtPrice: 22800, stock: 2, optionValues: ["24개입", "기본 포장"] },
      { price: 22700, compareAtPrice: 24800, stock: 6, optionValues: ["24개입", "선물 포장"] },
      { price: 28700, compareAtPrice: 30800, stock: 5, optionValues: ["36개입", "기본 포장"] },
      // 조합 단위 품절 검증용
      { price: 30700, compareAtPrice: 32800, stock: 0, optionValues: ["36개입", "선물 포장"] },
    ],
    addons: [
      { name: "보냉 보틀백", price: 3000, stock: 50 },
      { name: "손글씨 메시지 카드", price: 1000, stock: 50 },
      { name: "리본 포장 업그레이드", price: 2000, stock: 50 },
    ],
  },
  { name: "크랜베리 그래놀라 400g", slug: "cranberry-granola", categorySlugs: ["granola"], makerSlug: "solkitchen", salesCount: 240, variants: [{ price: 12000, stock: 30 }] },
  { name: "견과 허니스프레드 200g", slug: "nut-honey-spread", categorySlugs: ["jam"], makerSlug: "solkitchen", salesCount: 100, variants: [{ price: 12000, stock: 30 }] },
  { name: "핸드드립 블렌드 원두 200g", slug: "handdrip-blend-beans", categorySlugs: ["coffee-bean"], makerSlug: "ongi", salesCount: 300, variants: [{ price: 14500, stock: 30 }] },
  { name: "드립백 커피 10개입", slug: "dripbag-coffee", categorySlugs: ["coffee"], makerSlug: "ongi", salesCount: 210, variants: [{ price: 13000, compareAtPrice: 15000, stock: 30 }] },
  { name: "흑임자 약과", slug: "black-sesame-yakgwa", categorySlugs: ["hangwa"], makerSlug: "ongi", salesCount: 190, variants: [{ price: 10500, stock: 30 }] },
  { name: "유기농 현미 뻥튀기", slug: "organic-brownrice-ppeong", categorySlugs: ["traditional"], makerSlug: "solkitchen", salesCount: 100, variants: [{ price: 6500, stock: 30 }] },
  { name: "오미자 다식 세트", slug: "omija-dasik-set", categorySlugs: ["hangwa"], makerSlug: "byeotdeun", salesCount: 80, variants: [{ price: 13800, stock: 0 }] },
  // 카테고리 복수 매핑 검증용 — 선물세트와 대추칩·곶감 양쪽에 노출
  { name: "대추칩 & 곶감 세트", slug: "date-chip-dried-persimmon-set", categorySlugs: ["gift", "dried-fruit"], makerSlug: "neurinson", salesCount: 170, variants: [{ price: 16800, compareAtPrice: 19800, stock: 30 }] },
  { name: "차·과자 선물세트", slug: "tea-snack-giftset", categorySlugs: ["holiday-set"], makerSlug: "ongi", salesCount: 110, variants: [{ price: 28000, stock: 30 }] },
  { name: "곡물 쌀강정 3종", slug: "grain-ricecake-gangjeong", categorySlugs: ["hangwa"], makerSlug: "moa", badgeLabel: "NEW", salesCount: 150, variants: [{ price: 9900, stock: 30 }] },
  { name: "통곡물 넛 그래놀라 500g", slug: "wholegrain-nut-granola", categorySlugs: ["granola"], makerSlug: "byeotdeun", badgeLabel: "NEW", salesCount: 130, variants: [{ price: 14000, stock: 30 }] },
  { name: "통밀 스콘 4종", slug: "wholewheat-scone-set", categorySlugs: ["bakery"], makerSlug: "solkitchen", badgeLabel: "NEW", salesCount: 95, variants: [{ price: 12500, stock: 30 }] },
  { name: "흑임자 쿠키 (10개입)", slug: "black-sesame-cookie", categorySlugs: ["oat-cookie"], makerSlug: "ongi", badgeLabel: "NEW", salesCount: 110, variants: [{ price: 10200, stock: 30 }] },
  { name: "수제 딸기잼 250g", slug: "strawberry-jam", categorySlugs: ["jam"], makerSlug: "neurinson", badgeLabel: "NEW", salesCount: 160, variants: [{ price: 8900, stock: 30 }] },
  { name: "브라운버터 쇼트브레드", slug: "brownbutter-shortbread", categorySlugs: ["choco-cookie"], makerSlug: "hanareum", badgeLabel: "NEW", salesCount: 140, variants: [{ price: 9500, stock: 30 }] },
  { name: "레몬 마들렌 (8개입)", slug: "lemon-madeleine", categorySlugs: ["madeleine"], makerSlug: "hanareum", badgeLabel: "NEW", salesCount: 180, variants: [{ price: 11200, stock: 30 }] },
  // 자사 상품 — makerId null 케이스 검증용
  { name: "파라솔 베스트 선물세트", slug: "parasol-best-giftset", categorySlugs: ["holiday-set"], makerSlug: null, badgeLabel: "NEW", salesCount: 140, variants: [{ price: 32000, stock: 30 }] },
  { name: "견과 정과 선물세트", slug: "nut-jeonggwa-giftset", categorySlugs: ["gift"], makerSlug: "byeotdeun", salesCount: 220, variants: [{ price: 24000, stock: 0 }] },
];

/** 메인 큐레이션(manual 섹션) 진열 순서 */
const CURATION_SLUGS = [
  "oat-cookie-set",
  "date-chip-dried-persimmon-set",
  "nut-jeonggwa-giftset",
  "cranberry-granola",
];

// =============================================================
// 샘플 배너 — 메인.dc.html 히어로 3장(L541-543) + 띠배너(L309-320)
// 실사진이 없어 imagePath는 null — 히어로가 플레이스홀더를 렌더한다.
// 띠배너는 이미지 대신 토큰 톤(accent) 배경 — 스키마 v0.5 toneCode의 사용처.
// =============================================================

const SAMPLE_BANNERS = [
  {
    slot: "hero",
    kicker: "이달의 큐레이션 · ~7/31",
    title: "정성을 굽는\n작은 작업장에서",
    subtitle: "매일 손으로 반죽하고 구운 것들. 파라솔이 하나씩 맛보고 골라 담았습니다.",
    ctaLabel: "베스트 쿠키 보기",
    linkUrl: "/products?sort=popular",
  },
  {
    slot: "hero",
    kicker: "선물 시즌",
    title: "명절 선물,\n마음까지 포장했습니다",
    subtitle: "단체·기업 선물 문의 환영. 정성스러운 포장으로 안전하게 보내드려요.",
    ctaLabel: "선물세트 둘러보기",
    linkUrl: "/products?category=gift",
  },
  {
    slot: "hero",
    kicker: "파라솔 이야기",
    title: "느리지만\n정직한 속도로",
    subtitle: "각자의 속도로 일하는 사람들이 만든 건강한 먹거리를 소개합니다.",
    ctaLabel: "만든 사람들",
    // 브랜드 스토리 라우트는 2차(이야기) — 그때까지 404 빈 상태로 안내된다
    linkUrl: "/story",
  },
  {
    slot: "strip",
    kicker: null,
    title: "명절 선물세트 · 단체·기업 구매 문의 환영",
    subtitle: "10개 이상 구매 시 맞춤 포장과 견적을 도와드려요.",
    ctaLabel: "문의하기 →",
    toneCode: "accent",
    // 단체구매문의 라우트는 1차 후반 — 그때까지 404 빈 상태로 안내된다
    linkUrl: "/bulk-inquiry",
  },
] as const;

/** 배너는 상품과 별개 가드 — 상품이 이미 있어도 배너만 새로 넣을 수 있다 */
async function seedSampleBanners() {
  const [{ bannerCount }] = await db.select({ bannerCount: count() }).from(banner);
  if (bannerCount > 0) {
    console.log("  이미 배너가 있습니다 — 배너 시드 건너뜀");
    return;
  }

  await db.insert(banner).values(
    SAMPLE_BANNERS.map((bannerSeed, index) => ({
      slot: bannerSeed.slot,
      kicker: bannerSeed.kicker,
      title: bannerSeed.title,
      subtitle: bannerSeed.subtitle,
      ctaLabel: bannerSeed.ctaLabel,
      toneCode: "toneCode" in bannerSeed ? bannerSeed.toneCode : null,
      linkUrl: bannerSeed.linkUrl,
      sortOrder: index + 1,
      createdBy: SEED_ACTOR,
    })),
  );
  console.log(`  배너 ${SAMPLE_BANNERS.length}건 (히어로 3 · 띠배너 1)`);
}

// =============================================================
// 샘플 게시글 — 공지FAQ.dc.html의 NOTICES·FAQS 데이터 발췌
// categoryCode는 common_code(notice_category·faq_category)의 영문 code(기본 시드가 생성)
// =============================================================

/** 오래된 글부터 넣는다 — id 오름차순 = 등록순이 되어 최신순 정렬이 목업 날짜 순서와 일치한다 */
const SAMPLE_NOTICES = [
  {
    categoryCode: "general",
    title: "개인정보처리방침 개정 안내",
    content: "개인정보처리방침이 일부 개정되어 안내드립니다.\n\n시행일: 2026년 7월 1일",
    isPinned: false,
  },
  {
    categoryCode: "maintenance",
    title: "시스템 정기 점검 안내 (7/12 02:00~04:00)",
    content:
      "서비스 안정화를 위한 정기 점검이 진행됩니다.\n\n점검 시간 동안 주문 및 결제가 일시 중단됩니다.",
    isPinned: false,
  },
  {
    categoryCode: "event",
    title: "PaRaSOL 정식 오픈 안내 및 첫 구매 적립 이벤트",
    content:
      "좋은 제품을 만드는 보호작업장의 먹거리를 소개하는 PaRaSOL이 정식 오픈했습니다.\n\n첫 구매 고객에게는 3,000원 적립금을 드립니다. 자세한 내용은 이벤트 페이지를 참고해 주세요.",
    isPinned: false,
  },
  {
    // 상단 고정 검증용 — 목업도 이 글을 고정으로 노출한다
    categoryCode: "delivery",
    title: "여름철 신선식품 배송 지연 안내 (7/21~7/25)",
    content:
      "폭염으로 인해 일부 지역의 신선·냉장 상품 배송이 하루 정도 지연될 수 있습니다.\n\n보냉 포장을 강화하여 상품 품질에는 문제가 없도록 준비하고 있습니다. 너른 양해 부탁드립니다.\n\n문의사항은 고객센터 또는 1:1 문의로 남겨 주세요.",
    isPinned: true,
  },
];

/** faq_category 5종을 모두 덮도록 분산(주문·결제만 2건) */
const SAMPLE_FAQS = [
  {
    categoryCode: "delivery",
    question: "배송은 얼마나 걸리나요?",
    answer:
      "평일 오후 2시 이전 결제 건은 당일 출고되며, 보통 1~2일 내 도착합니다. 신선·냉장 상품은 지역과 날씨에 따라 하루 정도 더 소요될 수 있어요.",
  },
  {
    categoryCode: "order_payment",
    question: "비회원으로도 주문할 수 있나요?",
    answer:
      "네, 회원가입 없이 비회원 주문이 가능합니다. 주문 시 입력한 주문번호와 연락처로 언제든 주문조회를 하실 수 있어요.",
  },
  {
    categoryCode: "exchange_return",
    question: "단순 변심으로 교환·환불이 되나요?",
    answer:
      "식품 특성상 단순 변심에 의한 교환·환불은 제한됩니다. 다만 상품 하자나 배송 중 파손은 수령 후 7일 이내 사진과 함께 문의 주시면 신속히 처리해 드립니다.",
  },
  {
    categoryCode: "order_payment",
    question: "어떤 결제 수단을 사용할 수 있나요?",
    answer:
      "신용·체크카드, 계좌이체, 토스페이, 카카오페이를 지원합니다. 결제는 토스페이먼츠를 통해 안전하게 처리됩니다.",
  },
  {
    categoryCode: "member_benefit",
    question: "적립금은 어떻게 사용하나요?",
    answer:
      "적립금은 1원 단위로 결제 시 사용할 수 있으며, 리뷰 작성·첫 구매 등으로 적립됩니다. 마이페이지에서 잔액과 내역을 확인하실 수 있어요.",
  },
  {
    categoryCode: "product",
    question: "선물 포장이 가능한가요?",
    answer:
      "대부분의 상품에서 선물 포장 옵션을 제공합니다. 상품 상세에서 포장 옵션을 선택하고, 손글씨 메시지 카드를 추가상품으로 함께 담으실 수 있어요.",
  },
];

/** 게시글도 상품과 별개 가드 — 공지·FAQ 게시판이 비어 있을 때만 넣는다 */
async function seedSampleBoardPosts() {
  const boardRows = await db
    .select({ id: board.id, slug: board.slug })
    .from(board)
    .where(inArray(board.slug, ["notice", "faq"]));
  const boardIdBySlug = new Map(boardRows.map((row) => [row.slug, row.id]));
  const noticeBoardId = boardIdBySlug.get("notice");
  const faqBoardId = boardIdBySlug.get("faq");
  if (noticeBoardId === undefined || faqBoardId === undefined) {
    throw new Error(
      "게시판(notice/faq)이 없습니다 — 기본 시드(npm run db:seed)를 먼저 실행하세요",
    );
  }

  // qna 글(사용자 생성)은 세지 않는다 — 문의가 있어도 공지·FAQ 시드는 들어가야 한다
  const [{ boardPostCount }] = await db
    .select({ boardPostCount: count() })
    .from(post)
    .where(inArray(post.boardId, [noticeBoardId, faqBoardId]));
  if (boardPostCount > 0) {
    console.log("  이미 공지·FAQ 게시글이 있습니다 — 게시글 시드 건너뜀");
    return;
  }

  await db.insert(post).values([
    ...SAMPLE_NOTICES.map((noticeSeed) => ({
      boardId: noticeBoardId,
      categoryCode: noticeSeed.categoryCode,
      authorType: "admin" as const,
      title: noticeSeed.title,
      content: noticeSeed.content,
      isPinned: noticeSeed.isPinned,
    })),
    ...SAMPLE_FAQS.map((faqSeed) => ({
      boardId: faqBoardId,
      categoryCode: faqSeed.categoryCode,
      authorType: "admin" as const,
      title: faqSeed.question,
      content: faqSeed.answer,
    })),
  ]);
  console.log(
    `  게시글 ${SAMPLE_NOTICES.length + SAMPLE_FAQS.length}건 (공지 ${SAMPLE_NOTICES.length} · FAQ ${SAMPLE_FAQS.length})`,
  );
}

/**
 * 이야기 샘플 — 핸드오프 'PaRaSOL 이야기.dc.html'의 데모 6건.
 *
 * 본문은 article.content 한 칸에 경량 규약으로 담는다(`## 소제목` · `> 인용` · `![캡션](경로)`).
 * productSlug는 상품 시드가 만든 slug — 이야기에서 구매로 가는 동선이라 실제 상품에 걸어둔다.
 */
const SAMPLE_ARTICLES: {
  slug: string;
  title: string;
  summary: string;
  categoryCode: string;
  productSlug: string;
  isFeatured: boolean;
  publishedAt: string;
  content: string;
}[] = [
  {
    slug: "morning-oven-6am",
    title: "매일 아침 6시, 오븐이 데워지는 시간",
    summary: "하루를 여는 첫 번째 반죽. 작업장의 이른 아침 풍경을 담았습니다.",
    categoryCode: "workshop",
    productSlug: "oat-cookie-set",
    isFeatured: true,
    publishedAt: "2026-07-18",
    content: [
      "해가 완전히 뜨기 전, 작업장의 불이 하나둘 켜집니다. 가장 먼저 하는 일은 오븐을 데우는 것. 온도가 올라오는 20분 동안 재료를 계량하고, 어제 저녁 준비해 둔 반죽을 냉장고에서 꺼냅니다.",
      "> 서두르면 반죽이 먼저 알아요. 그래서 우리는 서두르지 않습니다.",
      "오트밀과 통밀가루의 비율은 계절에 따라 조금씩 달라집니다. 습도가 높은 여름에는 물의 양을 살짝 줄이고, 반죽의 되기를 손끝으로 확인합니다. 계량기가 알려주지 않는 것을 손이 기억합니다.",
      "## 같은 맛을 지킨다는 것",
      "매일 같은 맛을 낸다는 건 생각보다 어려운 일입니다. 표준 레시피를 지키되, 그날의 재료 상태에 맞춰 미세하게 조정하는 균형 감각이 필요합니다. 이 감각은 하루아침에 생기지 않습니다.",
      "그래서 우리는 한 사람이 한 공정에 충분히 익숙해질 때까지 기다립니다. 익숙함이 정확함이 되고, 정확함이 신뢰가 됩니다.",
    ].join("\n\n"),
  },
  {
    slug: "twelve-years-of-packing",
    title: "12년째 포장을 맡고 있는 손",
    summary: "상자를 여미는 마지막 손길에 담긴 자부심에 대하여.",
    categoryCode: "people",
    productSlug: "jujube-chip-set",
    isFeatured: false,
    publishedAt: "2026-07-05",
    content: [
      "모든 제품은 사람의 손을 거쳐 상자에 담깁니다. 리본의 매듭 하나에도 나름의 규칙이 있습니다.",
      "> 받는 사람이 상자를 여는 순간을 상상하며 묶어요.",
      "12년 동안 같은 자리에서 포장을 맡아온 손끝에는 흔들림이 없습니다.",
    ].join("\n\n"),
  },
  {
    slug: "why-domestic-jujube",
    title: "국내산 대추를 고집하는 이유",
    summary: "조금 더 비싸도 산지를 바꾸지 않는 까닭.",
    categoryCode: "ingredient",
    productSlug: "jujube-chip-set",
    isFeatured: false,
    publishedAt: "2026-06-22",
    content: [
      "대추는 산지에 따라 단맛과 향이 확연히 다릅니다. 우리는 매년 같은 농가와 계약합니다.",
      "가격이 오르는 해에도 산지를 바꾸지 않는 이유는 단순합니다. 맛이 달라지기 때문입니다.",
    ].join("\n\n"),
  },
  {
    slug: "three-ways-oat-cookie",
    title: "집에서 즐기는 오트 쿠키 3가지 방법",
    summary: "그대로도 좋지만, 조금 더 특별하게.",
    categoryCode: "recipe",
    productSlug: "oat-cookie-set",
    isFeatured: false,
    publishedAt: "2026-06-10",
    content: [
      "오트 쿠키는 그대로 먹어도 맛있지만, 조금만 더하면 근사한 디저트가 됩니다.",
      "## 1. 우유에 30초",
      "차가운 우유에 살짝 적셔 먹으면 색다른 식감을 즐길 수 있습니다.",
    ].join("\n\n"),
  },
  {
    slug: "beyond-the-package",
    title: "포장지에 담기지 않는 것들",
    summary: "보이지 않는 곳의 위생과 정성.",
    categoryCode: "workshop",
    productSlug: "handdrip-blend-beans",
    isFeatured: false,
    publishedAt: "2026-05-28",
    content: [
      "제품에 드러나지 않지만 가장 중요한 것은 위생입니다.",
      "> 보이지 않아도, 먹는 사람은 결국 알게 됩니다.",
    ].join("\n\n"),
  },
  {
    slug: "first-day-at-work",
    title: "첫 출근 날의 떨림을 기억하며",
    summary: "일이 자립이 되는 순간에 대하여.",
    categoryCode: "people",
    productSlug: "cranberry-granola",
    isFeatured: false,
    publishedAt: "2026-05-14",
    content:
      "누구에게나 첫 출근은 떨립니다. 이곳에서의 첫날은 조금 더 특별한 의미를 갖습니다.",
  },
];

const ARTICLE_AUTHOR_NAME = "PaRaSOL 에디터";

/** 이야기도 별개 가드 — 상품이 이미 있어도 이야기는 따로 들어가야 한다 */
async function seedSampleArticles() {
  const [{ articleCount }] = await db.select({ articleCount: count() }).from(article);
  if (articleCount > 0) {
    console.log("  이미 이야기가 있습니다 — 이야기 시드 건너뜀");
    return;
  }

  const productRows = await db
    .select({ id: product.id, slug: product.slug })
    .from(product)
    .where(inArray(product.slug, SAMPLE_ARTICLES.map((row) => row.productSlug)));
  const productIdBySlug = new Map(productRows.map((row) => [row.slug, row.id]));

  await db.insert(article).values(
    SAMPLE_ARTICLES.map((articleSeed) => ({
      slug: articleSeed.slug,
      title: articleSeed.title,
      summary: articleSeed.summary,
      content: articleSeed.content,
      categoryCode: articleSeed.categoryCode,
      // 상품 시드 전에 돌면 연결이 비는데, 그래도 이야기는 읽힌다(제품 카드만 안 나온다)
      productId: productIdBySlug.get(articleSeed.productSlug) ?? null,
      authorName: ARTICLE_AUTHOR_NAME,
      isFeatured: articleSeed.isFeatured,
      publishedAt: new Date(`${articleSeed.publishedAt}T09:00:00+09:00`),
    })),
  );
  console.log(`  이야기 ${SAMPLE_ARTICLES.length}건`);
}

async function runDevSeed() {
  console.log("\nPaRaSOL 개발용 샘플 상품 시드 실행\n");

  // 배너·게시글은 상품 가드보다 먼저 — 상품이 이미 있어도 각자 추가 실행이 가능해야 한다
  await seedSampleBanners();
  await seedSampleBoardPosts();

  // 가드: 이 스크립트는 빈 상품 테이블 전용 — 멱등 병합이 아니라 통째로 넣거나 말거나다
  const [{ productCount }] = await db.select({ productCount: count() }).from(product);
  if (productCount > 0) {
    console.log("  이미 상품이 있습니다 — 상품 시드 건너뜀");
    // 이야기는 상품 뒤에 넣는다 — 'productSlug → productId'를 걸려면 상품이 먼저 있어야 한다
    await seedSampleArticles();
    console.log("\n완료.\n");
    return;
  }

  // 실패 시 전부 롤백 — 절반만 들어간 상태가 남으면 가드에 걸려 재실행이 막힌다
  await db.transaction(async (tx) => {
    await tx
      .insert(maker)
      .values(
        MAKERS.map((row, index) => ({
          name: row.name,
          slug: row.slug,
          sortOrder: index + 1,
          createdBy: SEED_ACTOR,
        })),
      )
      .onConflictDoNothing({ target: maker.slug });

    // 이미 있던 공방도 매핑해야 하므로 insert 결과가 아니라 전체를 다시 조회한다
    const makerRows = await tx.select({ id: maker.id, slug: maker.slug }).from(maker);
    const makerIdBySlug = new Map(makerRows.map((row) => [row.slug, row.id]));

    const neededCategorySlugs = [...new Set(PRODUCTS.flatMap((row) => row.categorySlugs))];
    const categoryRows = await tx
      .select({ id: category.id, slug: category.slug })
      .from(category)
      .where(inArray(category.slug, neededCategorySlugs));
    const categoryIdBySlug = new Map(categoryRows.map((row) => [row.slug, row.id]));

    // insert를 시작하기 전에 전제(기본 시드 완료)를 한 번에 검증한다
    const missingCategorySlugs = neededCategorySlugs.filter((slug) => !categoryIdBySlug.has(slug));
    if (missingCategorySlugs.length > 0) {
      throw new Error(
        `카테고리가 없습니다: ${missingCategorySlugs.join(", ")} — 기본 시드(npm run db:seed)를 먼저 실행하세요`,
      );
    }

    const [manualSection] = await tx
      .select({ id: displaySection.id })
      .from(displaySection)
      .where(eq(displaySection.kind, "manual"))
      .orderBy(asc(displaySection.sortOrder))
      .limit(1);
    if (!manualSection) {
      throw new Error(
        "진열섹션(manual)이 없습니다 — 기본 시드(npm run db:seed)를 먼저 실행하세요",
      );
    }

    const productIdBySlug = new Map<string, number>();
    let variantTotal = 0;
    let addonTotal = 0;

    for (const productSeed of PRODUCTS) {
      let makerId: number | null = null;
      if (productSeed.makerSlug !== null) {
        const foundMakerId = makerIdBySlug.get(productSeed.makerSlug);
        if (foundMakerId === undefined) {
          throw new Error(`maker slug 불일치: ${productSeed.slug} → ${productSeed.makerSlug}`);
        }
        makerId = foundMakerId;
      }

      const [insertedProduct] = await tx
        .insert(product)
        .values({
          makerId,
          name: productSeed.name,
          slug: productSeed.slug,
          summary: productSeed.summary ?? null,
          status: "active", // 개발 화면에서 바로 보이게 — 품절도 노출 상태(재고 0)로 표현
          badgeLabel: productSeed.badgeLabel ?? null,
          salesCount: productSeed.salesCount,
          // 정렬 캐시 — 목록·가격 정렬이 variant를 집계하지 않도록 최저가를 채운다
          minPrice: Math.min(...productSeed.variants.map((variantSeed) => variantSeed.price)),
          createdBy: SEED_ACTOR,
        })
        .returning({ id: product.id });

      productIdBySlug.set(productSeed.slug, insertedProduct.id);

      await tx.insert(productCategory).values(
        productSeed.categorySlugs.map((categorySlug, categoryIndex) => ({
          productId: insertedProduct.id,
          // 위에서 존재를 검증했으므로 단언해도 안전하다
          categoryId: categoryIdBySlug.get(categorySlug)!,
          // 첫 slug가 대표 — 브레드크럼·SEO가 이 값을 본다. 대표 없는 상품을 만들지 않는다
          isPrimary: categoryIndex === 0,
        })),
      );

      // 옵션 상품 — variant가 값 라벨로 조합을 참조하므로 라벨→id 맵을 먼저 만든다
      const optionValueIdByLabel = new Map<string, number>();
      for (const [optionIndex, optionSeed] of (productSeed.options ?? []).entries()) {
        const [insertedOption] = await tx
          .insert(productOption)
          .values({
            productId: insertedProduct.id,
            name: optionSeed.name,
            position: optionIndex + 1,
            createdBy: SEED_ACTOR,
          })
          .returning({ id: productOption.id });

        const insertedValues = await tx
          .insert(productOptionValue)
          .values(
            optionSeed.values.map((valueLabel, valueIndex) => ({
              optionId: insertedOption.id,
              value: valueLabel,
              position: valueIndex + 1,
              createdBy: SEED_ACTOR,
            })),
          )
          .returning({ id: productOptionValue.id, value: productOptionValue.value });

        for (const valueRow of insertedValues) {
          optionValueIdByLabel.set(valueRow.value, valueRow.id);
        }
      }

      for (const [variantIndex, variantSeed] of productSeed.variants.entries()) {
        const [insertedVariant] = await tx
          .insert(productVariant)
          .values({
            productId: insertedProduct.id,
            price: variantSeed.price,
            compareAtPrice: variantSeed.compareAtPrice ?? null,
            stock: variantSeed.stock,
            position: variantIndex + 1,
            createdBy: SEED_ACTOR,
          })
          .returning({ id: productVariant.id });
        variantTotal += 1;

        if (variantSeed.optionValues?.length) {
          await tx.insert(variantOptionValue).values(
            variantSeed.optionValues.map((valueLabel) => {
              const optionValueId = optionValueIdByLabel.get(valueLabel);
              if (optionValueId === undefined) {
                throw new Error(`옵션 값 불일치: ${productSeed.slug} → ${valueLabel}`);
              }
              return { variantId: insertedVariant.id, optionValueId };
            }),
          );
        }
      }

      if (productSeed.addons?.length) {
        await tx.insert(productAddon).values(
          productSeed.addons.map((addonSeed, addonIndex) => ({
            productId: insertedProduct.id,
            name: addonSeed.name,
            price: addonSeed.price,
            stock: addonSeed.stock,
            position: addonIndex + 1,
            createdBy: SEED_ACTOR,
          })),
        );
        addonTotal += productSeed.addons.length;
      }
    }

    await tx.insert(displaySectionProduct).values(
      CURATION_SLUGS.map((curationSlug, index) => {
        const curatedProductId = productIdBySlug.get(curationSlug);
        if (curatedProductId === undefined) {
          throw new Error(`큐레이션 slug 불일치: ${curationSlug}`);
        }
        return {
          sectionId: manualSection.id,
          productId: curatedProductId,
          sortOrder: index + 1,
        };
      }),
    );

    console.log(
      `  상품 ${PRODUCTS.length}종 · variant ${variantTotal}개 · 추가상품 ${addonTotal}개 · 큐레이션 매핑 ${CURATION_SLUGS.length}건`,
    );
  });

  // 상품 트랜잭션 밖 — 이야기는 상품 id를 참조하므로 커밋된 뒤에 넣는다
  await seedSampleArticles();

  console.log("\n완료.\n");
}

runDevSeed()
  .then(() => process.exit(0))
  .catch((seedError) => {
    console.error("\n개발 시드 실패:", seedError);
    process.exit(1);
  });
