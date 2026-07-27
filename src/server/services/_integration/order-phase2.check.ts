/**
 * Phase 2 트랜잭션 통합 검증 — 실제 DB에 붙어 동시성을 실측한다.
 * 실행: npm run check:order2   (SSH 터널 켠 상태)
 *
 * 스크립트가 `tsx --conditions=react-server`로 도는 이유:
 * 서비스들이 최상단에 import "server-only"를 두는데, 이 패키지는 react-server 조건에서만
 * 빈 모듈이고 일반 Node 실행에서는 무조건 throw한다. 조건을 켜면 실제 서비스 코드를
 * 우회·복제 없이 그대로 실행해 검증할 수 있다(복제하면 검증 대상이 실물이 아니게 된다).
 *
 * 왜 vitest가 아닌 스크립트인가: 실제 커넥션을 여러 개 열어 "동시에" 실행해야 하고,
 * 검증 대상이 DB 잠금 동작이라 단위테스트 격리와 성질이 다르다.
 *
 * 이 스크립트는 임시 데이터를 만들고 끝나면 되돌린다(재고 원복·생성 로그 삭제).
 * 실패해도 커밋된 변경이 남지 않도록 각 시나리오를 트랜잭션으로 감싼다.
 */

import "dotenv/config";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { inventoryLog, productVariant } from "@/db/schema";
import { planStockDeductions } from "@/domain/inventory";
import { parseDailyNo } from "@/domain/order-number";

import { deductStockForOrder, StockShortageError, readOrderDeductions, restoreStock } from "../inventory.service";
import { allocateOrderNo } from "../order-number.service";

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

/** ① 동시 채번: 20개를 동시에 뽑아 중복이 없어야 한다 */
async function checkConcurrentOrderNo() {
  console.log("\n[1] 동시 채번 20건 — 중복 0 기대");
  const numbers = await Promise.all(
    Array.from({ length: 20 }, () => allocateOrderNo(db)),
  );
  const unique = new Set(numbers);
  check(unique.size === numbers.length, `중복 없음 (${unique.size}/${numbers.length})`, numbers.slice(0, 3));
  check(numbers.every((n) => parseDailyNo(n) !== null), "형식 YYYYMMDD-#### 준수", numbers[0]);
}

/** 테스트용 variant 하나를 골라 재고를 원하는 값으로 세팅하고, 끝나면 원복 */
async function withVariantStock(
  stock: number,
  run: (variantId: number) => Promise<void>,
) {
  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("variant가 없습니다. npm run db:seed:dev 먼저 실행하세요.");

  await db.update(productVariant).set({ stock }).where(eq(productVariant.id, variant.id));
  try {
    await run(variant.id);
  } finally {
    await db.update(productVariant).set({ stock: variant.stock }).where(eq(productVariant.id, variant.id));
    await db.delete(inventoryLog).where(sql`${inventoryLog.refId} like 'CHECK-%'`);
  }
}

/** ② 마지막 1개 동시 차감: 정확히 한 명만 성공해야 한다(오버셀 방지) */
async function checkOverselling() {
  console.log("\n[2] 재고 1개를 5명이 동시 차감 — 성공 1·실패 4 기대");
  await withVariantStock(1, async (variantId) => {
    const targets = planStockDeductions([{ variantId, quantity: 1, addons: [] }]);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        db.transaction(async (tx) => {
          await deductStockForOrder(tx, {
            targets,
            orderNo: `CHECK-OVERSELL-${i}`,
            actor: "system",
          });
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const shortage = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof StockShortageError,
    ).length;
    check(succeeded === 1, `성공 정확히 1건 (실제 ${succeeded})`);
    check(shortage === 4, `재고부족 거부 4건 (실제 ${shortage})`);

    const [after] = await db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, variantId));
    check(after.stock === 0, `잔여 재고 0 (실제 ${after.stock}) — 음수 없음`);
  });
}

