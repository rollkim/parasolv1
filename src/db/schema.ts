// =============================================================
// PaRaSOL v0.1 — Drizzle 스키마 v0.3 최종 (PostgreSQL)
// v0.2(디자인 반영 53테이블) + 최종 점검: FK 보강 · guest 작성자 · 적립금 잔여분 · CHECK 제약
// v0.3a: 코드값 영문 규약 확정 — 아래 [명명 규약] 참조
// v0.4 (2026-07-23): 핸드오프 정합성 검토 반영 — order_status 'shipped'→'shipping' ·
//   banner 히어로 문구(kicker/subtitle/cta_label) · inventory_log 추가상품 대상(addon_id+XOR) ·
//   post.is_pinned · bulk_inquiry.status enum화 · product.min_price 캐시 · customer.admin_memo
//   (근거: 분석_핸드오프정합성검토_20260723.md — 이 파일이 이후 단일 소스, 핸드오프 원본은 v0.3 동결)
// 원칙: 금액 원 단위 integer · 주문은 스냅샷 · variant가 판매 단위 · 감사 컬럼 표준
// 단계 표기: [1차] 30일 범위 / [2차] 후속 — 스키마는 함께 정의(사후 마이그레이션 비용 회피)
// =============================================================

import {
  pgTable, pgEnum, bigserial, bigint, integer, text, boolean,
  timestamp, jsonb, uniqueIndex, index, primaryKey, check, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- [명명 규약] 코드값은 영문, 코드명만 한글 ----------
// DB에 저장되는 '식별자'는 전부 영문 소문자 snake_case로 통일한다:
//   common_code.group_code / common_code.code, 모든 *_code 컬럼, slug, status·kind·type·reason 류
// 한글은 '화면에 보이는 이름'에만 쓴다: common_code.name, category.name, product.name, grade.name 등
// 이유: 코드값이 한글이면 URL 인코딩·정렬·조인·로그·API 파라미터에서 전부 깨지고,
//       DB 콜레이션과 클라이언트 인코딩에 따라 같은 글자가 다른 바이트로 저장될 수 있다.
// 예) 택배사     → code:"cj",           name:"CJ대한통운"
//     문의 유형  → code:"delivery",     name:"배송 문의"
//     클레임 사유 → code:"change_mind",  name:"단순 변심"
//     리뷰 태그  → code:"tasty",        name:"맛있어요"
//     회원 등급  → code:"vip",          name:"VIP"
// slug도 동일 — 한글 slug는 URL이 %EC%... 로 깨지므로 CHECK 제약으로 ASCII를 강제한다.

// ---------- enum ----------

export const productStatus = pgEnum("product_status", ["draft", "active", "hidden"]);
export const orderStatus = pgEnum("order_status", [
  "pending", "paid", "preparing", "shipping", "delivered", "confirmed", "cancelled",
]);
export const paymentStatus = pgEnum("payment_status", [
  "ready", "paid", "partial_cancelled", "cancelled", "failed",
]);
// 클레임은 주문 상태와 별개 축 — 부분 취소/반품이 가능하므로 주문 status로 표현 불가
export const claimType = pgEnum("claim_type", ["cancel", "exchange", "return"]);
export const claimStatus = pgEnum("claim_status", [
  "requested", "approved", "rejected", "collecting", "inspecting", "done",
]);
export const claimFault = pgEnum("claim_fault", ["buyer", "seller"]); // 귀책 — 배송비 부담 주체 결정
export const pointType = pgEnum("point_type", ["earn", "use", "expire", "cancel", "manual"]);
export const couponType = pgEnum("coupon_type", ["fixed", "percent"]);
export const couponScope = pgEnum("coupon_scope", ["all", "category", "product"]);
export const couponIssueMethod = pgEnum("coupon_issue_method", ["download", "code", "auto"]);
export const imageKind = pgEnum("image_kind", ["thumbnail", "detail"]); // 갤러리 썸네일 / 상세 세로 스택
export const boardType = pgEnum("board_type", ["notice", "faq", "qna"]);
export const adminRole = pgEnum("admin_role", ["owner", "manager"]);
export const authorType = pgEnum("author_type", ["admin", "customer", "guest"]); // guest = 비회원 작성(문의 등)
export const authProvider = pgEnum("auth_provider", ["local", "kakao", "naver", "google"]);
export const orderChannel = pgEnum("order_channel", ["web", "npay"]);
export const bulkInquiryStatus = pgEnum("bulk_inquiry_status", ["received", "contacted", "closed"]);

// ---------- 공통 감사 컬럼 ----------
// 마스터 데이터 → audit(4) / 사용자 생성 데이터 → auditTimes(2) / 로그·스냅샷 → createdOnly(1)
// actor 규약: "admin:{id}" / "customer:{id}" / "system"

const auditTimes = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};
const auditActors = {
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
};
const audit = { ...auditTimes, ...auditActors };
const createdOnly = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

