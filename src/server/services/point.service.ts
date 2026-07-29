import "server-only";

import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";

import { customer, pointTransaction } from "@/db/schema";
import { planFifoDeduction, type PointLot } from "@/domain/point";

import type { QueryClient, TransactionClient } from "./db-client";

/**
 * 적립금 원장 — 적립·사용·복원·소멸이 모두 여기를 지난다(초크포인트).
 *
 * 규약 3가지:
 *  1. **원장이 진실, 잔액은 캐시.** point_transaction은 append-only고 customer.point_balance는
 *     빠른 조회용 사본이다. 둘은 같은 트랜잭션에서만 함께 움직인다.
 *  2. **잔액은 조건부 UPDATE로만 깎는다** — `SET balance = balance - n WHERE balance >= n`.
 *     조회 후 차감(read-modify-write)하면 동시 요청 둘이 같은 잔액을 읽고 각자 깎는다(RULE-11).
 *     이 UPDATE가 customer 행을 잠그므로, 같은 회원의 두 번째 요청은 첫 번째가 끝날 때까지
 *     기다린다 — 뒤이어 만지는 적립분(lot)들도 덩달아 보호된다.
 *  3. **중복 적립은 dedupe_key 유니크 인덱스가 막는다.** 아래 SELECT 사전 확인은 흔한 경로를
 *     빠르게 끝내려는 것일 뿐, 진짜 보증은 인덱스다. 동시 요청 둘이 SELECT를 나란히 통과해도
 *     INSERT 하나가 실패하며 그 트랜잭션 전체가 되돌아간다(돈이 두 배 되는 대신 실패한다).
 */

export class PointBalanceShortageError extends Error {
  constructor() {
    super("적립금 잔액이 부족합니다. 사용 금액을 다시 확인해 주세요.");
    this.name = "PointBalanceShortageError";
  }
}

/** 원장 잔여 합계 < 잔액 캐시 — 데이터가 어긋난 상태다. 쓰게 두면 차이가 커지므로 막는다 */
export class PointLedgerDriftError extends Error {
  constructor(customerId: number, cause?: unknown) {
    super(
      `적립금 원장이 잔액과 맞지 않습니다(회원 ${customerId}). 관리자 확인이 필요합니다.`,
    );
    this.name = "PointLedgerDriftError";
    this.cause = cause;
  }
}

export type PointEarnInput = {
  customerId: number;
  amount: number;
  /** 화면에 그대로 보이는 문장 — 예: "구매 확정 적립 (1%)" */
  title: string;
  tagCode: string;
  orderId?: number | null;
  expiresAt: Date;
  /** 같은 사유로 두 번 적립되면 안 되는 건 반드시 채운다 — 예: `order:123:purchase` */
  dedupeKey?: string | null;
  createdBy?: string | null;
};

export type PointEarnResult =
  | { earned: true; transactionId: number; balanceAfter: number }
  | { earned: false; reason: "duplicate" | "zero_amount" };

/**
 * 쓸 수 있는 적립분 — **잔여가 남은 행이면 종류를 가리지 않는다.**
 *
 * 적립(earn)만 세면 반품 복원분(cancel, remaining_amount 있음)이 잔액에는 잡히는데
 * 결제에는 안 잡혀서, 고객은 잔액이 보이는데 쓸 수 없고 원장과 캐시가 갈라진다.
 * '적립분인가'는 type이 아니라 remaining_amount가 정한다 — type은 왜 생겼는지(화면 표시)를 담을 뿐이다.
 * FIFO 차감과 잔여 합계가 같은 조건을 보게 여기 한 곳에만 둔다.
 */
function spendableLotCondition(customerId: number) {
  return and(
    eq(pointTransaction.customerId, customerId),
    gt(pointTransaction.remainingAmount, 0),
  );
}

