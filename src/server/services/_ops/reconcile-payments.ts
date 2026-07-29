/**
 * 결제 대사 실행기 — 운영 작업(ops)이다. 검증 스크립트(_integration)와 달리
 * **실제 데이터를 고친다**: 미확정 결제를 PG에 되물어 확정한다.
 *
 * 실행: npm run ops:reconcile            (대사 + 보고)
 *       npm run ops:reconcile -- --dry   (보고만, 아무것도 고치지 않음)
 *
 * 배포 시 크론에 물린다(예: 10분마다). 지금은 수동 실행이며, 크론 배선은 서버 작업이다.
 * 자동으로 고치는 것은 미확정 결제뿐이고, 나머지 불일치는 사람이 판단하도록 보고만 한다.
 */

import "dotenv/config";

import { db } from "@/db";
import { getPaymentGateway } from "@/server/payments";
import {
  findReconcileAnomalies,
  reconcilePendingPayments,
} from "@/server/services/payment-reconcile.service";

function printAnomalies(anomalies: Awaited<ReturnType<typeof findReconcileAnomalies>>) {
  console.log("\n── 사람이 봐야 하는 불일치 (자동 조치 없음) ──");

  const sections: { label: string; rows: unknown[]; note: string }[] = [
    {
      label: "환불됐는데 주문이 진행 중",
      rows: anomalies.refundedButActiveOrders,
      note: "돈은 돌려줬는데 상품이 나갈 수 있습니다. 주문 상태를 확인하세요.",
    },
    {
      label: "종결 클레임인데 환불 원장 없음",
      rows: anomalies.settledClaimsWithoutRefund,
      note: "환불 확정 트랜잭션이 끊긴 흔적입니다. PG 콘솔과 대조하세요.",
    },
    {
      label: "결제완료 주문인데 결제 건 없음",
      rows: anomalies.paidOrdersWithoutPayment,
      note: "수동 조작이나 데이터 사고일 수 있습니다.",
    },
  ];

  let anomalyTotal = 0;
  for (const section of sections) {
    if (section.rows.length === 0) continue;
    anomalyTotal += section.rows.length;
    console.log(`\n  ⚠ ${section.label}: ${section.rows.length}건 — ${section.note}`);
    for (const row of section.rows) console.log(`      ${JSON.stringify(row)}`);
  }
  if (anomalyTotal === 0) console.log("  ✓ 없음");
  return anomalyTotal;
}

async function main() {
  const isDryRun = process.argv.includes("--dry");
  console.log(`PaRaSOL 결제 대사 ${isDryRun ? "(보고만)" : "(미확정 결제 확정 포함)"}`);

  if (isDryRun) {
    const anomalies = await findReconcileAnomalies(db);
    printAnomalies(anomalies);
    process.exit(0);
  }

  const report = await reconcilePendingPayments(db, getPaymentGateway());

  console.log(`\n── 미확정 결제 대사: 대상 ${report.scannedCount}건 ──`);
  if (report.items.length === 0) {
    console.log("  ✓ 끊긴 결제 없음");
  }
  for (const item of report.items) {
    const mark = item.outcome === "confirmed" ? "✓" : item.outcome === "notPaid" ? "·" : "✗";
    const label =
      item.outcome === "confirmed"
        ? "확정됨 — PG에 결제가 있었습니다"
        : item.outcome === "notPaid"
          ? "미결제 — 결제창을 닫은 주문입니다"
          : "실패";
    console.log(`  ${mark} ${item.orderNo} ${label}`);
    if (item.message && item.outcome === "failed") console.log(`      ${item.message}`);
  }

  const failedCount = report.items.filter((item) => item.outcome === "failed").length;
  const anomalyTotal = printAnomalies(report.anomalies);

  console.log(
    `\n결과: 확정 ${report.items.filter((item) => item.outcome === "confirmed").length} · ` +
      `미결제 ${report.items.filter((item) => item.outcome === "notPaid").length} · ` +
      `실패 ${failedCount} · 불일치 ${anomalyTotal}`,
  );
  // 실패나 불일치가 있으면 비정상 종료 — 크론이 알림을 띄울 수 있게
  process.exit(failedCount > 0 || anomalyTotal > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\n대사 중 오류:", error);
  process.exit(1);
});
