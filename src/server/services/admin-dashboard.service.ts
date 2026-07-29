import "server-only";

import { and, count, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import {
  board,
  bulkInquiry,
  category,
  claim,
  orderItem,
  orders,
  payment,
  post,
  product,
  productCategory,
  productOption,
  productOptionValue,
  productVariant,
  shipment,
  variantOptionValue,
} from "@/db/schema";
import { claimTypeLabel, type ClaimType } from "@/domain/claim";

import type { DatabaseClient } from "./db-client";

/**
 * 관리자 대시보드 — 한 화면이라 한 번에 조립한다.
 *
 * **데이터로 답할 수 있는 것만 만든다.** 목업에는 결제 전환율·유입 채널·월 매출 목표가
 * 있지만 우리에게는 방문 추적도, 리퍼러 기록도, 목표값 설정도 없다. 없는 수치를 그럴듯하게
 * 그리면 운영자가 그것을 보고 판단한다 — 빈 자리로 두는 편이 훨씬 안전하다.
 * (제외한 지표와 이유는 EXCLUDED_METRICS에 남겨 둔다.)
 *
 * 시각 기준은 **KST 고정**이다. 서버가 UTC로 돌면 '오늘 매출'이 9시간 어긋나 아침마다
 * 어제 숫자를 보게 된다.
 */

/** 집계 기준 시간대 — 운영자가 보는 '오늘'은 서버 시간대가 아니라 한국 날짜다 */
const REPORT_TIME_ZONE = "Asia/Seoul";

/** 매출로 인정하는 주문 상태 — 취소는 제외한다 */
const REVENUE_ORDER_STATUSES = ["paid", "preparing", "shipping", "delivered", "confirmed"] as const;

/** 화면이 "왜 이 지표가 없는지" 물어볼 때 답할 근거 */
export const EXCLUDED_METRICS: { label: string; reason: string }[] = [
  { label: "결제 전환율", reason: "방문 수를 기록하지 않습니다(웹 분석 미연동)." },
  { label: "유입 채널", reason: "유입 경로를 저장하지 않습니다." },
  { label: "월 매출 목표", reason: "목표 금액을 설정하는 화면이 아직 없습니다." },
];

/**
 * KST 기준 날짜 경계 — 모든 집계가 **문자까지 같은 식**을 써야 한다.
 *
 * 시간대를 바인딩 파라미터로 넘기면 SELECT의 $1과 GROUP BY의 $2가 다른 식으로 취급돼
 * "column must appear in the GROUP BY clause"가 난다. 그래서 리터럴로 박는다
 * (사용자 입력이 아니라 고정 상수라 안전하다).
 */
const KST_LITERAL = sql.raw(`'${REPORT_TIME_ZONE}'`);
const kstDate = (column: unknown) => sql`(${column} AT TIME ZONE ${KST_LITERAL})::date`;
const kstToday = sql`(now() AT TIME ZONE ${KST_LITERAL})::date`;
const kstHourSlot = (column: unknown) =>
  sql`(extract(hour from ${column} AT TIME ZONE ${KST_LITERAL})::int / 4)`;

export type DashboardKpi = {
  todayOrderCount: number;
  todayRevenue: number;
  yesterdayOrderCount: number;
  yesterdayRevenue: number;
  /** 즉시 처리해야 하는 건수 합 — 아래 queue의 총합 */
  pendingTaskCount: number;
  unansweredInquiryCount: number;
};

export type DashboardQueueItem = {
  queueKey: "await_invoice" | "claim_cancel" | "claim_return" | "claim_exchange" | "await_fee";
  label: string;
  count: number;
  /** 눌렀을 때 갈 관리자 화면 */
  href: string;
};

export type DashboardDailyRevenue = {
  /** YYYY-MM-DD (KST) */
  reportDate: string;
  weekdayLabel: string;
  revenue: number;
  orderCount: number;
  /** 전주 같은 요일 매출 — 비교 막대 */
  previousWeekRevenue: number;
};

export type DashboardBreakdownItem = { label: string; amount: number; ratio: number };

export type DashboardLowStockItem = {
  variantId: number;
  productId: number;
  productName: string;
  /** 옵션 조합("24개입 · 선물 포장") 또는 SKU. 둘 다 없으면 단일 상품이라 null */
  variantLabel: string | null;
  stock: number;
};

export type DashboardBestSeller = { productId: number; productName: string; soldQuantity: number };

export type DashboardInquiry = {
  postId: number;
  title: string;
  /** 본문 한 줄 요약 — 제목만으로는 "aaaaa" 같은 글이 무엇인지 알 수 없다 */
  contentPreview: string;
  categoryCode: string | null;
  isAnswered: boolean;
  createdAt: Date;
  /** 상품 문의면 상품명 */
  productName: string | null;
  /** 클릭 시 이동할 곳 — 어느 메뉴인지는 서버가 정한다 */
  href: string;
};

/** 문의 처리 대기 — 메뉴별 건수. 총합 하나로는 어디를 열어야 할지 모른다 */
export type DashboardInquiryQueueItem = {
  inquiryKind: "product" | "direct" | "bulk";
  label: string;
  href: string;
  count: number;
};

export type AdminDashboard = {
  kpi: DashboardKpi;
  queue: DashboardQueueItem[];
  /** 최근 7일(오늘 포함) 일별 매출 */
  dailyRevenue: DashboardDailyRevenue[];
  weekRevenueTotal: number;
  /** 객단가 — 최근 7일 매출 / 주문 수 */
  averageOrderValue: number;
  /** 최근 30일 클레임 건수 / 주문 건수 */
  claimRate: number;
  categoryRevenue: DashboardBreakdownItem[];
  paymentMethodShare: DashboardBreakdownItem[];
  /** 최근 7일 주문의 시간대 분포(4시간 6구간) */
  hourlyOrders: { label: string; count: number }[];
  lowStock: DashboardLowStockItem[];
  bestSellers: DashboardBestSeller[];
  /** 문의 처리 대기 — 처리 대기열 아래에 온다 */
  inquiryQueue: DashboardInquiryQueueItem[];
  recentInquiries: DashboardInquiry[];
  excludedMetrics: typeof EXCLUDED_METRICS;
};

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 4시간 6구간 — 목업의 새벽/오전/점심/오후/저녁/야간 */
const HOUR_SLOTS: { label: string; startHour: number }[] = [
  { label: "새벽", startHour: 0 },
  { label: "오전", startHour: 4 },
  { label: "점심", startHour: 8 },
  { label: "오후", startHour: 12 },
  { label: "저녁", startHour: 16 },
  { label: "야간", startHour: 20 },
];

function toRatio(amount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((amount / total) * 100);
}

export async function getAdminDashboard(database: DatabaseClient): Promise<AdminDashboard> {
  const revenueOrderFilter = inArray(orders.status, [...REVENUE_ORDER_STATUSES]);

  // ── 오늘·어제 KPI (한 쿼리로 두 날을 함께)
  const [todayRow] = await database
    .select({
      todayOrderCount: sql<number>`count(*) filter (where ${kstDate(orders.createdAt)} = ${kstToday})::int`,
      todayRevenue: sql<number>`coalesce(sum(${orders.grandTotal}) filter (where ${kstDate(orders.createdAt)} = ${kstToday}), 0)::int`,
      yesterdayOrderCount: sql<number>`count(*) filter (where ${kstDate(orders.createdAt)} = ${kstToday} - 1)::int`,
      yesterdayRevenue: sql<number>`coalesce(sum(${orders.grandTotal}) filter (where ${kstDate(orders.createdAt)} = ${kstToday} - 1), 0)::int`,
    })
    .from(orders)
    .where(and(revenueOrderFilter, gte(kstDate(orders.createdAt), sql`${kstToday} - 1`)));

  // ── 처리 대기열
  // 배송준비인데 송장이 없는 주문 — 오늘 반드시 해야 하는 일
  const [awaitInvoiceRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(orders)
    .leftJoin(shipment, and(eq(shipment.orderId, orders.id), isNull(shipment.claimId)))
    .where(and(eq(orders.status, "preparing"), isNull(shipment.trackingNo)));

  const claimQueueRows = await database
    .select({ claimType: claim.type, total: sql<number>`count(*)::int` })
    .from(claim)
    .where(inArray(claim.status, ["requested", "collecting", "inspecting"]))
    .groupBy(claim.type);

  // 교환 배송비 입금 대기 — 상태만 봐서는 안 보이는 대기열
  const [awaitFeeRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(claim)
    .where(
      and(
        eq(claim.feeMethod, "bank_transfer"),
        isNull(claim.feeSettledAt),
        inArray(claim.status, ["requested", "collecting", "inspecting"]),
      ),
    );

  const claimCountOf = (claimType: ClaimType) =>
    claimQueueRows.find((row) => row.claimType === claimType)?.total ?? 0;

  const queue: DashboardQueueItem[] = [
    {
      queueKey: "await_invoice",
      label: "송장 등록 대기",
      count: awaitInvoiceRow?.total ?? 0,
      href: "/admin/orders?tab=preparing",
    },
    {
      queueKey: "claim_cancel",
      label: `${claimTypeLabel("cancel")} 요청`,
      count: claimCountOf("cancel"),
      href: "/admin/claims",
    },
    {
      queueKey: "claim_return",
      label: `${claimTypeLabel("return")} 진행`,
      count: claimCountOf("return"),
      href: "/admin/claims",
    },
    {
      queueKey: "claim_exchange",
      label: `${claimTypeLabel("exchange")} 진행`,
      count: claimCountOf("exchange"),
      href: "/admin/claims",
    },
    {
      queueKey: "await_fee",
      label: "배송비 입금 대기",
      count: awaitFeeRow?.total ?? 0,
      href: "/admin/claims",
    },
  ];

  // ── 미답변 문의(qna 게시판)
  const [inquiryRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(post)
    .innerJoin(board, eq(post.boardId, board.id))
    .where(and(eq(board.type, "qna"), eq(post.isAnswered, false)));

  // ── 최근 7일 매출 (전주 동요일 비교를 위해 14일을 읽는다)
  const dailyRows = await database
    .select({
      reportDate: sql<string>`to_char(${kstDate(orders.createdAt)}, 'YYYY-MM-DD')`,
      revenue: sql<number>`coalesce(sum(${orders.grandTotal}), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(revenueOrderFilter, gte(kstDate(orders.createdAt), sql`${kstToday} - 13`)))
    .groupBy(kstDate(orders.createdAt));

  const revenueByDate = new Map(dailyRows.map((row) => [row.reportDate, row]));
  const todayKst = new Date(
    new Date().toLocaleString("en-US", { timeZone: REPORT_TIME_ZONE }),
  );
  const toDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const dailyRevenue: DashboardDailyRevenue[] = [];
  for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
    const targetDate = new Date(todayKst);
    targetDate.setDate(todayKst.getDate() - dayOffset);
    const previousWeekDate = new Date(targetDate);
    previousWeekDate.setDate(targetDate.getDate() - 7);

    const current = revenueByDate.get(toDateKey(targetDate));
    dailyRevenue.push({
      reportDate: toDateKey(targetDate),
      weekdayLabel: WEEKDAY_LABELS[targetDate.getDay()],
      revenue: current?.revenue ?? 0,
      orderCount: current?.orderCount ?? 0,
      previousWeekRevenue: revenueByDate.get(toDateKey(previousWeekDate))?.revenue ?? 0,
    });
  }

  const weekRevenueTotal = dailyRevenue.reduce((sum, row) => sum + row.revenue, 0);
  const weekOrderCount = dailyRevenue.reduce((sum, row) => sum + row.orderCount, 0);
  const averageOrderValue = weekOrderCount === 0 ? 0 : Math.round(weekRevenueTotal / weekOrderCount);

  // ── 최근 30일 클레임율
  const [monthOrderRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(revenueOrderFilter, gte(kstDate(orders.createdAt), sql`${kstToday} - 29`)));
  const [monthClaimRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(claim)
    .where(gte(kstDate(claim.createdAt), sql`${kstToday} - 29`));
  const claimRate =
    (monthOrderRow?.total ?? 0) === 0
      ? 0
      : Math.round(((monthClaimRow?.total ?? 0) / monthOrderRow.total) * 1000) / 10;

  // ── 최근 30일 카테고리별 매출 (상품이 여러 카테고리에 걸리면 각각에 계상된다)
  const categoryRows = await database
    .select({
      label: category.name,
      amount: sql<number>`coalesce(sum(${orderItem.lineTotal}), 0)::int`,
    })
    .from(orderItem)
    .innerJoin(orders, eq(orderItem.orderId, orders.id))
    .innerJoin(product, eq(orderItem.productId, product.id))
    .innerJoin(productCategory, eq(productCategory.productId, product.id))
    .innerJoin(category, eq(productCategory.categoryId, category.id))
    .where(
      and(
        revenueOrderFilter,
        isNull(category.parentId), // 대분류로 묶는다 — 중분류까지 나누면 조각이 너무 잘다
        gte(kstDate(orders.createdAt), sql`${kstToday} - 29`),
      ),
    )
    .groupBy(category.name)
    .orderBy(desc(sql`coalesce(sum(${orderItem.lineTotal}), 0)`))
    .limit(6);
  const categoryTotal = categoryRows.reduce((sum, row) => sum + row.amount, 0);

  // ── 최근 30일 결제수단 비중
  const paymentRows = await database
    .select({
      label: sql<string>`coalesce(${payment.method}, '미확인')`,
      amount: sql<number>`coalesce(sum(${payment.amount}), 0)::int`,
    })
    .from(payment)
    .where(
      and(
        inArray(payment.status, ["paid", "partial_cancelled"]),
        gte(kstDate(payment.createdAt), sql`${kstToday} - 29`),
      ),
    )
    .groupBy(sql`coalesce(${payment.method}, '미확인')`);
  const paymentTotal = paymentRows.reduce((sum, row) => sum + row.amount, 0);

  // ── 최근 7일 시간대 분포
  const hourRows = await database
    .select({
      slotIndex: kstHourSlot(orders.createdAt).mapWith(Number),
      total: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(and(revenueOrderFilter, gte(kstDate(orders.createdAt), sql`${kstToday} - 6`)))
    .groupBy(kstHourSlot(orders.createdAt));

  const hourlyOrders = HOUR_SLOTS.map((slot, slotIndex) => ({
    label: slot.label,
    count: Number(hourRows.find((row) => Number(row.slotIndex) === slotIndex)?.total ?? 0),
  }));

  // ── 재고 부족 (판매중 상품의 살아있는 판매 단위)
  //
  // 옵션 조합을 라벨로 만든다 — SKU는 비어 있을 수 있어서, 같은 상품의 여러 판매 단위가
  // 목록에서 전부 똑같이 보인다("통밀 오트 쿠키 세트"만 세 줄). 어느 옵션이 품절인지
  // 모르면 이 목록은 아무것도 알려주지 않는다.
  const lowStockRows = await database
    .select({
      variantId: productVariant.id,
      productId: product.id,
      productName: product.name,
      sku: productVariant.sku,
      stock: productVariant.stock,
      optionLabel: sql<string | null>`(
        select string_agg(pov.value, ' · ' order by po.position, po.id)
        from ${variantOptionValue} vov
        join ${productOptionValue} pov on pov.id = vov.option_value_id
        join ${productOption} po on po.id = pov.option_id
        where vov.variant_id = ${productVariant.id}
      )`,
    })
    .from(productVariant)
    .innerJoin(product, eq(productVariant.productId, product.id))
    .where(
      and(
        eq(product.status, "active"),
        isNull(product.deletedAt),
        isNull(productVariant.deletedAt),
        eq(productVariant.isActive, true),
        lt(productVariant.stock, 6),
      ),
    )
    .orderBy(productVariant.stock, product.id)
    .limit(8);

  // ── 최근 30일 베스트셀러 (실제 판매 수량 — salesCount 캐시가 아니라 원장에서)
  const bestSellerRows = await database
    .select({
      productId: product.id,
      productName: product.name,
      soldQuantity: sql<number>`coalesce(sum(${orderItem.quantity}), 0)::int`,
    })
    .from(orderItem)
    .innerJoin(orders, eq(orderItem.orderId, orders.id))
    .innerJoin(product, eq(orderItem.productId, product.id))
    .where(and(revenueOrderFilter, gte(kstDate(orders.createdAt), sql`${kstToday} - 29`)))
    .groupBy(product.id, product.name)
    .orderBy(desc(sql`coalesce(sum(${orderItem.quantity}), 0)`))
    .limit(5);

  // ── 문의 처리 대기 (메뉴별 건수)
  // 총합 하나로는 어디를 열어야 할지 모른다 — 메뉴별로 쪼개야 바로 그 화면으로 갈 수 있다.
  // 대기 0인 줄도 남긴다: 사라지면 "그 메뉴가 없는 건지 0인 건지"를 구분할 수 없다.
  const [qnaWaitingRow] = await database
    .select({
      product: sql<number>`count(*) filter (where ${post.productId} is not null)::int`,
      direct: sql<number>`count(*) filter (where ${post.productId} is null)::int`,
    })
    .from(post)
    .innerJoin(board, eq(post.boardId, board.id))
    .where(and(eq(board.type, "qna"), eq(post.isAnswered, false)));

  // received = 아직 아무도 연락하지 않은 건. contacted·closed는 손이 간 상태다
  const [bulkWaitingRow] = await database
    .select({ waiting: count() })
    .from(bulkInquiry)
    .where(eq(bulkInquiry.status, "received"));

  const inquiryQueue = [
    {
      inquiryKind: "product" as const,
      label: "상품 문의",
      href: "/admin/inquiries/product",
      count: Number(qnaWaitingRow?.product ?? 0),
    },
    {
      inquiryKind: "direct" as const,
      label: "1:1 문의",
      href: "/admin/inquiries/direct",
      count: Number(qnaWaitingRow?.direct ?? 0),
    },
    {
      inquiryKind: "bulk" as const,
      label: "단체구매 문의",
      href: "/admin/inquiries/bulk",
      count: Number(bulkWaitingRow?.waiting ?? 0),
    },
  ];

  // ── 최근 문의 (본문 미리보기 포함 · 7건)
  // 제목만으로는 "aaaaa" 같은 글이 무엇인지 알 수 없어 목록을 훑는 뜻이 없다.
  const recentInquiryRows = await database
    .select({
      postId: post.id,
      title: post.title,
      content: post.content,
      categoryCode: post.categoryCode,
      isAnswered: post.isAnswered,
      createdAt: post.createdAt,
      productId: post.productId,
      productName: product.name,
    })
    .from(post)
    .innerJoin(board, eq(post.boardId, board.id))
    .leftJoin(product, eq(post.productId, product.id))
    .where(eq(board.type, "qna"))
    .orderBy(desc(post.id))
    .limit(7);

  const recentInquiries = recentInquiryRows.map((row) => ({
    postId: row.postId,
    title: row.title,
    // 본문은 한 줄로 줄여 보낸다 — 전문을 내리면 대시보드가 무거워지고 화면도 넘친다
    contentPreview:
      row.content.replace(/\s+/g, " ").trim().slice(0, 60) +
      (row.content.replace(/\s+/g, " ").trim().length > 60 ? "…" : ""),
    categoryCode: row.categoryCode,
    isAnswered: row.isAnswered,
    createdAt: row.createdAt,
    productName: row.productName,
    // 어느 메뉴로 보내야 하는지 서버가 정한다 — 화면이 product_id로 다시 추론하면 규칙이 갈린다
    href: `/admin/inquiries/${row.productId === null ? "direct" : "product"}?post=${row.postId}`,
  }));

  return {
    kpi: {
      todayOrderCount: Number(todayRow?.todayOrderCount ?? 0),
      todayRevenue: Number(todayRow?.todayRevenue ?? 0),
      yesterdayOrderCount: Number(todayRow?.yesterdayOrderCount ?? 0),
      yesterdayRevenue: Number(todayRow?.yesterdayRevenue ?? 0),
      pendingTaskCount: queue.reduce((sum, item) => sum + item.count, 0),
      unansweredInquiryCount: Number(inquiryRow?.total ?? 0),
    },
    queue,
    dailyRevenue,
    weekRevenueTotal,
    averageOrderValue,
    claimRate,
    categoryRevenue: categoryRows.map((row) => ({
      label: row.label,
      amount: row.amount,
      ratio: toRatio(row.amount, categoryTotal),
    })),
    paymentMethodShare: paymentRows.map((row) => ({
      label: row.label,
      amount: row.amount,
      ratio: toRatio(row.amount, paymentTotal),
    })),
    hourlyOrders,
    lowStock: lowStockRows.map((row) => ({
      variantId: row.variantId,
      productId: row.productId,
      productName: row.productName,
      variantLabel: row.optionLabel ?? row.sku,
      stock: row.stock,
    })),
    bestSellers: bestSellerRows,
    inquiryQueue,
    recentInquiries,
    excludedMetrics: EXCLUDED_METRICS,
  };
}