/** 잔액을 더하고(또는 빼고) 갱신된 값을 돌려준다 — 음수 잔액을 허용하는 경로에서만 쓴다 */
async function addBalance(
  tx: TransactionClient,
  customerId: number,
  delta: number,
): Promise<number> {
  const [updated] = await tx
    .update(customer)
    .set({ pointBalance: sql`${customer.pointBalance} + ${delta}` })
    .where(eq(customer.id, customerId))
    .returning({ pointBalance: customer.pointBalance });
  if (!updated) throw new Error(`회원을 찾을 수 없습니다: ${customerId}`);
  return updated.pointBalance;
}

/**
 * 적립 — 구매확정·리뷰·가입·이벤트 공통 입구.
 *
 * remaining_amount를 amount로 시작해 두면 FIFO 사용·소멸이 여기서 깎아 나간다.
 */
export async function earnPoints(
  tx: TransactionClient,
  input: PointEarnInput,
): Promise<PointEarnResult> {
  if (input.amount <= 0) return { earned: false, reason: "zero_amount" };

  if (input.dedupeKey) {
    const [alreadyEarned] = await tx
      .select({ id: pointTransaction.id })
      .from(pointTransaction)
      .where(eq(pointTransaction.dedupeKey, input.dedupeKey))
      .limit(1);
    if (alreadyEarned) return { earned: false, reason: "duplicate" };
  }

  const balanceAfter = await addBalance(tx, input.customerId, input.amount);

  const [inserted] = await tx
    .insert(pointTransaction)
    .values({
      customerId: input.customerId,
      type: "earn",
      amount: input.amount,
      remainingAmount: input.amount,
      balanceAfter,
      title: input.title,
      tagCode: input.tagCode,
      orderId: input.orderId ?? null,
      expiresAt: input.expiresAt,
      dedupeKey: input.dedupeKey ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: pointTransaction.id });

  return { earned: true, transactionId: inserted.id, balanceAfter };
}

/**
 * 사용 — 먼저 소멸할 적립분부터 깎는다(FIFO).
 *
 * 나중 것부터 쓰면 곧 소멸할 적립금이 그대로 사라져 고객이 "쓸 수 있었는데 날아갔다"를 겪는다.
 */
export async function usePoints(
  tx: TransactionClient,
  input: {
    customerId: number;
    amount: number;
    title: string;
    orderId?: number | null;
  },
): Promise<{ used: boolean; balanceAfter: number }> {
  if (input.amount <= 0) {
    const [row] = await tx
      .select({ pointBalance: customer.pointBalance })
      .from(customer)
      .where(eq(customer.id, input.customerId));
    return { used: false, balanceAfter: row?.pointBalance ?? 0 };
  }

  // ★동시성 차단 지점 — 잔액이 모자라면 여기서 0행이 되어 아래로 못 간다
  const [debited] = await tx
    .update(customer)
    .set({ pointBalance: sql`${customer.pointBalance} - ${input.amount}` })
    .where(
      and(
        eq(customer.id, input.customerId),
        sql`${customer.pointBalance} >= ${input.amount}`,
      ),
    )
    .returning({ pointBalance: customer.pointBalance });
  if (!debited) throw new PointBalanceShortageError();

  const lotRows = await tx
    .select({
      transactionId: pointTransaction.id,
      remainingAmount: pointTransaction.remainingAmount,
    })
    .from(pointTransaction)
    .where(spendableLotCondition(input.customerId))
    // 만료 임박순 → 같으면 오래된 순. expiresAt이 비어 있으면(무기한) 가장 뒤
    .orderBy(asc(pointTransaction.expiresAt), asc(pointTransaction.id));

  const lots: PointLot[] = lotRows.map((row) => ({
    transactionId: row.transactionId,
    remainingAmount: row.remainingAmount ?? 0,
  }));

  // 잔액은 통과했는데 적립분이 모자라면 캐시와 원장이 어긋난 것 — 트랜잭션째 되돌린다
  let deductions;
  try {
    deductions = planFifoDeduction(lots, input.amount);
  } catch (error) {
    throw new PointLedgerDriftError(input.customerId, error);
  }

  for (const deduction of deductions) {
    await tx
      .update(pointTransaction)
      .set({
        remainingAmount: sql`${pointTransaction.remainingAmount} - ${deduction.deductAmount}`,
      })
      .where(eq(pointTransaction.id, deduction.transactionId));
  }

  await tx.insert(pointTransaction).values({
    customerId: input.customerId,
    type: "use",
    amount: -input.amount,
    remainingAmount: null, // 사용 행은 남길 잔여가 없다
    balanceAfter: debited.pointBalance,
    title: input.title,
    tagCode: "use",
    orderId: input.orderId ?? null,
  });

  return { used: true, balanceAfter: debited.pointBalance };
}