/** ③ 부분 차감 롤백: 두 라인 중 하나가 부족하면 성공분도 되돌아가야 한다 */
async function checkPartialRollback() {
  console.log("\n[3] 라인 2개 중 1개 재고부족 — 전체 롤백 기대");
  const variants = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .orderBy(productVariant.id)
    .limit(2);
  if (variants.length < 2) throw new Error("variant 2개 이상 필요");

  const [okVariant, shortVariant] = variants;
  await db.update(productVariant).set({ stock: 10 }).where(eq(productVariant.id, okVariant.id));
  await db.update(productVariant).set({ stock: 0 }).where(eq(productVariant.id, shortVariant.id));

  try {
    const targets = planStockDeductions([
      { variantId: okVariant.id, quantity: 1, addons: [] },
      { variantId: shortVariant.id, quantity: 1, addons: [] },
    ]);

    let threw = false;
    try {
      await db.transaction(async (tx) => {
        await deductStockForOrder(tx, { targets, orderNo: "CHECK-ROLLBACK", actor: "system" });
      });
    } catch (error) {
      threw = error instanceof StockShortageError;
    }
    check(threw, "StockShortageError 발생");

    const [okAfter] = await db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, okVariant.id));
    check(okAfter.stock === 10, `성공 라인도 롤백돼 재고 10 유지 (실제 ${okAfter.stock})`);

    const logs = await db
      .select({ id: inventoryLog.id })
      .from(inventoryLog)
      .where(eq(inventoryLog.refId, "CHECK-ROLLBACK"));
    check(logs.length === 0, `재고 로그도 롤백 (실제 ${logs.length}건)`);
  } finally {
    await db.update(productVariant).set({ stock: okVariant.stock }).where(eq(productVariant.id, okVariant.id));
    await db.update(productVariant).set({ stock: shortVariant.stock }).where(eq(productVariant.id, shortVariant.id));
    await db.delete(inventoryLog).where(sql`${inventoryLog.refId} like 'CHECK-%'`);
  }
}

/** ④ 차감 → 원장 조회 → 복원: 재고가 정확히 원위치 */
async function checkRestoreRoundTrip() {
  console.log("\n[4] 차감 후 복원 — 재고 원위치·원장 기록 기대");
  await withVariantStock(5, async (variantId) => {
    const targets = planStockDeductions([{ variantId, quantity: 2, addons: [] }]);

    await db.transaction(async (tx) => {
      await deductStockForOrder(tx, { targets, orderNo: "CHECK-RESTORE", actor: "system" });
    });
    const [afterDeduct] = await db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, variantId));
    check(afterDeduct.stock === 3, `차감 후 3 (실제 ${afterDeduct.stock})`);

    await db.transaction(async (tx) => {
      const deductions = await readOrderDeductions(tx, "CHECK-RESTORE");
      check(deductions.length === 1 && deductions[0].quantity === 2, "원장에서 차감 내역 복구", deductions);
      await restoreStock(tx, {
        targets: deductions,
        orderNo: "CHECK-RESTORE",
        reason: "cancel_restock",
        actor: "system",
      });
    });

    const [afterRestore] = await db
      .select({ stock: productVariant.stock })
      .from(productVariant)
      .where(eq(productVariant.id, variantId));
    check(afterRestore.stock === 5, `복원 후 5 (실제 ${afterRestore.stock})`);

    const logs = await db
      .select({ reason: inventoryLog.reason, delta: inventoryLog.delta })
      .from(inventoryLog)
      .where(eq(inventoryLog.refId, "CHECK-RESTORE"));
    check(logs.length === 2, `원장 2건(차감+복원) (실제 ${logs.length})`, logs);
  });
}

async function main() {
  console.log("PaRaSOL 주문 Phase 2 트랜잭션 검증\n(임시 데이터는 종료 시 원복됩니다)");
  await checkConcurrentOrderNo();
  await checkOverselling();
  await checkPartialRollback();
  await checkRestoreRoundTrip();

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