// =============================================================
// 생산시설 · 상품
// =============================================================

// [1차] 생산 공방/시설 — 디자인상 전 상품 카드·상세에 "만든 곳"이 노출되고
// 브랜드 스토리("만든 사람의 이야기")의 주체. 몰 운영사는 1곳이지만 공급 공방은 다수.
export const maker = pgTable("maker", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  summary: text("summary"),
  story: text("story"),
  imagePath: text("image_path"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ...audit,
}, (t) => [
  uniqueIndex("maker_slug_uq").on(t.slug),
  check("maker_slug_ascii_ck", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
]);

export const category = pgTable("category", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // self FK — 계층 무결성 보장 (v0.1 결함 수정)
  parentId: bigint("parent_id", { mode: "number" }).references((): AnyPgColumn => category.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  ...audit,
}, (t) => [
  uniqueIndex("category_slug_uq").on(t.slug),
  check("category_slug_ascii_ck", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
]);

export const product = pgTable("product", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  makerId: bigint("maker_id", { mode: "number" }).references(() => maker.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  summary: text("summary"),
  description: text("description"),          // 상세설명 에디터(WYSIWYG) 산출 HTML
  status: productStatus("status").notNull().default("draft"),
  badgeLabel: text("badge_label"),           // NEW / BEST 등 카드 뱃지 (디자인 tagLabel)
  // 정렬·표시용 비정규화 집계 — 주문확정·리뷰등록 시 갱신 (목록 정렬이 매번 집계하지 않도록)
  salesCount: integer("sales_count").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  ratingSum: integer("rating_sum").notNull().default(0), // 평균 = ratingSum / reviewCount
  minPrice: integer("min_price").notNull().default(0),   // 표시가 캐시 — variant 저장 시 MIN(price) 갱신 (목록 카드·가격 정렬·가격대 필터)
  deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete — 주문·리뷰 이력 보존
  ...audit,
}, (t) => [
  uniqueIndex("product_slug_uq").on(t.slug),
  check("product_slug_ascii_ck", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
  index("product_status_idx").on(t.status),
  index("product_maker_idx").on(t.makerId),
]);

export const productCategory = pgTable("product_category", {
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  categoryId: bigint("category_id", { mode: "number" }).notNull().references(() => category.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.productId, t.categoryId] })]);

export const productOption = pgTable("product_option", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  name: text("name").notNull(),              // 예: 구성, 포장
  position: integer("position").notNull().default(0),
  ...audit,
});

export const productOptionValue = pgTable("product_option_value", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  optionId: bigint("option_id", { mode: "number" }).notNull().references(() => productOption.id, { onDelete: "cascade" }),
  value: text("value").notNull(),            // 예: 24개입, 선물 포장
  position: integer("position").notNull().default(0),
  ...audit,
});

// 판매 단위(SKU). 디자인의 STOCK 맵('24개입|선물 포장' → 재고)이 이 테이블에 대응
export const productVariant = pgTable("product_variant", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  sku: text("sku"),
  price: integer("price").notNull(),
  compareAtPrice: integer("compare_at_price"),   // 정가(할인 전) — 카드의 취소선 가격
  stock: integer("stock").notNull().default(0),  // 차감: UPDATE ... WHERE stock >= n
  isActive: boolean("is_active").notNull().default(true),
  position: integer("position").notNull().default(0),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...audit,
}, (t) => [
  uniqueIndex("variant_sku_uq").on(t.sku),
  index("variant_product_idx").on(t.productId),
  check("variant_price_ck", sql`${t.price} >= 0`),
  check("variant_stock_ck", sql`${t.stock} >= 0`),
]);

export const variantOptionValue = pgTable("variant_option_value", {
  variantId: bigint("variant_id", { mode: "number" }).notNull().references(() => productVariant.id, { onDelete: "cascade" }),
  optionValueId: bigint("option_value_id", { mode: "number" }).notNull().references(() => productOptionValue.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.variantId, t.optionValueId] })]);

export const productImage = pgTable("product_image", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  kind: imageKind("kind").notNull().default("thumbnail"), // 갤러리 / 상세 세로 스택
  path: text("path").notNull(),
  alt: text("alt").notNull(),                // 관리자 폼에서 필수 입력 강제 (접근성)
  isPrimary: boolean("is_primary").notNull().default(false), // 대표 이미지
  position: integer("position").notNull().default(0),
  ...audit,
}, (t) => [index("product_image_idx").on(t.productId, t.kind, t.position)]);

// [1차] 추가상품 — 옵션과 별개 축(보냉백·메시지 카드·리본 포장)
export const productAddon = pgTable("product_addon", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  price: integer("price").notNull(),
  stock: integer("stock").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  position: integer("position").notNull().default(0),
  ...audit,
});

// =============================================================
// 회원
// =============================================================