/**
 * 사용 취소 복원 — 주문 취소·반품으로 되돌려주는 적립금.
 *
 * 원래 깎았던 적립분에 되돌리지 않고 **새 적립분으로 발행**한다. 어느 적립분에서 얼마를
 * 뺐는지 원장이 기억하지 않기 때문이다(그걸 남기려면 사용-적립 연결 테이블이 하나 더 필요하다).
 * 결과적으로 소멸 기한이 새로 시작되는데, 이건 고객에게 유리한 쪽이라 그대로 둔다 —
 * 금액은 쓴 만큼 정확히 돌아가고, 어긋나면 손해 보는 쪽이 몰이어야 한다.
 */
export async function restoreUsedPoints(
  tx: TransactionClient,
  input: {
    customerId: number;
    amount: number;
    title: string;
    orderId?: number | null;
    expiresAt: Date;
    dedupeKey?: string | null;
  },
): Promise<PointEarnResult> {
  if (input.amount <= 0) return { earned: false, reason: "zero_amount" };

  if (input.dedupeKey) {
    const [already] = await tx
      .select({ id: pointTransaction.id })
      .from(pointTransaction)
      .where(eq(pointTransaction.dedupeKey, input.dedupeKey))
      .limit(1);
    if (already) return { earned: false, reason: "duplicate" };
  }

  const balanceAfter = await addBalance(tx, input.customerId, input.amount);

  const [inserted] = await tx
    .insert(pointTransaction)
    .values({
      customerId: input.customerId,
      type: "cancel",
      amount: input.amount,
      remainingAmount: input.amount, // 다시 쓸 수 있어야 하므로 적립분으로 산다
      balanceAfter,
      title: input.title,
      tagCode: "use",
      orderId: input.orderId ?? null,
      expiresAt: input.expiresAt,
      dedupeKey: input.dedupeKey ?? null,
    })
    .returning({ id: pointTransaction.id });

  return { earned: true, transactionId: inserted.id, balanceAfter };
}

/**
 * 적립 회수 — 확정 후 반품처럼 이미 준 적립을 도로 걷는다.
 *
 * **잔액이 모자라도 회수한다(음수 허용).** 포기하면 "적립받고 반품"이 무한 반복되는 구멍이
 * 된다. 음수 잔액은 다음 적립으로 메워지고, 그동안 사용은 usePoints의 조건부 UPDATE가 막는다.
 *
 * 남아 있는 적립분(remaining_amount)도 함께 깎는다 — 안 깎으면 회수했는데도 그 적립분으로
 * 결제가 되어 잔액과 원장이 갈라진다.
 */
