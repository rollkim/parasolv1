import "server-only";

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { uploadedFile } from "@/db/schema";
import { deleteStoredImage } from "@/server/services/image-storage.service";

import type { DatabaseClient, QueryClient, TransactionClient } from "./db-client";

/**
 * 업로드 파일의 생애주기 — 고아 파일이 생기지 않게 하는 유일한 통로.
 *
 * 규칙 셋:
 *  1. **파일을 쓰면 행부터 남긴다**(recordUploadedFile). 행이 없는 파일은 존재하지 않는 것으로 본다.
 *  2. **저장할 때 주인을 정한다**(claimFiles). 이때 빠진 파일은 삭제 예약된다.
 *  3. **지우는 건 배치뿐**(sweepDeletableFiles). 요청 처리 중에 파일을 지우면, 그 요청이
 *     롤백돼도 파일은 안 돌아온다 — DB는 되돌아가는데 디스크는 안 되돌아간다.
 *
 * 즉시 삭제하지 않고 유예를 두는 이유: 삭제는 되돌릴 수 없다. 잘못 지운 걸 알아챌 시간이 필요하다.
 */

/** 주인 없이 떠 있는 파일을 고아로 보기까지의 시간 — 폼을 열어두고 오래 작업할 수 있어 넉넉히 준다 */
const ORPHAN_GRACE_HOURS = 24;

/** 주인에게서 떨어진 파일을 실제로 지우기까지의 유예 */
const RELEASE_GRACE_DAYS = 7;

export type FileOwnerType = "product" | "banner" | "review" | "article";

/**
 * 업로드 직후 호출 — 파일이 디스크에 생겼다는 사실을 기록한다.
 * 이 시점에는 주인이 없다(폼이 저장되기 전이다).
 */
export async function recordUploadedFile(
  client: QueryClient,
  input: { storagePath: string; byteSize: number },
): Promise<void> {
  await client
    .insert(uploadedFile)
    .values({ storagePath: input.storagePath, byteSize: input.byteSize })
    // 같은 경로가 두 번 올 일은 없지만(파일명을 랜덤 생성한다), 재시도로 중복이 와도 깨지지 않게
    .onConflictDoNothing({ target: uploadedFile.storagePath });
}

/**
 * 저장 시 호출 — 이 주인이 쓰는 파일을 확정한다.
 *
 * `keepPaths`에 있는 것은 주인을 달고 삭제 예약을 푼다(다시 넣은 경우 살아난다).
 * 이 주인의 것이었는데 목록에서 빠진 것은 삭제 예약된다 — 지우지는 않는다.
 *
 * 폼 저장과 **같은 트랜잭션**에서 부른다. 저장이 실패하면 소유 정보도 함께 되돌아가야
 * "DB에는 안 붙었는데 파일은 주인이 있다"는 상태가 안 생긴다.
 */
export async function claimFiles(
  tx: TransactionClient,
  input: { ownerType: FileOwnerType; ownerId: number; keepPaths: string[] },
): Promise<void> {
  const ownerFilter = and(
    eq(uploadedFile.ownerType, input.ownerType),
    eq(uploadedFile.ownerId, input.ownerId),
  );

  // ① 이 주인의 기존 파일을 일단 전부 삭제 예약 — 아래에서 살릴 것만 되살린다
  await tx
    .update(uploadedFile)
    .set({ deleteAfter: sql`now() + interval '${sql.raw(String(RELEASE_GRACE_DAYS))} days'` })
    .where(and(ownerFilter, isNull(uploadedFile.deleteAfter)));

  if (input.keepPaths.length === 0) return;

  // ② 남길 파일에 주인을 달고 삭제 예약을 푼다
  await tx
    .update(uploadedFile)
    .set({ ownerType: input.ownerType, ownerId: input.ownerId, deleteAfter: null })
    .where(inArray(uploadedFile.storagePath, input.keepPaths));
}

/**
 * 주인이 사라질 때 호출(상품 삭제 등) — 그 주인의 파일을 전부 삭제 예약한다.
 * 파일을 바로 지우지 않는 이유는 위와 같다.
 */