// [2차] 회원 등급 — 등급별 적립 보너스율 (관리자 적립금 화면: 일반 0% / 단골 1% / VIP 2%)
export const customerGrade = pgTable("customer_grade", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  bonusRate: integer("bonus_rate").notNull().default(0), // 0.1% 단위 정수 (예: 20 = 2.0%)
  sortOrder: integer("sort_order").notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex("customer_grade_code_uq").on(t.code)]);

export const customer = pgTable("customer", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  gradeId: bigint("grade_id", { mode: "number" }).references(() => customerGrade.id, { onDelete: "set null" }),
  email: text("email"),
  name: text("name").notNull(),
  phone: text("phone"),
  adminMemo: text("admin_memo"),                               // 관리자 CS 메모 (회원관리 화면)
  pointBalance: integer("point_balance").notNull().default(0), // 잔액 캐시 — 원장은 point_transaction
  // 광고성 정보 수신 동의 (주문 안내 알림톡은 정보성이라 동의 불요)
  marketingSmsAgreedAt: timestamp("marketing_sms_agreed_at", { withTimezone: true }),
  marketingEmailAgreedAt: timestamp("marketing_email_agreed_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }), // 탈퇴 — 개인정보 마스킹 후 주문 이력 보존
  ...auditTimes,
}, (t) => [index("customer_email_idx").on(t.email)]);

export const customerAuth = pgTable("customer_auth", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customer.id, { onDelete: "cascade" }),
  provider: authProvider("provider").notNull(),
  providerUid: text("provider_uid").notNull(),
  passwordHash: text("password_hash"),
  ...createdOnly,
}, (t) => [uniqueIndex("customer_auth_uq").on(t.provider, t.providerUid)]);

export const passwordResetToken = pgTable("password_reset_token", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customer.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  ...createdOnly,
}, (t) => [uniqueIndex("prt_token_uq").on(t.token)]);

export const address = pgTable("address", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customer.id, { onDelete: "cascade" }),
  label: text("label"),                       // 집·회사 등 배송지 별칭
  recipient: text("recipient").notNull(),
  phone: text("phone").notNull(),
  zipcode: text("zipcode").notNull(),
  addr1: text("addr1").notNull(),
  addr2: text("addr2"),
  isDefault: boolean("is_default").notNull().default(false),
  ...auditTimes,
});

// [1차] 약관 문서 + 동의 이력 — 약관문서 화면(이용약관·개인정보·배송정책)과 가입/주문 동의
export const termsDocument = pgTable("terms_document", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: text("code").notNull(),               // terms / privacy / delivery ...
  title: text("title").notNull(),
  version: text("version").notNull(),
  content: text("content").notNull(),
  isRequired: boolean("is_required").notNull().default(true),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  ...audit,
}, (t) => [uniqueIndex("terms_doc_uq").on(t.code, t.version)]);

export const termsAgreement = pgTable("terms_agreement", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  orderId: bigint("order_id", { mode: "number" }).references(() => orders.id, { onDelete: "set null" }), // 비회원 주문 시 동의
  termsDocumentId: bigint("terms_document_id", { mode: "number" }).notNull().references(() => termsDocument.id),
  ip: text("ip"),
  ...createdOnly,
});

// =============================================================
// 카트
// =============================================================

export const cart = pgTable("cart", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  sessionToken: text("session_token"),
  ...auditTimes,
}, (t) => [
  // 토큰당 카트 1개 — 동시 담기가 카트를 둘로 쪼개면 방금 담은 상품이 사라진 것처럼 보인다.
  // 회원 카트는 토큰이 NULL일 수 있고, Postgres는 NULL을 서로 다르게 보므로 부분 인덱스가 맞다.
  uniqueIndex("cart_session_token_uq").on(t.sessionToken).where(sql`${t.sessionToken} IS NOT NULL`),
]);

// 유니크 제약 없음(v0.1 결함 수정): 같은 variant라도 추가상품 조합이 다르면 별개 라인.
// 추가상품이 동일한 라인끼리의 병합은 애플리케이션에서 처리한다.
export const cartItem = pgTable("cart_item", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  cartId: bigint("cart_id", { mode: "number" }).notNull().references(() => cart.id, { onDelete: "cascade" }),
  variantId: bigint("variant_id", { mode: "number" }).notNull().references(() => productVariant.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
  ...auditTimes,
}, (t) => [index("cart_item_cart_idx").on(t.cartId)]);

export const cartItemAddon = pgTable("cart_item_addon", {
  cartItemId: bigint("cart_item_id", { mode: "number" }).notNull().references(() => cartItem.id, { onDelete: "cascade" }),
  addonId: bigint("addon_id", { mode: "number" }).notNull().references(() => productAddon.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.cartItemId, t.addonId] })]);

// [1차] 찜 / [1차] 재입고 알림
export const wishlist = pgTable("wishlist", {
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customer.id, { onDelete: "cascade" }),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  ...createdOnly,
}, (t) => [primaryKey({ columns: [t.customerId, t.productId] })]);

