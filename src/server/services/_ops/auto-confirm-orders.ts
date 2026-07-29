/**
 * 자동 구매확정 + 적립금 소멸 배치.
 * 실행: npm run ops:daily [-- --dry]
 *
 * 운영에서는 크론으로 하루 한 번(새벽) 돌린다. 둘을 한 스크립트에 둔 이유:
 * 매일 돌아야 하는 일이고, 확정이 적립을 일으키므로 순서(확정 → 소멸)가 있다.
 *
 * **이 배치가 안 돌면 구매 적립이 영원히 안 된다.** 고객이 직접 확정하지 않는 주문은
 * delivered에 영구히 머물고, 적립 트리거(confirmed 전이)에 도달하지 못한다.
 */

import "dotenv/config";

import { and, gt, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { pointTransaction } from "@/db/schema";

import { runAutoConfirm } from "../order-confirm.service";
import { expirePointsForCustomer } from "../point.service";

async function main() {
  const isDryRun = process.argv.includes("--dry");
  const now = new Date();

  console.log(`\nPaRaSOL 일일 배치${isDryRun ? " (미리보기 — 아무것도 바꾸지 않음)" : ""}\n`);

  // ── ① 자동 구매확정 (적립을 일으킨다)
  if (isDryRun) {
    console.log("  [1] 자동 구매확정 — --dry 이므로 건너뜀");
  } else {
    const confirmReport = await runAutoConfirm(db);
    console.log(
      `  [1] 자동 구매확정 — 대상 ${confirmReport.scannedCount} · 확정 ${confirmReport.confirmedOrderNos.length}`,
    );
    for (const orderNo of confirmReport.confirmedOrderNos.slice(0, 10)) {
      console.log(`      ✓ ${orderNo}`);
    }
    if (confirmReport.failed.length > 0) {
      // 실패한 건은 delivered로 남아 다음 실행에서 다시 잡힌다
      console.log(`      ✗ 실패 ${confirmReport.failed.length}건 (다음 실행에서 재시도):`);
      for (const failure of confirmReport.failed.slice(0, 5)) {
        console.log(`        - ${failure.orderNo}: ${failure.message}`);
      }
    }
  }

  // ── ② 적립금 소멸
  // 만료분이 남은 회원만 골라 돈다 — 전 회원을 훑으면 회원이 늘수록 배치가 길어진다
  const expiringCustomers = await db
    .selectDistinct({ customerId: pointTransaction.customerId })
    .from(pointTransaction)
    .where(
      and(
        gt(pointTransaction.remainingAmount, 0),
        isNotNull(pointTransaction.expiresAt),
        lte(pointTransaction.expiresAt, now),
      ),
    );

  console.log(`\n  [2] 적립금 소멸 — 대상 회원 ${expiringCustomers.length}명`);

  if (isDryRun) {
    console.log("      --dry 이므로 실제 소멸은 하지 않습니다.\n");
    process.exit(0);
  }

  let expiredTotal = 0;
  let expiredCustomerCount = 0;
  const expireFailed: { customerId: number; message: string }[] = [];

  for (const target of expiringCustomers) {
    try {
      // 회원 한 명씩 커밋한다 — 한 명의 실패가 전체를 되돌리면 안 된다
      const result = await db.transaction((tx) =>
        expirePointsForCustomer(tx, { customerId: target.customerId, now }),
      );
      if (result.expiredAmount > 0) {
        expiredTotal += result.expiredAmount;
        expiredCustomerCount += 1;
      }
    } catch (error) {
      expireFailed.push({
        customerId: target.customerId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `      소멸 ${expiredCustomerCount}명 · ${expiredTotal.toLocaleString("ko-KR")}원`,
  );
  if (expireFailed.length > 0) {
    console.log(`      ✗ 실패 ${expireFailed.length}건 (다음 실행에서 재시도)`);
    for (const failure of expireFailed.slice(0, 5)) {
      console.log(`        - 회원 ${failure.customerId}: ${failure.message}`);
    }
  }

  // 실패가 있으면 0이 아닌 코드로 끝낸다 — 크론이 조용히 성공으로 넘기면 아무도 모른다
  const hasFailure = expireFailed.length > 0;
  console.log("");
  process.exit(hasFailure ? 1 : 0);
}

main().catch((error) => {
  console.error("\n배치 중 오류:", error);
  process.exit(1);
});
