/**
 * 업로드 파일 원장 검증 — 고아 파일이 생기지 않는지.
 * 실행: npm run check:files   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **파일이 새는 세 지점이 모두 막혔다.**
 *   ① 올리고 저장 안 함  ② 폼에서 뺌  ③ 주인이 지워짐
 * 셋 다 원장에 남아 배치가 치울 수 있어야 한다. 디스크에만 남으면 아무도 기억하지 못한다.
 *
 * 시나리오: [1]업로드 기록 [2]저장 시 소유 [3]뺀 파일 삭제 예약 [4]주인 삭제
 *           [5]배치 대상 판정 [6]되살리기
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { uploadedFile } from "@/db/schema";

import {
  claimFiles,
  getUploadedFileStats,
  recordUploadedFile,
  releaseOwnerFiles,
} from "../uploaded-file.service";

let passCount = 0;
let failCount = 0;

function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passCount += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failCount += 1;
    console.log(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const SUFFIX = randomUUID().slice(0, 8);
/** 실제 파일은 만들지 않는다 — 원장 규칙만 보는 검증이다(배치는 없는 파일도 원장에서 지운다) */
const PATH_A = `products/209901/${SUFFIX}aa.jpg`;
const PATH_B = `products/209901/${SUFFIX}bb.jpg`;
const PATH_C = `products/209901/${SUFFIX}cc.jpg`;
const OWNER_ID = 999_000_000 + Math.floor(Number(`0x${SUFFIX.slice(0, 4)}`) % 1000);

async function readRow(storagePath: string) {
  const [row] = await db
    .select({
      ownerType: uploadedFile.ownerType,
      ownerId: uploadedFile.ownerId,
      deleteAfter: uploadedFile.deleteAfter,
    })
    .from(uploadedFile)
    .where(eq(uploadedFile.storagePath, storagePath));
  return row ?? null;
}

async function main() {
  console.log("PaRaSOL 업로드 파일 원장 검증 (임시 행은 종료 시 삭제)");

  try {
    console.log("\n[1] 업로드 — 주인 없이 원장에 남는다 기대");
    await recordUploadedFile(db, { storagePath: PATH_A, byteSize: 1000 });
    await recordUploadedFile(db, { storagePath: PATH_B, byteSize: 2000 });
    await recordUploadedFile(db, { storagePath: PATH_C, byteSize: 3000 });

    const afterUpload = await readRow(PATH_A);
    check(afterUpload !== null, "올리자마자 원장에 행이 생긴다");
    check(
      afterUpload?.ownerType === null,
      "주인은 아직 없다 — 폼을 저장하기 전이다",
      afterUpload,
    );

    // 같은 경로가 두 번 와도 깨지지 않는다(재시도 대비)
    await recordUploadedFile(db, { storagePath: PATH_A, byteSize: 1000 });
    const duplicateRows = await db
      .select({ id: uploadedFile.id })
      .from(uploadedFile)
      .where(eq(uploadedFile.storagePath, PATH_A));
    check(duplicateRows.length === 1, "같은 경로를 다시 기록해도 행은 하나", duplicateRows.length);

    console.log("\n[2] 저장 — 쓰는 파일에 주인이 붙는다 기대");
    await db.transaction((tx) =>
      claimFiles(tx, {
        ownerType: "product",
        ownerId: OWNER_ID,
        keepPaths: [PATH_A, PATH_B],
      }),
    );
    const claimedA = await readRow(PATH_A);
    check(
      claimedA?.ownerType === "product" && claimedA.ownerId === OWNER_ID,
      "저장한 파일에 주인이 붙는다",
      claimedA,
    );
    check(claimedA?.deleteAfter === null, "삭제 예약 없음");

    const unclaimedC = await readRow(PATH_C);
    check(
      unclaimedC?.ownerType === null,
      "폼에 넣지 않은 파일은 주인 없이 남는다 — 24시간 뒤 배치가 치운다",
      unclaimedC,
    );

    console.log("\n[3] 폼에서 뺌 — 삭제 예약 기대");
    await db.transaction((tx) =>
      claimFiles(tx, { ownerType: "product", ownerId: OWNER_ID, keepPaths: [PATH_A] }),
    );
    const droppedB = await readRow(PATH_B);
    check(
      droppedB?.deleteAfter !== null,
      "뺀 파일은 삭제 예약된다 — 안 하면 디스크에만 남아 고아가 된다",
      droppedB,
    );
    const keptA = await readRow(PATH_A);
    check(keptA?.deleteAfter === null, "남긴 파일은 예약되지 않는다");

    console.log("\n[4] 되살리기 — 다시 넣으면 예약이 풀린다 기대");
    await db.transaction((tx) =>
      claimFiles(tx, {
        ownerType: "product",
        ownerId: OWNER_ID,
        keepPaths: [PATH_A, PATH_B],
      }),
    );
    const revivedB = await readRow(PATH_B);
    check(
      revivedB?.deleteAfter === null && revivedB.ownerType === "product",
      "뺐다가 다시 넣으면 살아난다 — 유예를 두는 이유가 이것이다",
      revivedB,
    );

    console.log("\n[5] 주인 삭제 — 전부 삭제 예약 기대");
    await db.transaction((tx) =>
      releaseOwnerFiles(tx, { ownerType: "product", ownerId: OWNER_ID }),
    );
    const releasedA = await readRow(PATH_A);
    const releasedB = await readRow(PATH_B);
    check(
      releasedA?.deleteAfter !== null && releasedB?.deleteAfter !== null,
      "주인이 사라지면 그 파일 전부 삭제 예약",
      { releasedA, releasedB },
    );

    console.log("\n[6] 현황 집계");
    const stats = await getUploadedFileStats(db);
    check(stats.totalCount >= 3, `원장 총 ${stats.totalCount}개`, stats);
    check(
      stats.pendingDeleteCount >= 2,
      `삭제 예약 ${stats.pendingDeleteCount}개 — 운영이 얼마나 쌓였는지 볼 수 있다`,
    );
    check(
      stats.orphanCount >= 1,
      `주인 없음 ${stats.orphanCount}개 — 저장 안 하고 나간 파일이 보인다`,
    );
  } finally {
    await db
      .delete(uploadedFile)
      .where(inArray(uploadedFile.storagePath, [PATH_A, PATH_B, PATH_C]));
    // 검증이 만든 소유 흔적이 남지 않게
    await db
      .delete(uploadedFile)
      .where(and(eq(uploadedFile.ownerId, OWNER_ID), isNull(uploadedFile.deleteAfter)));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