export const restockNotification = pgTable("restock_notification", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  variantId: bigint("variant_id", { mode: "number" }).notNull().references(() => productVariant.id, { onDelete: "cascade" }),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "cascade" }),
  phone: text("phone"),                        // 비회원 신청 대비
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  ...createdOnly,
}, (t) => [index("restock_variant_idx").on(t.variantId)]);

// =============================================================
// 주문 · 결제 · 배송
// =============================================================

export const orders = pgTable("orders", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // "YYYYMMDD-####" — 날짜 접두(주문일 KST, 표시용) + 전역 시퀀스 order_no_seq 일련번호(리셋 없음).
  // 토스 orderId 겸용. 채번은 order-number.service의 nextval — MAX+1 금지.
  orderNo: text("order_no").notNull(),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  guestToken: text("guest_token"),
  status: orderStatus("status").notNull().default("pending"),
  channel: orderChannel("channel").notNull().default("web"),
  // --- 주문자 (수령인과 별개: 비회원 주문조회·영수증·CS 연락처) ---
  ordererName: text("orderer_name").notNull(),
  ordererPhone: text("orderer_phone").notNull(),
  ordererEmail: text("orderer_email"),
  // --- 배송지 스냅샷 ---
  recipient: text("recipient").notNull(),
  phone: text("phone").notNull(),
  zipcode: text("zipcode").notNull(),
  addr1: text("addr1").notNull(),
  addr2: text("addr2"),
  deliveryMemo: text("delivery_memo"),
  // --- 금액 (원 단위, 주문 시점 확정) ---
  subtotal: integer("subtotal").notNull(),
  shippingFee: integer("shipping_fee").notNull().default(0),
  couponDiscount: integer("coupon_discount").notNull().default(0),
  pointUsed: integer("point_used").notNull().default(0),
  grandTotal: integer("grand_total").notNull(),
  // shipping→delivered 전이 시 세팅 — 자동 구매확정 배치의 기준 시각(confirmed_at과 대칭)
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }), // 구매확정 — 적립 트리거
  ...auditTimes,
}, (t) => [
  uniqueIndex("orders_no_uq").on(t.orderNo),
  index("orders_customer_idx").on(t.customerId),
  index("orders_status_created_idx").on(t.status, t.createdAt),
  // 비회원 주문조회 1차 수단 — 게스트 토큰 보유 행만
  index("orders_guest_token_idx").on(t.guestToken).where(sql`${t.guestToken} IS NOT NULL`),
  // 자동확정 배치 — 배송완료 건만 스캔
  index("orders_delivered_at_idx").on(t.deliveredAt).where(sql`${t.status} = 'delivered'`),
]);

export const orderItem = pgTable("order_item", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  variantId: bigint("variant_id", { mode: "number" }).references(() => productVariant.id, { onDelete: "set null" }),
  productId: bigint("product_id", { mode: "number" }).references(() => product.id, { onDelete: "set null" }), // 리뷰 연결용
  productName: text("product_name").notNull(),   // 스냅샷
  makerName: text("maker_name"),                 // 스냅샷 — 주문 상세에 만든 곳 표시
  variantName: text("variant_name"),             // 옵션 조합 스냅샷
  // 주문 시점 정가(compare_at_price) 스냅샷 — NULL이면 할인 없음.
  // 상품 정가가 나중에 바뀌어도 '상품 할인' 행이 흔들리지 않게 복사해 둔다.
  listPrice: integer("list_price"),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
  // 대표 이미지 스냅샷 — 상품이 하드 삭제돼도 주문 화면의 썸네일이 남는다
  thumbnailPath: text("thumbnail_path"),
  thumbnailAlt: text("thumbnail_alt"),
  ...createdOnly,
}, (t) => [
  index("order_item_order_idx").on(t.orderId),
  check("order_item_qty_ck", sql`${t.quantity} > 0`),
]);

export const orderItemAddon = pgTable("order_item_addon", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderItemId: bigint("order_item_id", { mode: "number" }).notNull().references(() => orderItem.id, { onDelete: "cascade" }),
  // 통계·클레임 복원용 참조(nullable) — 이름·가격은 아래 스냅샷이 진실. 추가상품 삭제돼도 주문 불변
  addonId: bigint("addon_id", { mode: "number" }).references(() => productAddon.id, { onDelete: "set null" }),
  addonName: text("addon_name").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  lineTotal: integer("line_total").notNull(),
  ...createdOnly,
}, (t) => [index("order_item_addon_addon_idx").on(t.addonId)]);

export const orderStatusHistory = pgTable("order_status_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  fromStatus: orderStatus("from_status"),
  toStatus: orderStatus("to_status").notNull(),
  actor: text("actor").notNull(),
  memo: text("memo"),
  ...createdOnly,
}, (t) => [index("osh_order_idx").on(t.orderId)]);

