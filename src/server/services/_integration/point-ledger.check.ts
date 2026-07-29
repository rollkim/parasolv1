/**
 * 적립금 원장 검증 (P2) — 실제 DB에서 원장·잔액이 갈라지지 않는지 확인한다.
 * 실행: npm run check:point   (SSH 터널 켠 상태 · dedupe_key SQL 적용 후)
 *
 * 핵심 검증: **어떤 경로로도 원장 잔여 합계와 잔액 캐시가 어긋나지 않는다.**
 * 적립·사용·복원·회수·소멸을 섞어 돌린 뒤 매번 둘을 맞춰 본다.
 *
 * 시나리오: [1]적립·잔액 [2]중복 적립 차단 [3]FIFO 사용 [4]잔액 부족 [5]동시 사용 경합
 *           [6]사용 복원 [7]적립 회수(음수 허용) [8]소멸
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { customer, pointTransaction } from "@/db/schema";
import { calcExpiresAt } from "@/domain/point";

import {
  PointBalanceShortageError,
  PointExpiredShortageError,
  clawbackPoints,
  earnPoints,
  expirePointsForCustomer,
  getPointBalance,
  getUsablePointBalance,
  restoreUsedPoints,
  sumRemainingLots,
  usePoints,
} from "../point.service";
import { loadPointPolicy } from "../point-policy.service";

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

/** 원장 잔여 합계 == 잔액 캐시 — 모든 단계 뒤에 이걸 확인한다 */
async function checkLedgerMatchesBalance(customerId: number, label: string) {
  const [balance, lotSum] = await Promise.all([
    getPointBalance(db, customerId),
    sumRemainingLots(db, customerId),
  ]);
  check(balance === lotSum, `${label} — 원장 잔여 합계 == 잔액 캐시`, { balance, lotSum });
  return balance;
}

