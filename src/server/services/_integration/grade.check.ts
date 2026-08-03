/**
 * 회원등급 검증 (G2·G3) — 등급 보너스 적립과 산정 배치.
 * 실행: npm run check:grade   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **등급이 실제로 적립액을 바꾸고, 배치가 승급·강등을 실제로 수행한다.**
 * 테이블·시드만 있고 어디에도 연결이 없던 상태가 이 도메인의 출발점이었다 —
 * [1]이 그 결함(입구 부재)의 재발을 막는다.
 *
 * 시나리오: [0]★min_recent_spend 컬럼·기준값 [1]★등급 보너스 적립 [2]승급 [3]강등
 *           [4]불변(재실행이 안 건드림) [5]산정 기간 밖 주문 제외 [6]마이페이지 요약
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { customer, orderItem, orders, productVariant } from "@/db/schema";

import {
  calcRecentConfirmedSpend,
  getCustomerGradeSummary,
  loadGradePeriodDays,
  loadGradeRules,
  recalculateCustomerGrades,
} from "../grade.service";
import { applyOrderTransition, type TransitionActor } from "../order-status.service";
import { getPointBalance } from "../point.service";
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

async function main() {
  console.log("PaRaSOL 회원등급 검증 (임시 데이터는 종료 시 삭제)");

  const [variant] = await db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant) throw new Error("활성 variant 없음 — npm run db:seed:dev 먼저 실행");

  const customerIds: number[] = [];
  const orderIds: number[] = [];
  let orderSequence = 0;

  /** 확정 완료 주문을 직접 만든다 — 산정 배치는 orders 행만 본다 */
  async function insertConfirmedOrder(args: {
    customerId: number;
    subtotal: number;
    confirmedAt: Date;
    status?: "confirmed" | "delivered";
  }) {
    orderSequence += 1;
    const [orderRow] = await db
      .insert(orders)
      .values({
        orderNo: `7777${SUFFIX.slice(0, 4)}-${String(orderSequence).padStart(4, "0")}`,
        customerId: args.customerId,
        status: args.status ?? "confirmed",
        channel: "web",
        ordererName: `등급검증${SUFFIX}`,
        ordererPhone: "01044445555",
        recipient: `등급검증${SUFFIX}`,
        phone: "01044445555",
        zipcode: "04168",
        addr1: "서울 마포구 만리재로 00",
        subtotal: args.subtotal,
        shippingFee: 0,
        couponDiscount: 0,
        pointUsed: 0,
        grandTotal: args.subtotal,
        deliveredAt: args.confirmedAt,
        confirmedAt: args.status === "delivered" ? null : args.confirmedAt,
      })
      .returning({ id: orders.id });
    orderIds.push(orderRow.id);
    await db.insert(orderItem).values({
      orderId: orderRow.id,
      variantId: variant.id,
      productName: "등급 검증 상품",
      unitPrice: args.subtotal,
      quantity: 1,
      lineTotal: args.subtotal,
    });
    return orderRow;
  }

  async function makeCustomer(label: string, gradeId: number | null = null) {
    const [created] = await db
      .insert(customer)
      .values({
        name: `${label}${SUFFIX}`,
        email: `gr-${label}-${SUFFIX}@example.com`,
        gradeId,
        isActive: true,
      })
      .returning({ id: customer.id });
    customerIds.push(created.id);
    return created.id;
  }

  async function readGradeId(customerId: number): Promise<number | null> {
    const [row] = await db
      .select({ gradeId: customer.gradeId })
      .from(customer)
      .where(eq(customer.id, customerId));
    return row.gradeId;
  }

  try {
    console.log("\n[0] ★min_recent_spend 컬럼과 기준값 (SQL 적용 확인)");
    const gradeRules = await loadGradeRules(db);
    check(gradeRules.length >= 2, "등급이 2개 이상 시드되어 있다", gradeRules.length);
    const sorted = [...gradeRules].sort((a, b) => a.minRecentSpend - b.minRecentSpend);
    const basicGrade = sorted[0];
    const goldGrade = sorted[1];
    const topGrade = sorted[sorted.length - 1];
    check(
      goldGrade.minRecentSpend > 0,
      `상위 등급 기준 금액이 설정되어 있다 (${goldGrade.gradeName}=${goldGrade.minRecentSpend}) — 0이면 UPDATE 미실행`,
      sorted.map((rule) => `${rule.gradeCode}:${rule.minRecentSpend}`),
    );

    console.log("\n[1] ★등급 보너스가 적립액을 실제로 바꾼다 (입구 검증)");
    const policy = await loadPointPolicy(db);
    const earnBase = 50_000;

    // 같은 금액의 주문 두 건 — 최고 등급 회원 vs 무등급 회원
    const vipBuyer = await makeCustomer("vip", topGrade.gradeId);
    const plainBuyer = await makeCustomer("plain", null);

    for (const buyerId of [vipBuyer, plainBuyer]) {
      const orderRow = await insertConfirmedOrder({
        customerId: buyerId,
        subtotal: earnBase,
        confirmedAt: new Date(),
        status: "delivered",
      });
      const actor: TransitionActor = { role: "customer", id: buyerId };
      await db.transaction((tx) =>
        applyOrderTransition(tx, {
          orderId: orderRow.id,
          toStatus: "confirmed",
          actor,
          memo: "등급 검증",
        }),
      );
    }

    const expectedVipEarn = Math.floor(
      (earnBase * (policy.earnRatePerMille + topGrade.bonusRatePerMille)) / 1000,
    );
    const expectedPlainEarn = Math.floor((earnBase * policy.earnRatePerMille) / 1000);
    check(
      (await getPointBalance(db, vipBuyer)) === expectedVipEarn,
      `★${topGrade.gradeName} 적립 = 기본+보너스 (${expectedVipEarn}원)`,
      { got: await getPointBalance(db, vipBuyer) },
    );
    check(
      (await getPointBalance(db, plainBuyer)) === expectedPlainEarn,
      `무등급 적립 = 기본 적립률 그대로 (${expectedPlainEarn}원) — 등급은 조건이 아니라 더해 주는 것`,
    );
    check(
      expectedVipEarn > expectedPlainEarn,
      "같은 금액인데 등급 보너스만큼 더 쌓였다",
    );

    console.log("\n[2] 승급 — 기준 충족 회원이 배치에서 오른다");
    const climber = await makeCustomer("climb", null);
    await insertConfirmedOrder({
      customerId: climber,
      subtotal: goldGrade.minRecentSpend,
      confirmedAt: new Date(),
    });
    const firstRecalc = await recalculateCustomerGrades(db);
    check(
      (await readGradeId(climber)) === goldGrade.gradeId,
      `기준(${goldGrade.minRecentSpend}) 충족 → ${goldGrade.gradeName} 배정`,
      { report: firstRecalc },
    );

    console.log("\n[3] 강등 — 최근 구매가 없으면 내려간다");
    const faded = await makeCustomer("fade", topGrade.gradeId);
    await recalculateCustomerGrades(db);
    check(
      (await readGradeId(faded)) === basicGrade.gradeId,
      `구매 0원인 ${topGrade.gradeName} → ${basicGrade.gradeName}으로 강등 — 승급만 자동이면 전원 VIP가 된다`,
    );

    console.log("\n[4] 불변 — 재실행이 맞는 등급을 건드리지 않는다");
    const climberGradeBefore = await readGradeId(climber);
    await recalculateCustomerGrades(db);
    check(
      (await readGradeId(climber)) === climberGradeBefore,
      "이미 맞는 등급은 그대로",
    );
    check(
      (await readGradeId(plainBuyer)) === null ||
        (await readGradeId(plainBuyer)) === basicGrade.gradeId,
      "기본 판정 회원은 null 그대로(또는 기본) — 전 회원을 매일 덮어쓰지 않는다",
    );

    console.log("\n[5] 산정 기간 밖 주문은 세지 않는다");
    const periodDays = await loadGradePeriodDays(db);
    const oldSpender = await makeCustomer("old", null);
    await insertConfirmedOrder({
      customerId: oldSpender,
      subtotal: topGrade.minRecentSpend * 2,
      confirmedAt: new Date(Date.now() - (periodDays + 30) * 24 * 60 * 60 * 1000),
    });
    check(
      (await calcRecentConfirmedSpend(db, oldSpender, periodDays)) === 0,
      `${periodDays}일 밖 확정은 합계 0 — 옛 구매로 등급이 유지되지 않는다`,
    );
    await recalculateCustomerGrades(db);
    check((await readGradeId(oldSpender)) === null, "등급도 배정되지 않는다");

    console.log("\n[6] 마이페이지 요약 — 등급·다음 등급까지 금액");
    const summary = await getCustomerGradeSummary(db, climber);
    check(summary?.gradeName === goldGrade.gradeName, "현재 등급 이름", summary);
    if (sorted.length >= 3) {
      const nextGrade = sorted[2];
      check(
        summary?.nextGradeName === nextGrade.gradeName &&
          summary.remainingSpend === nextGrade.minRecentSpend - goldGrade.minRecentSpend,
        `다음 등급까지 남은 금액 (${summary?.remainingSpend})`,
        summary,
      );
    }
    // [1]의 VIP 회원은 구매 5만원뿐이라 [2]~[4]의 재산정에서 **정당하게 강등**됐다.
    // 요약은 그 저장값(배치가 정한 등급)을 보여줘야 한다 — 수동 배정이 산정을 이기면
    // "화면엔 VIP인데 적립은 일반"이 된다
    const vipSummary = await getCustomerGradeSummary(db, vipBuyer);
    check(
      vipSummary?.gradeName === basicGrade.gradeName,
      "저장된 등급이 진실 — 수동 배정도 다음 산정에서 기준대로 정리된다",
      vipSummary,
    );
  } finally {
    if (orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, orderIds));
    }
    if (customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, customerIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