export const payment = pgTable("payment", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("tosspayments"),
  paymentKey: text("payment_key"),
  method: text("method"),
  amount: integer("amount").notNull(),
  status: paymentStatus("status").notNull().default("ready"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  raw: jsonb("raw"),
  // 클레임 배송비 추가결제[2차 card] 자리 — 주문 본결제와 구분한다.
  // 이 값이 있으면 아래 '주문당 유효 결제 1건' 제약에서 빠진다(한 주문에 본결제 1 + 클레임 결제 N).
  claimId: bigint("claim_id", { mode: "number" }).references(() => claim.id, { onDelete: "set null" }),
  ...auditTimes,
}, (t) => [
  uniqueIndex("payment_key_uq").on(t.paymentKey),
  index("payment_order_idx").on(t.orderId),
  // 주문당 유효 '본결제' 1건 강제 — 실패 결제는 여러 번(재시도) 허용, 환불 대상 모호성 제거
  uniqueIndex("payment_order_active_uq")
    .on(t.orderId)
    .where(sql`${t.status} <> 'failed' AND ${t.claimId} IS NULL`),
  index("payment_claim_idx").on(t.claimId).where(sql`${t.claimId} IS NOT NULL`),
]);

export const paymentCancellation = pgTable("payment_cancellation", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  paymentId: bigint("payment_id", { mode: "number" }).notNull().references(() => payment.id, { onDelete: "cascade" }),
  claimId: bigint("claim_id", { mode: "number" }).references(() => claim.id, { onDelete: "set null" }), // 클레임 기인 환불 연결
  amount: integer("amount").notNull(),
  // 환불 실행 채널(설계 D10) — pg_api(토스 API 자동) / pg_console(PG 관리자 수동 환불 후 기록)
  // / bank_transfer(계좌 송금 후 기록). PG API 환불이 막히는 실무 상황(기간 경과·부분취소 불가)에도
  // 클레임이 멈추지 않게 한다. 전 채널이 이 원장 하나에 남아야 '미환불 잔액' 계산이 성립한다.
  refundChannel: text("refund_channel").notNull().default("pg_api"),
  reason: text("reason"),
  raw: jsonb("raw"),
  createdBy: text("created_by"),
  ...createdOnly,
}, (t) => [
  check("pc_refund_channel_ck", sql`${t.refundChannel} ~ '^[a-z_]+$'`),
]);

export const shipment = pgTable("shipment", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  claimId: bigint("claim_id", { mode: "number" }).references(() => claim.id, { onDelete: "set null" }), // 교환 재배송 시 클레임 연결
  carrier: text("carrier"),                   // common_code(carrier)
  trackingNo: text("tracking_no"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  ...audit,
});

// =============================================================
// 클레임 (취소 · 교환 · 반품) — [1차]
// 부분 신청이 가능하므로 주문 status가 아닌 별도 축으로 관리
// =============================================================

export const claim = pgTable("claim", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  claimNo: text("claim_no").notNull(),          // "{CN|EX|RT}-YYYYMMDD-####" — 타입 접두 + 날짜 + 전역 시퀀스(claim_no_seq)
  orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
  type: claimType("type").notNull(),
  status: claimStatus("status").notNull().default("requested"),
  reasonCode: text("reason_code").notNull(),    // 영문 코드 — common_code(claim_reason). 표시명은 조인해서 사용
  fault: claimFault("fault").notNull(),         // 귀책 → 배송비 부담 주체
  detail: text("detail"),
  photos: jsonb("photos"),                      // 첨부 이미지 경로 배열
  goodsAmount: integer("goods_amount").notNull().default(0),
  shippingFee: integer("shipping_fee").notNull().default(0), // 반품/교환 배송비
  refundAmount: integer("refund_amount").notNull().default(0),
  // 배송비 수취 — 상태(claim.status)가 아니라 별도 축이다. 미입금 교환이 상태머신을 멈추지 않고,
  // 관리자 목록의 '입금 대기' 필터가 대기열을 보여준다(설계 D3-확장).
  feeMethod: text("fee_method"),                // deduct_refund(환불차감) / bank_transfer(계좌이체) / card[2차]
  feeSettledAt: timestamp("fee_settled_at", { withTimezone: true }), // NULL이면 미수취 — 교환품 발송 게이트 기준
  feeMemo: text("fee_memo"),                    // 입금자명 등 운영 메모
  adminMemo: text("admin_memo"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...audit,
}, (t) => [
  uniqueIndex("claim_no_uq").on(t.claimNo),
  index("claim_order_idx").on(t.orderId),
  index("claim_status_idx").on(t.status),
  check("claim_fee_method_ck", sql`${t.feeMethod} IS NULL OR ${t.feeMethod} ~ '^[a-z_]+$'`),
]);

export const claimItem = pgTable("claim_item", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  claimId: bigint("claim_id", { mode: "number" }).notNull().references(() => claim.id, { onDelete: "cascade" }),
  orderItemId: bigint("order_item_id", { mode: "number" }).notNull().references(() => orderItem.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),      // 부분 수량 신청
  ...createdOnly,
});