export async function releaseOwnerFiles(
  tx: TransactionClient,
  input: { ownerType: FileOwnerType; ownerId: number },
): Promise<void> {
  await tx
    .update(uploadedFile)
    .set({ deleteAfter: sql`now() + interval '${sql.raw(String(RELEASE_GRACE_DAYS))} days'` })
    .where(
      and(
        eq(uploadedFile.ownerType, input.ownerType),
        eq(uploadedFile.ownerId, input.ownerId),
        isNull(uploadedFile.deleteAfter),
      ),
    );
}

export type SweepReport = {
  deletedCount: number;
  freedBytes: number;
  failedPaths: string[];
};

/**
 * 정리 배치 — 지워도 되는 파일을 실제로 지운다.
 *
 * 대상 둘:
 *  - 주인 없이 24시간 넘게 떠 있는 파일(올리고 저장 안 한 경우)
 *  - 삭제 예약 시각이 지난 파일(폼에서 뺐거나 주인이 지워진 경우)
 *
 * **파일을 먼저 지우고 행을 지운다.** 순서를 바꾸면 행이 사라진 뒤 파일 삭제가 실패했을 때
 * 그 파일을 아무도 기억하지 못한다 — 그게 정확히 고아 파일이다.
 */
export async function sweepDeletableFiles(
  database: DatabaseClient,
  options: { limit?: number } = {},
): Promise<SweepReport> {
  const limit = options.limit ?? 500;

  const targets = await database
    .select({
      id: uploadedFile.id,
      storagePath: uploadedFile.storagePath,
      byteSize: uploadedFile.byteSize,
    })
    .from(uploadedFile)
    .where(
      or(
        and(
          isNull(uploadedFile.ownerType),
          lt(
            uploadedFile.createdAt,
            sql`now() - interval '${sql.raw(String(ORPHAN_GRACE_HOURS))} hours'`,
          ),
        ),
        lt(uploadedFile.deleteAfter, sql`now()`),
      ),
    )
    .limit(limit);

  const deletedIds: number[] = [];
  const failedPaths: string[] = [];
  let freedBytes = 0;

  for (const target of targets) {
    const removed = await deleteStoredImage(target.storagePath);
    if (removed === "failed") {
      failedPaths.push(target.storagePath);
      continue;
    }
    // 이미 없는 파일(missing)도 행은 지운다 — 남겨두면 매번 다시 시도하며 로그만 쌓인다
    deletedIds.push(target.id);
    if (removed === "deleted") freedBytes += target.byteSize;
  }

  if (deletedIds.length > 0) {
    await database.delete(uploadedFile).where(inArray(uploadedFile.id, deletedIds));
  }

  return { deletedCount: deletedIds.length, freedBytes, failedPaths };
}

/** 운영 현황 — 얼마나 쌓여 있는지 본다(디스크 30GB를 쓰는 계획이라 눈에 보여야 한다) */
export async function getUploadedFileStats(database: DatabaseClient): Promise<{
  totalCount: number;
  totalBytes: number;
  orphanCount: number;
  orphanBytes: number;
  pendingDeleteCount: number;
}> {
  const [row] = await database
    .select({
      totalCount: sql<number>`count(*)::int`,
      totalBytes: sql<number>`coalesce(sum(${uploadedFile.byteSize}), 0)::bigint`,
      orphanCount: sql<number>`count(*) filter (where ${uploadedFile.ownerType} is null)::int`,
      orphanBytes: sql<number>`coalesce(sum(${uploadedFile.byteSize}) filter (where ${uploadedFile.ownerType} is null), 0)::bigint`,
      pendingDeleteCount: sql<number>`count(*) filter (where ${uploadedFile.deleteAfter} is not null)::int`,
    })
    .from(uploadedFile);

  return {
    totalCount: Number(row?.totalCount ?? 0),
    totalBytes: Number(row?.totalBytes ?? 0),
    orphanCount: Number(row?.orphanCount ?? 0),
    orphanBytes: Number(row?.orphanBytes ?? 0),
    pendingDeleteCount: Number(row?.pendingDeleteCount ?? 0),
  };
}