async function main() {
  console.log("PaRaSOL 적립금 원장 검증 (임시 회원은 종료 시 삭제)");

  const policy = await loadPointPolicy(db);
  console.log(
    `  정책: 적립률 ${policy.earnRatePerMille / 10}% · 소멸 ${policy.expiryDays}일 · ` +
      `${policy.useUnitPoint}원 단위 · 최소 ${policy.minUsePoint}원`,
  );
  check(policy.useUnitPoint === 10 && policy.minUsePoint === 1000, "사용 규칙이 설정에서 읽힌다");

  const createdCustomerIds: number[] = [];

  try {
    const [buyer] = await db
      .insert(customer)
      .values({
        name: `적립검증${SUFFIX}`,
        email: `point-${SUFFIX}@example.com`,
        isActive: true,
      })
      .returning({ id: customer.id });
    createdCustomerIds.push(buyer.id);

    const now = new Date();
    const expiresAt = calcExpiresAt(now, policy);

    console.log("\n[1] 적립 — 잔액과 원장이 함께 움직인다 기대");
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 1000,
        title: "검증 적립 A",
        tagCode: "manual",
        expiresAt: new Date(now.getTime() + 60_000), // 가장 먼저 소멸 — FIFO 1순위
        dedupeKey: `check:${SUFFIX}:a`,
      }),
    );
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 2000,
        title: "검증 적립 B",
        tagCode: "manual",
        expiresAt,
        dedupeKey: `check:${SUFFIX}:b`,
      }),
    );
    check((await getPointBalance(db, buyer.id)) === 3000, "적립 2건 후 잔액 3000");
    await checkLedgerMatchesBalance(buyer.id, "적립 후");

    console.log("\n[2] 중복 적립 차단 — 같은 dedupe_key는 두 번 안 들어간다 기대");
    const duplicateResult = await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: buyer.id,
        amount: 1000,
        title: "검증 적립 A (중복)",
        tagCode: "manual",
        expiresAt,
        dedupeKey: `check:${SUFFIX}:a`,
      }),
    );
    check(
      duplicateResult.earned === false && duplicateResult.reason === "duplicate",
      "같은 사유의 재적립은 거절된다",
      duplicateResult,
    );
    check((await getPointBalance(db, buyer.id)) === 3000, "잔액이 늘지 않았다 — 돈이 두 배 되지 않는다");

    console.log("\n[3] 사용 — 먼저 소멸할 적립분부터 깎는다 기대");
    await db.transaction((tx) =>
      usePoints(tx, { customerId: buyer.id, amount: 1500, title: "검증 사용" }),
    );
    check((await getPointBalance(db, buyer.id)) === 1500, "사용 후 잔액 1500");
    await checkLedgerMatchesBalance(buyer.id, "사용 후");

    const lotsAfterUse = await db
      .select({
        title: pointTransaction.title,
        remainingAmount: pointTransaction.remainingAmount,
      })
      .from(pointTransaction)
      .where(
        and(
          eq(pointTransaction.customerId, buyer.id),
          eq(pointTransaction.type, "earn"),
        ),
      )
      .orderBy(asc(pointTransaction.id));
    check(
      lotsAfterUse[0]?.remainingAmount === 0 && lotsAfterUse[1]?.remainingAmount === 1500,
      "빨리 소멸할 적립분(A)이 먼저 비었다 — 나중 것부터 쓰면 곧 소멸할 돈이 날아간다",
      lotsAfterUse,
    );

    console.log("\n[4] 잔액 부족 — 거절 기대");
    let shortageBlocked = false;
    try {
      await db.transaction((tx) =>
        usePoints(tx, { customerId: buyer.id, amount: 9999, title: "초과 사용" }),
      );
    } catch (error) {
      shortageBlocked = error instanceof PointBalanceShortageError;
    }
    check(shortageBlocked, "잔액보다 많이 쓰면 막힌다 — 화면이 아니라 조건부 UPDATE가 판정한다");
    check((await getPointBalance(db, buyer.id)) === 1500, "실패한 사용은 잔액을 건드리지 않았다");

    console.log("\n[5] 동시 사용 경합 — 하나만 성공 기대");
    const [racerA, racerB] = await Promise.allSettled([
      db.transaction((tx) =>
        usePoints(tx, { customerId: buyer.id, amount: 1000, title: "동시 사용 A" }),
      ),
      db.transaction((tx) =>
        usePoints(tx, { customerId: buyer.id, amount: 1000, title: "동시 사용 B" }),
      ),
    ]);
    const successCount = [racerA, racerB].filter((r) => r.status === "fulfilled").length;
    check(
      successCount === 1,
      `1000원 잔액 1500에 1000원 사용 둘이 동시에 오면 하나만 성공 (성공 ${successCount})`,
      { a: racerA.status, b: racerB.status },
    );
    const balanceAfterRace = await checkLedgerMatchesBalance(buyer.id, "동시 사용 후");
    check(balanceAfterRace === 500, "잔액 500 — 두 번 깎이지 않았다", balanceAfterRace);

    console.log("\n[6] 사용 복원 — 다시 쓸 수 있는 적립분으로 돌아온다 기대");
    await db.transaction((tx) =>
      restoreUsedPoints(tx, {
        customerId: buyer.id,
        amount: 1000,
        title: "검증 반품 복원",
        expiresAt,
        dedupeKey: `check:${SUFFIX}:restore`,
      }),
    );
    check((await getPointBalance(db, buyer.id)) === 1500, "복원 후 잔액 1500");
    await checkLedgerMatchesBalance(buyer.id, "복원 후");
    await db.transaction((tx) =>
      usePoints(tx, { customerId: buyer.id, amount: 1500, title: "복원분 재사용" }),
    );
    check(
      (await getPointBalance(db, buyer.id)) === 0,
      "복원된 적립금은 다시 쓸 수 있다 — 잔액만 늘고 못 쓰는 상태가 아니다",
    );

    console.log("\n[7] 적립 회수 — 잔액이 없어도 걷는다(음수 허용) 기대");
    await db.transaction((tx) =>
      clawbackPoints(tx, {
        customerId: buyer.id,
        amount: 300,
        title: "확정 후 반품 적립 회수",
        dedupeKey: `check:${SUFFIX}:clawback`,
      }),
    );
    check(
      (await getPointBalance(db, buyer.id)) === -300,
      "잔액이 음수가 된다 — 회수를 포기하면 '적립받고 반품' 반복이 뚫린다",
    );
    let negativeUseBlocked = false;
    try {
      await db.transaction((tx) =>
        usePoints(tx, { customerId: buyer.id, amount: 1000, title: "음수 잔액 사용 시도" }),
      );
    } catch (error) {
      negativeUseBlocked = error instanceof PointBalanceShortageError;
    }
    check(negativeUseBlocked, "음수 잔액으로는 사용할 수 없다");

    console.log("\n[8] 소멸 — 기한 지난 적립분만 사라진다 기대");
    const [expiryTester] = await db
      .insert(customer)
      .values({
        name: `소멸검증${SUFFIX}`,
        email: `expire-${SUFFIX}@example.com`,
        isActive: true,
      })
      .returning({ id: customer.id });
    createdCustomerIds.push(expiryTester.id);

    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: expiryTester.id,
        amount: 700,
        title: "만료될 적립",
        tagCode: "manual",
        expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 어제 만료
        dedupeKey: `check:${SUFFIX}:expired`,
      }),
    );
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: expiryTester.id,
        amount: 300,
        title: "살아남을 적립",
        tagCode: "manual",
        expiresAt,
        dedupeKey: `check:${SUFFIX}:alive`,
      }),
    );

    const expireResult = await db.transaction((tx) =>
      expirePointsForCustomer(tx, { customerId: expiryTester.id, now }),
    );
    check(expireResult.expiredAmount === 700, "기한이 지난 700만 소멸", expireResult);
    check((await getPointBalance(db, expiryTester.id)) === 300, "살아남은 적립분은 그대로");
    await checkLedgerMatchesBalance(expiryTester.id, "소멸 후");

    const secondRun = await db.transaction((tx) =>
      expirePointsForCustomer(tx, { customerId: expiryTester.id, now }),
    );
    check(
      secondRun.expiredAmount === 0,
      "배치를 다시 돌려도 두 번 소멸하지 않는다 — 재실행이 안전하다",
    );

    console.log("\n[9] ★만료분은 배치 전에도 쓸 수 없다 기대");
    // 소멸 배치를 신뢰의 근거로 삼지 않는다 — 배치가 하루 멈춘 날 만료된 돈이 나가면 안 된다
    const [expiredOnly] = await db
      .insert(customer)
      .values({
        name: `만료검증${SUFFIX}`,
        email: `expired-${SUFFIX}@example.com`,
        isActive: true,
      })
      .returning({ id: customer.id });
    createdCustomerIds.push(expiredOnly.id);

    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: expiredOnly.id,
        amount: 3000,
        title: "이미 만료된 적립",
        tagCode: "manual",
        expiresAt: new Date(now.getTime() - 60 * 60 * 1000), // 한 시간 전 만료
        dedupeKey: `check:${SUFFIX}:stale`,
      }),
    );
    await db.transaction((tx) =>
      earnPoints(tx, {
        customerId: expiredOnly.id,
        amount: 1000,
        title: "살아있는 적립",
        tagCode: "manual",
        expiresAt,
        dedupeKey: `check:${SUFFIX}:fresh`,
      }),
    );

    check(
      (await getPointBalance(db, expiredOnly.id)) === 4000,
      "보유 잔액은 만료분을 포함한다 — 소멸 배치가 돌기 전이라 캐시에 남아 있다",
    );
    check(
      (await getUsablePointBalance(db, expiredOnly.id)) === 1000,
      "★쓸 수 있는 금액은 1000 — 만료분 3000은 빠진다",
    );
    check(
      (await sumRemainingLots(db, expiredOnly.id)) === 4000,
      "대사용 원장 합계는 만료분을 포함한다 — 캐시와 같은 기준이라야 대사가 성립한다",
    );

    let expiredUseBlocked = false;
    try {
      await db.transaction((tx) =>
        usePoints(tx, {
          customerId: expiredOnly.id,
          amount: 2000,
          title: "만료분 사용 시도",
        }),
      );
    } catch (error) {
      expiredUseBlocked = error instanceof PointExpiredShortageError;
    }
    check(
      expiredUseBlocked,
      "★만료된 적립금은 결제에 쓸 수 없다 — 배치가 늦어도 새지 않는다",
    );
    check(
      (await getPointBalance(db, expiredOnly.id)) === 4000,
      "막힌 시도는 잔액을 건드리지 않았다(트랜잭션 롤백)",
    );

    // 쓸 수 있는 만큼은 정상 사용된다 — 만료분 때문에 전부 막히면 안 된다
    await db.transaction((tx) =>
      usePoints(tx, { customerId: expiredOnly.id, amount: 1000, title: "살아있는 분 사용" }),
    );
    check(
      (await getUsablePointBalance(db, expiredOnly.id)) === 0 &&
        (await getPointBalance(db, expiredOnly.id)) === 3000,
      "살아있는 1000은 정상 사용 — 만료분 3000은 캐시에 남아 배치를 기다린다",
    );
  } finally {
    if (createdCustomerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