export async function clawbackPoints(
  tx: TransactionClient,
  input: {
    customerId: number;
    amount: number;
    title: string;
    orderId?: number | null;
    dedupeKey?: string | null;
  },
): Promise<PointEarnResult> {
  if (input.amount <= 0) return { earned: false, reason: "zero_amount" };

  if (input.dedupeKey) {
    const [already] = await tx
      .select({ id: pointTransaction.id })
      .from(pointTransaction)
      .where(eq(pointTransaction.dedupeKey, input.dedupeKey))
      .limit(1);
    if (already) return { earned: false, reason: "duplicate" };
  }

  const balanceAfter = await addBalance(tx, input.customerId, -input.amount);

  // 이 주문으로 준 적립분의 잔여부터 깎는다. 남은 만큼만 깎이고 모자라면 그대로 둔다
  // (이미 써버린 적립분은 회수할 잔여가 없다 — 그래서 잔액이 음수로 갈 수 있는 것)
  if (input.orderId) {
    const [earnedLot] = await tx
      .select({
        transactionId: pointTransaction.id,
        remainingAmount: pointTransaction.remainingAmount,
      })
      .from(pointTransaction)
      .where(
        and(
          eq(pointTransaction.customerId, input.customerId),
          eq(pointTransaction.orderId, input.orderId),
          eq(pointTransaction.type, "earn"),
          gt(pointTransaction.remainingAmount, 0),
        ),
      )
      .orderBy(asc(pointTransaction.id))
      .limit(1);

    if (earnedLot) {
      const deductable = Math.min(earnedLot.remainingAmount ?? 0, input.amount);
      await tx
        .update(pointTransaction)
        .set({
          remainingAmount: sql`${pointTransaction.remainingAmount} - ${deductable}`,
        })
        .where(eq(pointTransaction.id, earnedLot.transactionId));
    }
  }

  const [inserted] = await tx
    .insert(pointTransaction)
    .values({
      customerId: input.customerId,
      type: "cancel",
      amount: -input.amount,
      remainingAmount: null,
      balanceAfter,
      title: input.title,
      tagCode: "purchase",
      orderId: input.orderId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .returning({ id: pointTransaction.id });

  return { earned: true, transactionId: inserted.id, balanceAfter };
}

/**
 * 소멸 — 기한이 지난 적립분의 잔여를 0으로 만들고 원장에 기록한다.
 *
 * 회원 한 명 분량을 한 트랜잭션으로 처리한다. 전체를 한 트랜잭션에 묶으면 배치가 길어지는
 * 동안 모든 회원의 적립금 사용이 막힌다.
 */
export async function expirePointsForCustomer(
  tx: TransactionClient,
  input: { customerId: number; now: Date },
): Promise<{ expiredAmount: number; balanceAfter: number | null }> {
  const expiredLots = await tx
    .select({
      transactionId: pointTransaction.id,
      remainingAmount: pointTransaction.remainingAmount,
    })
    .from(pointTransaction)
    .where(
      and(
        eq(pointTransaction.customerId, input.customerId),
        gt(pointTransaction.remainingAmount, 0),
        isNotNull(pointTransaction.expiresAt),
        lte(pointTransaction.expiresAt, input.now),
      ),
    );

  const expiredAmount = expiredLots.reduce(
    (sum, lot) => sum + (lot.remainingAmount ?? 0),
    0,
  );
  if (expiredAmount <= 0) return { expiredAmount: 0, balanceAfter: null };

  for (const lot of expiredLots) {
    await tx
      .update(pointTransaction)
      .set({ remainingAmount: 0 })
      .where(eq(pointTransaction.id, lot.transactionId));
  }

  const balanceAfter = await addBalance(tx, input.customerId, -expiredAmount);

  await tx.insert(pointTransaction).values({
    customerId: input.customerId,
    type: "expire",
    amount: -expiredAmount,
    remainingAmount: null,
    balanceAfter,
    title: "유효기간 만료",
    tagCode: "expire",
  });

  return { expiredAmount, balanceAfter };
}

/** 잔액 조회 — 화면·검증용. 원장 합계가 아니라 캐시를 읽는다(둘은 같아야 한다) */
export async function getPointBalance(
  client: QueryClient,
  customerId: number,
): Promise<number> {
  const [row] = await client
    .select({ pointBalance: customer.pointBalance })
    .from(customer)
    .where(eq(customer.id, customerId));
  return row?.pointBalance ?? 0;
}

/** 원장 잔여 합계 — 잔액 캐시와 맞는지 대사할 때 쓴다(검증·운영) */
export async function sumRemainingLots(
  client: QueryClient,
  customerId: number,
): Promise<number> {
  const [row] = await client
    .select({ total: sql<number>`coalesce(sum(${pointTransaction.remainingAmount}), 0)::int` })
    .from(pointTransaction)
    .where(spendableLotCondition(customerId));
  return row?.total ?? 0;
}
