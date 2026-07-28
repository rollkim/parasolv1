import "server-only";

import { eq, sql } from "drizzle-orm";

import { claim, claimStatusHistory } from "@/db/schema";
import {
  assertClaimTransition,
  claimSideEffectsFor,
  isClaimTerminalStatus,
  requiresTransitionMemo,
  type ClaimSideEffect,
  type ClaimStatus,
  type ClaimType,
} from "@/domain/claim";

import type { TransactionClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";

/**
 * 클레임 상태 변경의 유일한 통로(초크포인트).
 *
 * 주문의 applyOrderTransition과 같은 규약이다: claim.status를 다른 곳에서 직접 UPDATE하면
 * 이력(claim_status_history)이 비고 불법 전이가 통과한다. "상태 변경 = 이 함수 호출"이 규약이다.
 *
 * 멱등: 이미 목표 상태면 아무것도 하지 않고 changed:false를 돌려준다.
 */

export type ClaimTransitionResult = {
  changed: boolean;
  fromStatus: ClaimStatus;
  toStatus: ClaimStatus;
  /** 서비스가 수행해야 할 부작용 — 전이표가 정한다 */
  sideEffects: ClaimSideEffect[];
};

export class ClaimNotFoundError extends Error {
  constructor(readonly claimId: number) {
    super(`클레임을 찾을 수 없습니다: id=${claimId}`);
    this.name = "ClaimNotFoundError";
  }
}

export class ClaimTransitionMemoRequiredError extends Error {
  constructor() {
    super("반려 사유를 입력해 주세요. 고객에게 그대로 안내됩니다.");
    this.name = "ClaimTransitionMemoRequiredError";
  }
}

/**
 * 상태를 전이하고 이력을 원자적으로 남긴다. 트랜잭션 안에서만 호출한다.
 *
 * 행을 FOR UPDATE로 잠가 같은 클레임에 대한 동시 처리를 직렬화한다 —
 * 관리자 둘이 같은 건을 동시에 승인/반려하는 상황을 막는다.
 * 종결 상태(done·rejected)에서 나가는 전이는 전이표에 없으므로 assert가 차단한다.
 */
export async function applyClaimTransition(
  tx: TransactionClient,
  input: {
    claimId: number;
    toStatus: ClaimStatus;
    actor: TransitionActor;
    /** 반려 시 필수 — 고객 안내 문구라 내부 메모(claim.admin_memo)와 성격이 다르다 */
    memo?: string | null;
  },
): Promise<ClaimTransitionResult> {
  const [current] = await tx
    .select({ claimType: claim.type, status: claim.status })
    .from(claim)
    .where(eq(claim.id, input.claimId))
    .for("update")
    .limit(1);

  if (!current) throw new ClaimNotFoundError(input.claimId);

  const fromStatus = current.status;
  const claimType: ClaimType = current.claimType;

  if (fromStatus === input.toStatus) {
    return { changed: false, fromStatus, toStatus: input.toStatus, sideEffects: [] };
  }

  // 불법 전이(유형별로 다르다)는 여기서 차단
  assertClaimTransition(claimType, fromStatus, input.toStatus);

  const memo = input.memo?.trim() ? input.memo.trim() : null;
  if (requiresTransitionMemo(input.toStatus) && memo === null) {
    throw new ClaimTransitionMemoRequiredError();
  }

  // 종결 시각은 상태와 같은 UPDATE로 박아야 조회·통계가 어긋나지 않는다
  const resolvedPatch = isClaimTerminalStatus(input.toStatus)
    ? { resolvedAt: sql`now()` }
    : {};

  await tx
    .update(claim)
    .set({ status: input.toStatus, ...resolvedPatch })
    .where(eq(claim.id, input.claimId));

  await tx.insert(claimStatusHistory).values({
    claimId: input.claimId,
    fromStatus,
    toStatus: input.toStatus,
    actor: serializeActor(input.actor),
    memo,
  });

  return {
    changed: true,
    fromStatus,
    toStatus: input.toStatus,
    sideEffects: claimSideEffectsFor(claimType, fromStatus, input.toStatus),
  };
}
