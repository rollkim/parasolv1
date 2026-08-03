import "server-only";

import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { address, customer, customerAuth, customerGrade, orders } from "@/db/schema";
import { formatPhone } from "@/domain/phone";

import type { DatabaseClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 관리자 회원 관리 — 목록·상세·메모·계정 상태·강제 탈퇴.
 *
 * **등급 수동 변경 버튼은 없다.** 등급은 일일 배치(ops:daily)가 기준대로 정한다 —
 * 수동으로 바꿔도 다음 산정에서 되돌아가므로 버튼은 거짓 약속이 된다. 특정 회원을
 * 우대하려면 등급이 아니라 쿠폰·수동 적립으로 한다.
 *
 * 회원 상태는 두 축이다: is_active(정지 여부) · deleted_at(탈퇴 여부).
 * 정지는 되돌릴 수 있고, 탈퇴는 개인정보를 지우므로 되돌릴 수 없다.
 */

export type AdminCustomerTab = "all" | "active" | "suspended" | "withdrawn";
export type AdminCustomerSort = "recent" | "spending" | "orderCount";

export type AdminCustomerCard = {
  customerId: number;
  name: string;
  email: string | null;
  phone: string | null;
  joinedAt: Date;
  /** 등급 이름 — null이면 기본 등급(미배정) */
  gradeName: string | null;
  orderCount: number;
  totalSpending: number;
  isActive: boolean;
  isWithdrawn: boolean;
  statusLabel: string;
};

export type AdminCustomerListResult = {
  cards: AdminCustomerCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  tabCounts: Record<AdminCustomerTab, number>;
};

const ADMIN_CUSTOMER_PAGE_SIZE = 20;

/** 누적 구매액으로 인정하는 주문 상태 — 취소는 제외한다 */
const SPENDING_ORDER_STATUSES = ["paid", "preparing", "shipping", "delivered", "confirmed"] as const;

function customerStatusLabel(input: { isActive: boolean; isWithdrawn: boolean }): string {
  if (input.isWithdrawn) return "탈퇴";
  return input.isActive ? "정상" : "정지";
}

export async function listAdminCustomers(
  database: DatabaseClient,
  input: {
    tab?: AdminCustomerTab;
    keyword?: string;
    sort?: AdminCustomerSort;
    page?: number;
  } = {},
): Promise<AdminCustomerListResult> {
  const tab = input.tab ?? "all";
  const sort = input.sort ?? "recent";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  // 주문 집계는 서브쿼리로 — 목록 정렬(누적구매·주문수)에도 함께 쓴다
  const orderSummary = database
    .select({
      customerId: orders.customerId,
      orderCount: sql<number>`count(*)::int`.as("order_count"),
      totalSpending: sql<number>`coalesce(sum(${orders.grandTotal}), 0)::int`.as("total_spending"),
    })
    .from(orders)
    .where(and(isNotNull(orders.customerId), inArray(orders.status, [...SPENDING_ORDER_STATUSES])))
    .groupBy(orders.customerId)
    .as("order_summary");

  const orderCountExpression = sql<number>`coalesce(${orderSummary.orderCount}, 0)`;
  const spendingExpression = sql<number>`coalesce(${orderSummary.totalSpending}, 0)`;

  const tabFilter =
    tab === "all"
      ? undefined
      : tab === "withdrawn"
        ? isNotNull(customer.deletedAt)
        : tab === "suspended"
          ? and(isNull(customer.deletedAt), eq(customer.isActive, false))
          : and(isNull(customer.deletedAt), eq(customer.isActive, true));

  const keywordFilter = keyword
    ? or(
        ilike(customer.name, `%${keyword}%`),
        ilike(customer.email, `%${keyword}%`),
        // 연락처는 정규화 저장이라 입력의 하이픈을 떼고 비교한다
        ilike(customer.phone, `%${keyword.replace(/[^0-9]/g, "")}%`),
      )
    : undefined;

  const listFilter = and(tabFilter, keywordFilter);

  const [totalRow] = await database
    .select({ total: count() })
    .from(customer)
    .leftJoin(orderSummary, eq(orderSummary.customerId, customer.id))
    .where(listFilter);

  const customerRows = await database
    .select({
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      joinedAt: customer.createdAt,
      gradeName: customerGrade.name,
      isActive: customer.isActive,
      deletedAt: customer.deletedAt,
      orderCount: orderCountExpression,
      totalSpending: spendingExpression,
    })
    .from(customer)
    .leftJoin(orderSummary, eq(orderSummary.customerId, customer.id))
    .leftJoin(customerGrade, eq(customer.gradeId, customerGrade.id))
    .where(listFilter)
    .orderBy(
      sort === "spending"
        ? desc(spendingExpression)
        : sort === "orderCount"
          ? desc(orderCountExpression)
          : desc(customer.id),
    )
    .limit(ADMIN_CUSTOMER_PAGE_SIZE)
    .offset((page - 1) * ADMIN_CUSTOMER_PAGE_SIZE);

  const [tabCountRow] = await database
    .select({
      all: count(),
      active: sql<number>`count(*) filter (where ${customer.deletedAt} is null and ${customer.isActive})::int`,
      suspended: sql<number>`count(*) filter (where ${customer.deletedAt} is null and not ${customer.isActive})::int`,
      withdrawn: sql<number>`count(*) filter (where ${customer.deletedAt} is not null)::int`,
    })
    .from(customer);

  return {
    cards: customerRows.map((row) => {
      const isWithdrawn = row.deletedAt !== null;
      return {
        customerId: row.customerId,
        name: row.name,
        email: row.email,
        // CS가 보고 전화하는 화면이라 하이픈을 붙인다(저장은 정규화)
        phone: row.phone ? formatPhone(row.phone) : null,
        joinedAt: row.joinedAt,
        gradeName: row.gradeName,
        orderCount: Number(row.orderCount),
        totalSpending: Number(row.totalSpending),
        isActive: row.isActive,
        isWithdrawn,
        statusLabel: customerStatusLabel({ isActive: row.isActive, isWithdrawn }),
      };
    }),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_CUSTOMER_PAGE_SIZE,
    tabCounts: {
      all: tabCountRow?.all ?? 0,
      active: Number(tabCountRow?.active ?? 0),
      suspended: Number(tabCountRow?.suspended ?? 0),
      withdrawn: Number(tabCountRow?.withdrawn ?? 0),
    },
  };
}

export class AdminCustomerNotFoundError extends Error {
  constructor(readonly customerId: number) {
    super(`회원을 찾을 수 없습니다: id=${customerId}`);
    this.name = "AdminCustomerNotFoundError";
  }
}

export class CustomerAlreadyWithdrawnError extends Error {
  constructor() {
    super("이미 탈퇴 처리된 회원입니다.");
    this.name = "CustomerAlreadyWithdrawnError";
  }
}

export type AdminCustomerDetail = {
  customerId: number;
  name: string;
  email: string | null;
  phone: string | null;
  joinedAt: Date;
  isActive: boolean;
  isWithdrawn: boolean;
  statusLabel: string;
  /** 등급 이름 — null이면 기본 등급(미배정). 변경은 배치 몫이라 편집 UI가 없다 */
  gradeName: string | null;
  adminMemo: string | null;
  marketing: { smsAgreed: boolean; emailAgreed: boolean };
  loginProviders: string[];
  orderSummary: { orderCount: number; totalSpending: number };
  recentOrders: {
    orderNo: string;
    orderStatus: string;
    grandTotal: number;
    orderedAt: Date;
  }[];
  addresses: {
    addressId: number;
    label: string | null;
    recipient: string;
    phone: string;
    zipcode: string;
    addr1: string;
    addr2: string | null;
    isDefault: boolean;
  }[];
};

/** 관리자 상세 — 고객 화면과 달리 마스킹하지 않는다(CS가 연락처로 전화한다) */
export async function getAdminCustomerDetail(
  database: DatabaseClient,
  customerId: number,
): Promise<AdminCustomerDetail> {
  const [row] = await database
    .select()
    .from(customer)
    .where(eq(customer.id, customerId))
    .limit(1);
  if (!row) throw new AdminCustomerNotFoundError(customerId);

  const [summaryRow] = await database
    .select({
      orderCount: sql<number>`count(*)::int`,
      totalSpending: sql<number>`coalesce(sum(${orders.grandTotal}), 0)::int`,
    })
    .from(orders)
    .where(
      and(eq(orders.customerId, customerId), inArray(orders.status, [...SPENDING_ORDER_STATUSES])),
    );

  const recentOrders = await database
    .select({
      orderNo: orders.orderNo,
      orderStatus: orders.status,
      grandTotal: orders.grandTotal,
      orderedAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.id))
    .limit(5);

  const addressRows = await database
    .select({
      addressId: address.id,
      label: address.label,
      recipient: address.recipient,
      phone: address.phone,
      zipcode: address.zipcode,
      addr1: address.addr1,
      addr2: address.addr2,
      isDefault: address.isDefault,
    })
    .from(address)
    .where(eq(address.customerId, customerId))
    .orderBy(desc(address.isDefault), address.id);

  const authRows = await database
    .select({ provider: customerAuth.provider })
    .from(customerAuth)
    .where(eq(customerAuth.customerId, customerId));

  const [gradeRow] =
    row.gradeId !== null
      ? await database
          .select({ gradeName: customerGrade.name })
          .from(customerGrade)
          .where(eq(customerGrade.id, row.gradeId))
          .limit(1)
      : [];

  const isWithdrawn = row.deletedAt !== null;

  return {
    customerId: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ? formatPhone(row.phone) : null,
    joinedAt: row.createdAt,
    isActive: row.isActive,
    isWithdrawn,
    statusLabel: customerStatusLabel({ isActive: row.isActive, isWithdrawn }),
    gradeName: gradeRow?.gradeName ?? null,
    adminMemo: row.adminMemo,
    marketing: {
      smsAgreed: row.marketingSmsAgreedAt !== null,
      emailAgreed: row.marketingEmailAgreedAt !== null,
    },
    loginProviders: authRows.map((authRow) => authRow.provider),
    orderSummary: {
      orderCount: Number(summaryRow?.orderCount ?? 0),
      totalSpending: Number(summaryRow?.totalSpending ?? 0),
    },
    recentOrders,
    addresses: addressRows.map((addressRow) => ({
      ...addressRow,
      phone: formatPhone(addressRow.phone),
    })),
  };
}

/** 내부 메모 — CS 특이사항. 회원에게는 보이지 않는다 */
export async function saveAdminCustomerMemo(
  database: DatabaseClient,
  input: { customerId: number; memo: string },
): Promise<{ customerId: number }> {
  const memo = input.memo.trim();
  const updated = await database
    .update(customer)
    .set({ adminMemo: memo.length > 0 ? memo : null })
    .where(eq(customer.id, input.customerId))
    .returning({ id: customer.id });
  if (updated.length === 0) throw new AdminCustomerNotFoundError(input.customerId);
  return { customerId: updated[0].id };
}

/** 계정 정지·해제 — 되돌릴 수 있는 조치다(탈퇴와 다르다) */
export async function changeAdminCustomerActive(
  database: DatabaseClient,
  input: { customerId: number; isActive: boolean },
): Promise<{ customerId: number; isActive: boolean }> {
  const updated = await database
    .update(customer)
    .set({ isActive: input.isActive })
    .where(and(eq(customer.id, input.customerId), isNull(customer.deletedAt)))
    .returning({ id: customer.id, isActive: customer.isActive });
  if (updated.length === 0) throw new AdminCustomerNotFoundError(input.customerId);
  return { customerId: updated[0].id, isActive: updated[0].isActive };
}

export type WithdrawCustomerResult = {
  customerId: number;
  removedAddressCount: number;
  removedAuthCount: number;
};

/**
 * 강제 탈퇴 — **개인정보를 지우고 주문 이력은 남긴다**(스키마 customer.deleted_at 규약).
 *
 * 지우는 것: 이름·이메일·연락처(회원 행), 배송지 전체, 로그인 수단.
 * 남기는 것: 주문(order에 주문자 정보가 스냅샷돼 있어 배송·CS·정산이 계속 가능하다),
 *            관리자 메모(분쟁 대응 기록).
 *
 * 로그인 수단을 지우는 것이 핵심이다 — 회원 행만 소프트 삭제하면 소셜 로그인으로 다시
 * 들어와 같은 계정이 되살아난다.
 */
export async function withdrawAdminCustomer(
  database: DatabaseClient,
  input: { customerId: number; actor: TransitionActor },
): Promise<WithdrawCustomerResult> {
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: customer.id, deletedAt: customer.deletedAt })
      .from(customer)
      .where(eq(customer.id, input.customerId))
      .for("update")
      .limit(1);
    if (!existing) throw new AdminCustomerNotFoundError(input.customerId);
    if (existing.deletedAt !== null) throw new CustomerAlreadyWithdrawnError();

    const removedAddresses = await tx
      .delete(address)
      .where(eq(address.customerId, input.customerId))
      .returning({ id: address.id });

    const removedAuths = await tx
      .delete(customerAuth)
      .where(eq(customerAuth.customerId, input.customerId))
      .returning({ id: customerAuth.id });

    await tx
      .update(customer)
      .set({
        name: "탈퇴회원",
        email: null,
        phone: null,
        isActive: false,
        marketingSmsAgreedAt: null,
        marketingEmailAgreedAt: null,
        deletedAt: sql`now()`,
        adminMemo: sql`coalesce(${customer.adminMemo} || E'\n', '') || ${`관리자 강제 탈퇴 (${serializeActor(input.actor)})`}`,
      })
      .where(eq(customer.id, input.customerId));

    return {
      customerId: input.customerId,
      removedAddressCount: removedAddresses.length,
      removedAuthCount: removedAuths.length,
    };
  });
}