export const claimStatusHistory = pgTable("claim_status_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  claimId: bigint("claim_id", { mode: "number" }).notNull().references(() => claim.id, { onDelete: "cascade" }),
  fromStatus: claimStatus("from_status"),
  toStatus: claimStatus("to_status").notNull(),
  actor: text("actor").notNull(),
  memo: text("memo"),
  ...createdOnly,
});

// =============================================================
// 적립금 — [2차]
// point_transaction이 원장(append-only), customer.pointBalance는 캐시
// =============================================================

export const pointTransaction = pgTable("point_transaction", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customer.id, { onDelete: "cascade" }),
  type: pointType("type").notNull(),
  amount: integer("amount").notNull(),          // 적립 +, 사용·소멸 −
  remainingAmount: integer("remaining_amount"), // earn 전용: 미사용 잔여분 — FIFO 사용·소멸 배치가 차감 (소멸 예정 금액 정확 산출)
  balanceAfter: integer("balance_after").notNull(),
  title: text("title").notNull(),               // 화면 표시용 문장(한글) — 예: "구매 확정 적립 (1%)"
  tagCode: text("tag_code"),                    // purchase/review/event/manual/expire — common_code(point_tag)
  orderId: bigint("order_id", { mode: "number" }).references(() => orders.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }), // 소멸 예정일
  createdBy: text("created_by"),                // 수동 지급 시 관리자
  ...createdOnly,
}, (t) => [
  index("point_customer_idx").on(t.customerId, t.createdAt),
  index("point_expires_idx").on(t.expiresAt),
]);

// =============================================================
// 쿠폰 · 기획전 — [2차]
// =============================================================

export const coupon = pgTable("coupon", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  type: couponType("type").notNull(),
  value: integer("value").notNull(),            // fixed=원 / percent=0.1%단위 정수
  maxDiscount: integer("max_discount"),         // percent형 최대 할인
  minOrderAmount: integer("min_order_amount").notNull().default(0),
  scope: couponScope("scope").notNull().default("all"),
  scopeRefId: bigint("scope_ref_id", { mode: "number" }), // category/product id
  issueMethod: couponIssueMethod("issue_method").notNull().default("download"),
  code: text("code"),                           // code형 등록 코드
  totalQuantity: integer("total_quantity"),     // null = 무제한
  issuedCount: integer("issued_count").notNull().default(0),
  validDays: integer("valid_days"),             // 발급일 기준 유효일수 (null이면 endsAt 사용)
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  ...audit,
}, (t) => [uniqueIndex("coupon_code_uq").on(t.code)]);

export const couponIssue = pgTable("coupon_issue", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  couponId: bigint("coupon_id", { mode: "number" }).notNull().references(() => coupon.id, { onDelete: "cascade" }),
  customerId: bigint("customer_id", { mode: "number" }).notNull().references(() => customer.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  orderId: bigint("order_id", { mode: "number" }).references(() => orders.id, { onDelete: "set null" }),
  discountAmount: integer("discount_amount"),   // 실제 적용 할인액
  ...createdOnly,
}, (t) => [
  uniqueIndex("coupon_issue_uq").on(t.couponId, t.customerId), // 1인 1매 원칙 (정책 변경 시 해제)
  index("coupon_issue_customer_idx").on(t.customerId),
]);

// 기획전 — 히어로·카운트다운·타임특가
export const promotion = pgTable("promotion", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  heroImagePath: text("hero_image_path"),
  heroMobileImagePath: text("hero_mobile_image_path"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),   // 카운트다운 기준
  isActive: boolean("is_active").notNull().default(true),
  ...audit,
}, (t) => [uniqueIndex("promotion_slug_uq").on(t.slug)]);

export const promotionProduct = pgTable("promotion_product", {
  promotionId: bigint("promotion_id", { mode: "number" }).notNull().references(() => promotion.id, { onDelete: "cascade" }),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  specialPrice: integer("special_price"),        // 타임특가
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.promotionId, t.productId] })]);

// =============================================================
// 진열 · 콘텐츠
// =============================================================

export const banner = pgTable("banner", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  slot: text("slot").notNull(),                 // common_code(banner_slot): hero / strip
  title: text("title"),
  kicker: text("kicker"),                       // 히어로 윗줄 문구 (메인 히어로가 라이브 텍스트 렌더 — 띠배너는 미사용)
  subtitle: text("subtitle"),                   // 히어로 부제
  ctaLabel: text("cta_label"),                  // 히어로 CTA 버튼 문구
  // 띠배너(strip)는 이미지 없이 문구·색만 쓴다 — 슬롯에 따라 이미지 유무가 갈리므로 nullable
  imagePath: text("image_path"),
  mobileImagePath: text("mobile_image_path"),
  alt: text("alt"),
  // 띠배너 배경 톤 — 색상값이 아니라 토큰명(primary/accent/foreground)을 저장한다.
  // 색을 직접 넣으면 리스킨 시 따라오지 않는다(RULE-11).
  toneCode: text("tone_code"),
  linkUrl: text("link_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  ...audit,
}, (t) => [
  // 이미지가 있으면 대체텍스트는 필수 — 접근성 요구를 DB가 강제한다(KWCAG)
  check("banner_alt_required_ck", sql`${t.imagePath} IS NULL OR ${t.alt} IS NOT NULL`),
]);

