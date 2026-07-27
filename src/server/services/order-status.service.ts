import "server-only";

import { eq, sql } from "drizzle-orm";

import { orders, orderStatusHistory } from "@/db/schema";
import {
  assertTransition,
  type OrderStatus,
  type TransitionActorRole,
} from "@/domain/order";

import type { TransactionClient } from "./db-client";

/**
 * 주문 상태 변경의 유일한 통로(초크포인트).
 *
 * orders.status를 다른 곳에서 직접 UPDATE하면 이력(order_status_history)이 비고
 * 불법 전이가 통과한다. 그래서 "상태 변경 = 이 함수 호출"을 규약으로 삼는다(설계 §4 불변식3).
 *
 * 멱등: 이미 목표 상태면 아무것도 하지 않고 changed:false를 돌려준다.
 * 결제 콜백·웹훅이 중복 도착해도 이력이 두 번 쌓이지 않는다.
 */

export type TransitionActor = { role: TransitionActorRole; id?: number };

/** 감사 컬럼 규약 — "admin:{id}" / "customer:{id}" / "system" */
export function serializeActor(actor: TransitionActor): string {
  return actor.role === "system" ? "system" : `${actor.role}:${actor.id ?? 0}`;
}

export type TransitionResult = {
  changed: boolean;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
};

/**
 * 상태를 전이하고 이력을 원자적으로 남긴다. 트랜잭션 안에서만 호출한다.
 *
 * 행을 FOR UPDATE로 잠가 같은 주문에 대한 동시 전이를 직렬화한다 —
 * 잠그지 않으면 두 요청이 같은 from을 읽고 둘 다 전이해 이력이 꼬인다.
 */
export async function applyOrderTransition(
  tx: TransactionClient,
  input: {
    orderId: number;
    toStatus: OrderStatus;
    actor: TransitionActor;
    memo?: string;
  },
): Promise<TransitionResult> {
  const [current] = await tx
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .for("update")
    .limit(1);

  if (!current) {
    throw new Error(`주문을 찾을 수 없습니다: id=${input.orderId}`);
  }

  const fromStatus = current.status;
  if (fromStatus === input.toStatus) {
    return { changed: false, fromStatus, toStatus: input.toStatus };
  }

  // 불법 전이·권한 없는 actor는 여기서 차단(도메인 전이표가 판정)
  assertTransition(fromStatus, input.toStatus, input.actor.role);

  const actorText = serializeActor(input.actor);
  const timestampPatch: Record<string, unknown> = {};
  // 전이 시각은 상태와 같은 UPDATE로 박아야 배치·조회가 어긋나지 않는다
  if (input.toStatus === "delivered") timestampPatch.deliveredAt = sql`now()`;
  if (input.toStatus === "confirmed") timestampPatch.confirmedAt = sql`now()`;

  // orders는 감사 시각 2컬럼만 갖는다(사용자 생성 데이터 규약) — 변경 주체는 이력 테이블이 보관
  await tx
    .update(orders)
    .set({ status: input.toStatus, ...timestampPatch })
    .where(eq(orders.id, input.orderId));

  await tx.insert(orderStatusHistory).values({
    orderId: input.orderId,
    fromStatus,
    toStatus: input.toStatus,
    actor: actorText,
    memo: input.memo ?? null,
  });

  return { changed: true, fromStatus, toStatus: input.toStatus };
}
