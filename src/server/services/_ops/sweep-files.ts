/**
 * 고아 파일 정리 배치 — 주인 없는 업로드와 삭제 예약된 파일을 실제로 지운다.
 * 실행: npm run ops:sweep-files [-- --dry] [-- --limit=1000]
 *
 * 운영에서는 크론으로 하루 한 번 돌린다(새벽 한산한 시간).
 * 지우는 일을 요청 처리 중에 하지 않고 여기 모은 이유: 요청이 롤백돼도 파일은 안 돌아온다.
 * DB는 되돌아가는데 디스크는 되돌아가지 않는다.
 */

import "dotenv/config";

import { db } from "@/db";

import { getUploadedFileStats, sweepDeletableFiles } from "../uploaded-file.service";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

async function main() {
  const isDryRun = process.argv.includes("--dry");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : 500;

  console.log(`\nPaRaSOL 업로드 파일 정리${isDryRun ? " (미리보기 — 지우지 않음)" : ""}\n`);

  const before = await getUploadedFileStats(db);
  console.log(
    `  현재: ${before.totalCount}개 · ${formatBytes(before.totalBytes)}\n` +
      `  주인 없음: ${before.orphanCount}개 · ${formatBytes(before.orphanBytes)}\n` +
      `  삭제 예약: ${before.pendingDeleteCount}개`,
  );

  if (isDryRun) {
    console.log(
      "\n  --dry 이므로 여기서 멈춥니다. 실제로 지우려면 --dry 없이 실행하세요.\n",
    );
    process.exit(0);
  }

  const report = await sweepDeletableFiles(db, { limit });
  console.log(
    `\n  삭제: ${report.deletedCount}개 · 회수 ${formatBytes(report.freedBytes)}`,
  );
  if (report.failedPaths.length > 0) {
    // 실패한 것은 원장에 남겨 다음 실행에서 다시 시도한다 — 지워버리면 아무도 기억하지 못한다
    console.log(`  ✗ 지우지 못함 ${report.failedPaths.length}개 (다음 실행에서 재시도):`);
    for (const failedPath of report.failedPaths.slice(0, 10)) {
      console.log(`    - ${failedPath}`);
    }
  }

  const after = await getUploadedFileStats(db);
  console.log(`\n  정리 후: ${after.totalCount}개 · ${formatBytes(after.totalBytes)}\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error("\n정리 중 오류:", error);
  process.exit(1);
});