export const displaySection = pgTable("display_section", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kicker: text("kicker"),                         // 섹션 제목 윗줄 문구 (메인의 "CURATED" 등)
  title: text("title").notNull(),
  kind: text("kind").notNull().default("manual"), // manual / new / best
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  ...audit,
});

export const displaySectionProduct = pgTable("display_section_product", {
  sectionId: bigint("section_id", { mode: "number" }).notNull().references(() => displaySection.id, { onDelete: "cascade" }),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.sectionId, t.productId] })]);

// [2차] 브랜드 스토리(이야기) — 아티클
export const article = pgTable("article", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  content: text("content").notNull(),
  coverImagePath: text("cover_image_path"),
  makerId: bigint("maker_id", { mode: "number" }).references(() => maker.id, { onDelete: "set null" }),
  isFeatured: boolean("is_featured").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("article_slug_uq").on(t.slug)]);

// =============================================================
// 게시판 · 리뷰 · 문의
// =============================================================

export const board = pgTable("board", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  type: boardType("type").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...audit,
}, (t) => [uniqueIndex("board_slug_uq").on(t.slug)]);

export const post = pgTable("post", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  boardId: bigint("board_id", { mode: "number" }).notNull().references(() => board.id, { onDelete: "cascade" }),
  productId: bigint("product_id", { mode: "number" }).references(() => product.id, { onDelete: "set null" }), // 상품 문의
  categoryCode: text("category_code"),          // common_code(qna_type): 배송/교환/상품 등
  authorType: authorType("author_type").notNull(),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  // 비회원 문의
  guestName: text("guest_name"),
  guestPhone: text("guest_phone"),
  guestPasswordHash: text("guest_password_hash"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  attachments: jsonb("attachments"),            // 첨부 경로 배열
  isSecret: boolean("is_secret").notNull().default(false),
  isAnswered: boolean("is_answered").notNull().default(false),
  isPinned: boolean("is_pinned").notNull().default(false),   // 공지 상단 고정 (관리자 게시판 토글)
  viewCount: integer("view_count").notNull().default(0),
  ...auditTimes,
}, (t) => [index("post_board_idx").on(t.boardId, t.createdAt)]);

export const comment = pgTable("comment", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  postId: bigint("post_id", { mode: "number" }).notNull().references(() => post.id, { onDelete: "cascade" }),
  authorType: authorType("author_type").notNull(),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  ...auditTimes,
});

export const review = pgTable("review", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productId: bigint("product_id", { mode: "number" }).notNull().references(() => product.id, { onDelete: "cascade" }),
  orderItemId: bigint("order_item_id", { mode: "number" }).references(() => orderItem.id, { onDelete: "set null" }),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  rating: integer("rating").notNull(),          // 1~5
  content: text("content").notNull(),
  tags: jsonb("tags"),                          // 만족도 태그 "코드" 배열 ["tasty","well_packed"] — 표시명은 common_code(review_tag)
  images: jsonb("images"),                      // 사진 경로 배열 — 포토리뷰 적립 차등
  adminReply: text("admin_reply"),
  adminReplyAt: timestamp("admin_reply_at", { withTimezone: true }),
  reportCount: integer("report_count").notNull().default(0),
  isHidden: boolean("is_hidden").notNull().default(false),
  ...auditTimes,
}, (t) => [
  uniqueIndex("review_order_item_uq").on(t.orderItemId), // 구매 1건당 리뷰 1개
  index("review_product_idx").on(t.productId, t.createdAt),
  check("review_rating_ck", sql`${t.rating} between 1 and 5`),
]);

export const reviewReport = pgTable("review_report", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  reviewId: bigint("review_id", { mode: "number" }).notNull().references(() => review.id, { onDelete: "cascade" }),
  customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  ...createdOnly,
});

