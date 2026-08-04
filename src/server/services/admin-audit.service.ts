import "server-only";

import { count, desc, eq } from "drizzle-orm";

import {
  claim,
  claimStatusHistory,
  inventoryLog,
  orders,
  orderStatusHistory,
  payment,
  paymentCancellation,
  productVariant,
  product,
} from "@/db/schema";
import { orderStatusLabel } from "@/domain/order";
import { claimStatusLabel } from "@/domain/claim";

import type { DatabaseClient } from "./db-client";

/**
 * 운영 기록 조회 (/admin/audit-logs — 그동안 죽은 메뉴였다).
 *
 * **새 테이블을 만들지 않는다.** 주문·클레임 상태 이력, 재고 원장, 환불 원장은 이미
 * append-only로 쌓이고 있다 — 이 화면은 그 네 원장을 읽기 좋게 펼칠 뿐이다.
 * 별도 audit 테이블을 두면 같은 사건이 두 곳에 적히고, 언젠가 어긋난다.
 *
 * 쓰임새: "이 주문 누가 취소했어요?" "재고가 왜 줄었죠?" 같은 CS 분쟁에
 * 화면에서 바로 답한다 — 이 화면이 없으면 그 질문마다 DB를 열어야 한다.
 */

export const AUDIT_PAGE_SIZE = 20;

export type AuditLogKind = "order" | "claim" | "stock" | "refund";

export type AuditLogRow = {
  /** 어떤 문서에 대한 기록인지 — 주문번호·클레임번호·상품명 */
  refLabel: string;
  /** 무슨 일이 있었는지 한 문장 */
  summary: string;
  /** 누가 — "admin:1" / "customer:5" / "system" 규약 그대로(운영자용 화면이라 원문이 정확하다) */
  actor: string;
  memo: string | null;
  occurredAt: Date;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export async function listAuditLogs(
  database: DatabaseClient,
  input: { kind: AuditLogKind; page?: number },
): Promise<AuditLogPage> {
  const page = Math.max(1, input.page ?? 1);
  const offset = (page - 1) * AUDIT_PAGE_SIZE;

  if (input.kind === "order") {
    const [totalRow] = await database.select({ total: count() }).from(orderStatusHistory);
    const rows = await database
      .select({
        orderNo: orders.orderNo,
        fromStatus: orderStatusHistory.fromStatus,
        toStatus: orderStatusHistory.toStatus,
        actor: orderStatusHistory.actor,
        memo: orderStatusHistory.memo,
        occurredAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .innerJoin(orders, eq(orderStatusHistory.orderId, orders.id))
      .orderBy(desc(orderStatusHistory.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset(offset);
    return {
      rows: rows.map((row) => ({
        refLabel: row.orderNo,
        summary:
          row.fromStatus === null
            ? `주문 접수 → ${orderStatusLabel(row.toStatus)}`
            : `${orderStatusLabel(row.fromStatus)} → ${orderStatusLabel(row.toStatus)}`,
        actor: row.actor,
        memo: row.memo,
        occurredAt: row.occurredAt,
      })),
      totalCount: totalRow?.total ?? 0,
      page,
      pageSize: AUDIT_PAGE_SIZE,
    };
  }

  if (input.kind === "claim") {
    const [totalRow] = await database.select({ total: count() }).from(claimStatusHistory);
    const rows = await database
      .select({
        claimNo: claim.claimNo,
        fromStatus: claimStatusHistory.fromStatus,
        toStatus: claimStatusHistory.toStatus,
        actor: claimStatusHistory.actor,
        memo: claimStatusHistory.memo,
        occurredAt: claimStatusHistory.createdAt,
      })
      .from(claimStatusHistory)
      .innerJoin(claim, eq(claimStatusHistory.claimId, claim.id))
      .orderBy(desc(claimStatusHistory.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset(offset);
    return {
      rows: rows.map((row) => ({
        refLabel: row.claimNo,
        summary:
          row.fromStatus === null
            ? `클레임 접수 → ${claimStatusLabel(row.toStatus)}`
            : `${claimStatusLabel(row.fromStatus)} → ${claimStatusLabel(row.toStatus)}`,
        actor: row.actor,
        memo: row.memo,
        occurredAt: row.occurredAt,
      })),
      totalCount: totalRow?.total ?? 0,
      page,
      pageSize: AUDIT_PAGE_SIZE,
    };
  }

  if (input.kind === "stock") {
    const [totalRow] = await database.select({ total: count() }).from(inventoryLog);
    const rows = await database
      .select({
        productName: product.name,
        variantSku: productVariant.sku,
        delta: inventoryLog.delta,
        stockAfter: inventoryLog.stockAfter,
        reason: inventoryLog.reason,
        refId: inventoryLog.refId,
        memo: inventoryLog.memo,
        actor: inventoryLog.createdBy,
        occurredAt: inventoryLog.createdAt,
      })
      .from(inventoryLog)
      // 대상이 하드삭제됐으면 null — 이력은 남긴다(append-only 원칙)
      .leftJoin(productVariant, eq(inventoryLog.variantId, productVariant.id))
      .leftJoin(product, eq(productVariant.productId, product.id))
      .orderBy(desc(inventoryLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset(offset);
    return {
      rows: rows.map((row) => ({
        refLabel: row.productName
          ? `${row.productName}${row.variantSku ? ` (${row.variantSku})` : ""}`
          : "(삭제된 상품)",
        summary: `${row.delta > 0 ? "+" : ""}${row.delta}개 (잔량 ${row.stockAfter}) · ${row.reason}${
          row.refId ? ` · ${row.refId}` : ""
        }`,
        actor: row.actor ?? "system",
        memo: row.memo,
        occurredAt: row.occurredAt,
      })),
      totalCount: totalRow?.total ?? 0,
      page,
      pageSize: AUDIT_PAGE_SIZE,
    };
  }

  // refund — 환불 원장(채널 무관 전체)
  const [totalRow] = await database.select({ total: count() }).from(paymentCancellation);
  const rows = await database
    .select({
      orderNo: orders.orderNo,
      amount: paymentCancellation.amount,
      refundChannel: paymentCancellation.refundChannel,
      reason: paymentCancellation.reason,
      actor: paymentCancellation.createdBy,
      occurredAt: paymentCancellation.createdAt,
    })
    .from(paymentCancellation)
    .innerJoin(payment, eq(paymentCancellation.paymentId, payment.id))
    .innerJoin(orders, eq(payment.orderId, orders.id))
    .orderBy(desc(paymentCancellation.id))
    .limit(AUDIT_PAGE_SIZE)
    .offset(offset);
  return {
    rows: rows.map((row) => ({
      refLabel: row.orderNo,
      summary: `${row.amount.toLocaleString("ko-KR")}원 환불 · ${row.refundChannel}`,
      actor: row.actor ?? "system",
      memo: row.reason,
      occurredAt: row.occurredAt,
    })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: AUDIT_PAGE_SIZE,
  };
}
