import "server-only";

import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

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

/**
 * 잔액에는 남아 있지만 기한이 지나 쓸 수 없는 경우.
 *
 * 소멸 배치가 아직 안 돌아 캐시에 만료분이 남은 상태다 — 데이터 이상이 아니라 정상 상황이다.
 * 드리프트와 구분하는 이유: 같은 오류로 묶으면 운영자가 없는 버그를 쫓게 된다.
 */
export class PointExpiredShortageError extends Error {
  constructor() {
    super(
      "사용할 수 있는 적립금이 부족합니다. 유효기간이 지난 적립금은 사용할 수 없어요. 잔액을 다시 확인해 주세요.",
    );
    this.name = "PointExpiredShortageError";
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
 * 잔여가 남은 적립분 — **종류를 가리지 않는다.**
 *
 * 적립(earn)만 세면 반품 복원분(cancel, remaining_amount 있음)이 잔액에는 잡히는데
 * 결제에는 안 잡혀서, 고객은 잔액이 보이는데 쓸 수 없다.
 * '적립분인가'는 type이 아니라 remaining_amount가 정한다 — type은 왜 생겼는지(화면 표시)를 담을 뿐이다.
 *
 * 이것이 **잔액 캐시(customer.point_balance)와 맞아야 하는 합계**다(만료분 포함).
 * 소멸 배치가 만료분을 0으로 만들면 자연히 캐시와 함께 줄어든다.
 */
function remainingLotCondition(customerId: number) {
  return and(
    eq(pointTransaction.customerId, customerId),
    gt(pointTransaction.remainingAmount, 0),
  );
}

/**
 * **지금 결제에 쓸 수 있는** 적립분 — 위 조건에 "기한이 안 지났다"를 더한다.
 *
 * 소멸 배치를 신뢰의 근거로 삼지 않는다. 배치가 하루 멈추면 만료된 돈이 그대로 나가기 때문이다.
 * 쓰는 순간 기한을 보면 배치가 늦어도 절대 새지 않는다 — 배치는 원장을 정리하는 일이고,
 * 쓸 수 있는지 판정하는 일은 여기다.
 * expires_at이 비어 있으면 무기한이라 항상 쓸 수 있다.
 */
function spendableLotCondition(customerId: number) {
  return and(
    remainingLotCondition(customerId),
    or(isNull(pointTransaction.expiresAt), gt(pointTransaction.expiresAt, sql`now()`)),
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

  // 잔액(만료분 포함)은 통과했는데 쓸 수 있는 적립분이 모자란 경우가 둘이다:
  //  ① 모자란 만큼이 만료분 → 정상 상황이다. 소멸 배치가 아직 안 돌아 캐시에 남아 있을 뿐이니
  //     "잔액 부족"으로 알린다. 이걸 데이터 이상으로 처리하면 운영자가 없는 버그를 쫓는다.
  //  ② 만료분을 세어도 모자람 → 캐시와 원장이 정말 어긋났다.
  const spendableTotal = lots.reduce((sum, lot) => sum + lot.remainingAmount, 0);
  if (spendableTotal < input.amount) {
    const [remainingRow] = await tx
      .select({
        total: sql<number>`coalesce(sum(${pointTransaction.remainingAmount}), 0)::int`,
      })
      .from(pointTransaction)
      .where(remainingLotCondition(input.customerId));
    const remainingTotal = Number(remainingRow?.total ?? 0);
    // 트랜잭션이 롤백되므로 위에서 깎은 잔액도 함께 되돌아간다
    if (remainingTotal >= input.amount) throw new PointExpiredShortageError();
    throw new PointLedgerDriftError(input.customerId);
  }

  const deductions = planFifoDeduction(lots, input.amount);

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

/**
 * 보유 잔액(캐시) — **만료분을 포함한다.**
 *
 * 소멸 배치가 돌기 전까지 만료분이 여기 남아 있다. 화면에 "보유 적립금"으로 쓸 수는 있지만
 * **결제에 쓸 수 있는 금액은 아니다** — 그건 getUsablePointBalance다.
 * 원장 잔여 합계(sumRemainingLots)와 항상 같아야 한다(대사 기준).
 */
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

/**
 * **지금 결제에 쓸 수 있는 금액** — 기한이 안 지난 적립분만 합한다.
 *
 * 체크아웃 검증·화면 안내는 반드시 이 값을 써야 한다. 캐시 잔액으로 안내하면
 * "5,000원 있다고 나오는데 쓰려니 안 된다"가 된다(만료분이 섞여 있어서).
 * 캐시가 아니라 매번 합하는 이유: 만료는 시각이 지나면 저절로 일어나는 일이라
 * 캐시로 둘 수 없다 — 어떤 캐시도 '방금 만료된 것'을 모른다.
 */
export async function getUsablePointBalance(
  client: QueryClient,
  customerId: number,
): Promise<number> {
  const [row] = await client
    .select({
      total: sql<number>`coalesce(sum(${pointTransaction.remainingAmount}), 0)::int`,
    })
    .from(pointTransaction)
    .where(spendableLotCondition(customerId));
  return Number(row?.total ?? 0);
}

/**
 * 원장 잔여 합계 — 잔액 캐시와 맞는지 대사할 때 쓴다(검증·운영).
 *
 * **만료분을 포함한다.** 캐시도 만료분을 포함하므로 같은 기준이어야 대사가 성립한다 —
 * 여기서 만료분을 빼면 소멸 배치가 돌기 전까지 항상 불일치로 보인다.
 */
export async function sumRemainingLots(
  client: QueryClient,
  customerId: number,
): Promise<number> {
  const [row] = await client
    .select({ total: sql<number>`coalesce(sum(${pointTransaction.remainingAmount}), 0)::int` })
    .from(pointTransaction)
    .where(remainingLotCondition(customerId));
  return row?.total ?? 0;
}
