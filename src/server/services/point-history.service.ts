import "server-only";

import { and, count, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";

import { orders, pointTransaction } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { getPointBalance, getUsablePointBalance } from "./point.service";

/**
 * 고객용 적립금 내역 — 마이페이지.
 *
 * 원장(point_transaction)을 그대로 보여준다. 잔액만 보여주면 "왜 줄었는지"를 물어볼 수밖에
 * 없고, 그 문의는 운영자가 DB를 열어야 답할 수 있다. 내역이 있으면 고객이 스스로 확인한다.
 */

const POINT_HISTORY_PAGE_SIZE = 20;

export type PointHistoryRow = {
  transactionId: number;
  /** 화면에 그대로 보이는 문장 — 원장이 저장한 title */
  title: string;
  /** 적립 +, 사용·소멸·회수 − */
  amount: number;
  balanceAfter: number;
  /** 이 적립분이 언제 소멸하는지 — 사용·소멸 행은 null */
  expiresAt: Date | null;
  /** 남은 적립분 — 적립 행만. 0이면 다 썼거나 소멸했다 */
  remainingAmount: number | null;
  orderNo: string | null;
  createdAt: Date;
};

export type PointSummary = {
  /** 보유(만료분 포함) — 화면에는 '보유 적립금'으로 보인다 */
  balance: number;
  /** 지금 쓸 수 있는 금액 — 결제에 쓰이는 값 */
  usableBalance: number;
  /** 30일 안에 소멸할 금액 — 있으면 화면이 알린다("쓸 수 있었는데 날아갔다"를 막는다) */
  expiringSoonAmount: number;
};

export async function getPointSummary(
  database: DatabaseClient,
  customerId: number,
): Promise<PointSummary> {
  const [balance, usableBalance] = [
    await getPointBalance(database, customerId),
    await getUsablePointBalance(database, customerId),
  ];

  const [soonRow] = await database
    .select({
      total: sql<number>`coalesce(sum(${pointTransaction.remainingAmount}), 0)::int`,
    })
    .from(pointTransaction)
    .where(
      and(
        eq(pointTransaction.customerId, customerId),
        gt(pointTransaction.remainingAmount, 0),
        isNotNull(pointTransaction.expiresAt),
        gt(pointTransaction.expiresAt, sql`now()`),
        lte(pointTransaction.expiresAt, sql`now() + interval '30 days'`),
      ),
    );

  return {
    balance,
    usableBalance,
    expiringSoonAmount: Number(soonRow?.total ?? 0),
  };
}

export async function getPointHistory(
  database: DatabaseClient,
  input: { customerId: number; page?: number },
): Promise<{
  rows: PointHistoryRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const listFilter = eq(pointTransaction.customerId, input.customerId);

  const [totalRow] = await database
    .select({ total: count() })
    .from(pointTransaction)
    .where(listFilter);

  const rows = await database
    .select({
      transactionId: pointTransaction.id,
      title: pointTransaction.title,
      amount: pointTransaction.amount,
      balanceAfter: pointTransaction.balanceAfter,
      expiresAt: pointTransaction.expiresAt,
      remainingAmount: pointTransaction.remainingAmount,
      orderNo: orders.orderNo,
      createdAt: pointTransaction.createdAt,
    })
    .from(pointTransaction)
    // 주문이 지워져도 내역은 남는다(order_id는 set null) — 그때는 주문번호 칸만 빈다
    .leftJoin(orders, eq(pointTransaction.orderId, orders.id))
    .where(listFilter)
    .orderBy(desc(pointTransaction.id))
    .limit(POINT_HISTORY_PAGE_SIZE)
    .offset((page - 1) * POINT_HISTORY_PAGE_SIZE);

  return {
    rows,
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: POINT_HISTORY_PAGE_SIZE,
  };
}