// [1차] 단체·기업 구매 문의 — 세금계산서·대량배송 상담 폼
export const bulkInquiry = pgTable("bulk_inquiry", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  purchaseTypeCode: text("purchase_type_code").notNull(), // group/corporate/holiday_set — common_code(bulk_type)
  companyName: text("company_name"),
  businessNo: text("business_no"),
  managerName: text("manager_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  quantity: integer("quantity"),
  budget: integer("budget"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  needTaxInvoice: boolean("need_tax_invoice").notNull().default(false),
  content: text("content"),
  status: bulkInquiryStatus("status").notNull().default("received"),
  adminMemo: text("admin_memo"),
  ...audit,
});

// =============================================================
// 공통코드 · 로그 · 운영
// =============================================================

export const commonCode = pgTable("common_code", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  groupCode: text("group_code").notNull(),      // 영문 소문자: carrier / qna_type / banner_slot / claim_reason / review_tag / point_tag / bulk_type
  code: text("code").notNull(),                 // 영문 소문자 (예: cj, change_mind, tasty)
  name: text("name").notNull(),                 // 한글 표시명 (예: CJ대한통운, 단순 변심, 맛있어요)
  meta: jsonb("meta"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  ...audit,
}, (t) => [
  uniqueIndex("common_code_uq").on(t.groupCode, t.code),
  // 코드값 한글 입력 차단 — 규약을 DB가 강제한다
  check("common_code_ascii_ck", sql`${t.groupCode} ~ '^[a-z0-9_]+$' AND ${t.code} ~ '^[a-z0-9_]+$'`),
]);

export const adminActivityLog = pgTable("admin_activity_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  adminUserId: bigint("admin_user_id", { mode: "number" }).references(() => adminUser.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  diff: jsonb("diff"),
  ip: text("ip"),
  ...createdOnly,
}, (t) => [index("aal_entity_idx").on(t.entity, t.entityId)]);

export const loginLog = pgTable("login_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subjectType: authorType("subject_type").notNull(),
  subjectId: bigint("subject_id", { mode: "number" }),
  provider: text("provider"),
  success: boolean("success").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  ...createdOnly,
});

export const inventoryLog = pgTable("inventory_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // 대상은 variant 또는 추가상품. append-only 감사 원장이라 대상 상품이 하드삭제돼도
  // 이력은 남겨야 한다(RULE-11 ⑧) → cascade가 아니라 set null. 삭제되면 둘 다 null이 될 수 있으므로
  // 제약은 "동시에 둘 다 채워지지 않음"(NOT both)으로 완화한다(신규 기록은 여전히 정확히 하나).
  variantId: bigint("variant_id", { mode: "number" }).references(() => productVariant.id, { onDelete: "set null" }),
  addonId: bigint("addon_id", { mode: "number" }).references(() => productAddon.id, { onDelete: "set null" }),
  delta: integer("delta").notNull(),
  stockAfter: integer("stock_after").notNull(),  // 잔량 스냅샷 (감사 시 재계산 불필요)
  reason: text("reason").notNull(),              // order / cancel_restock / claim_restock / manual
  refId: text("ref_id"),                         // 주문 복원 원천 — order_no 등
  memo: text("memo"),
  createdBy: text("created_by"),
  ...createdOnly,
}, (t) => [
  index("inv_log_variant_idx").on(t.variantId),
  index("inv_log_addon_idx").on(t.addonId),
  // 전체취소 복원·감사 조회 — ref_id(주문번호)로 그 주문의 차감 이력을 되짚는다
  index("inv_log_ref_idx").on(t.refId, t.reason),
  check("inv_log_target_ck", sql`NOT (${t.variantId} IS NOT NULL AND ${t.addonId} IS NOT NULL)`),
]);

export const adminUser = pgTable("admin_user", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  loginId: text("login_id").notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: adminRole("role").notNull().default("manager"),
  totpSecret: text("totp_secret"),               // 2단계 인증(관리자 로그인 OTP)
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("admin_login_uq").on(t.loginId)]);

export const siteSetting = pgTable("site_setting", {
  key: text("key").primaryKey(),                 // hero / shipping_policy / ga4 / naver_wcs / point_policy ...
  value: jsonb("value").notNull(),
  ...audit,
});

// =============================================================
// 추후 계획 (인덱스 · 시퀀스)
// =============================================================
// 주문/클레임 채번: 전역 시퀀스 order_no_seq·claim_no_seq(일별 리셋 없음) — 날짜 접두는 표시용,
//   일련번호는 전역 누적. order_no = to_char(now KST,'YYYYMMDD')||'-'||lpad(nextval,4). 4자리 최소·초과 시 자연 확장.
//   claim_no = {CN|EX|RT}-||날짜||-||lpad(nextval,4). MAX+1 금지 — 시퀀스는 사용자 DDL로 생성(RULE-2).
// 검색: product.name pg_trgm GIN — 통합검색 화면 착수 시. 인기검색어는 로그 집계(테이블 후행).
// 최근 본 상품: 서버 테이블 없이 클라이언트 저장(비회원 포함, 개인정보 최소화) — 필요 시 후행 추가.
// 로그 아카이브: login_log·admin_activity_log 100만 행 도달 시 연 단위 정리 배치.
// 재입고 알림 중복 방지: (variant, customer) / 비회원 (variant, phone) — 애플리케이션 레벨 dedupe.
// 레이아웃 규칙(스키마 외): 전 스토어프론트 화면 공통 푸터 필수 — 사업자 표기는 site_setting(key=business_info).
