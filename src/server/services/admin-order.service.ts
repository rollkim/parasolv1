import "server-only";

import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { orderItem, orders, payment, shipment } from "@/db/schema";
import {
  allowedTargets,
  orderStatusLabel,
  type OrderStatus,
} from "@/domain/order";

import { applyOrderTransition } from "./order-status.service";
import type { DatabaseClient } from "./db-client";
import type { TransitionActor } from "./order-status.service";

/**
 * 관리자 주문 관리 — 목록·상세·상태 변경·송장 등록.
 *
 * 상태 변경은 고객 경로와 **같은 초크포인트**(applyOrderTransition)를 지난다.
 * 관리자라고 별도 경로를 두면 전이표·이력이 두 벌이 되어 반드시 어긋난다.
 */

/** 목록 탭 — 목업 기준. cancelled 탭은 취소·반품을 함께 보여준다 */
export type AdminOrderTab =
  | "all"
  | "paid"
  | "preparing"
  | "shipping"
  | "delivered"
  | "cancelled";

const TAB_STATUSES: Record<AdminOrderTab, OrderStatus[] | null> = {
  all: null,
  paid: ["paid"],
  preparing: ["preparing"],
  shipping: ["shipping"],
  delivered: ["delivered", "confirmed"],
  // 취소/반품 탭 — 반품은 클레임 축이라 주문 상태로는 cancelled만 잡힌다
  cancelled: ["cancelled"],
};

export type AdminOrderCard = {
  orderId: number;
  orderNo: string;
  orderStatus: OrderStatus;
  orderStatusLabel: string;
  orderedAt: Date;
  ordererName: string;
  ordererPhone: string;
  isGuestOrder: boolean;
  grandTotal: number;
  leadProductName: string;
  itemCount: number;
  /** 송장이 등록됐는지 — 목록에서 '송장 등록' 필요 건을 가려낸다 */
  hasTrackingNo: boolean;
};

export type AdminOrderListResult = {
  cards: AdminOrderCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** 탭별 건수 — 뱃지에 쓴다 */
  tabCounts: Record<AdminOrderTab, number>;
};

const ADMIN_ORDER_PAGE_SIZE = 20;

/**
 * 주문 목록. 검색은 주문번호·주문자명·연락처를 한 입력으로 받는다 —
 * CS가 전화를 받으며 쓰는 화면이라 무엇으로 검색할지 고르게 하면 느려진다.
 */
export async function listAdminOrders(
  database: DatabaseClient,
  input: { tab?: AdminOrderTab; keyword?: string; page?: number } = {},
): Promise<AdminOrderListResult> {
  const tab = input.tab ?? "all";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  const tabStatuses = TAB_STATUSES[tab];
  const statusFilter = tabStatuses ? inArray(orders.status, tabStatuses) : undefined;
  const keywordFilter = keyword
    ? or(
        ilike(orders.orderNo, `%${keyword}%`),
        ilike(orders.ordererName, `%${keyword}%`),
        // 연락처는 정규화 저장이라 입력의 하이픈을 떼고 비교한다
        ilike(orders.ordererPhone, `%${keyword.replace(/[^0-9]/g, "")}%`),
      )
    : undefined;
  const listFilter = and(statusFilter, keywordFilter);

  const [totalRow] = await database
    .select({ total: count() })
    .from(orders)
    .where(listFilter);
  const totalCount = totalRow?.total ?? 0;

  const orderRows = await database
    .select({
      orderId: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      createdAt: orders.createdAt,
      ordererName: orders.ordererName,
      ordererPhone: orders.ordererPhone,
      customerId: orders.customerId,
      grandTotal: orders.grandTotal,
    })
    .from(orders)
    .where(listFilter)
    .orderBy(desc(orders.id))
    .limit(ADMIN_ORDER_PAGE_SIZE)
    .offset((page - 1) * ADMIN_ORDER_PAGE_SIZE);

  const orderIds = orderRows.map((row) => row.orderId);
  const itemRows =
    orderIds.length === 0
      ? []
      : await database
          .select({ orderId: orderItem.orderId, productName: orderItem.productName })
          .from(orderItem)
          .where(inArray(orderItem.orderId, orderIds));
  const shipmentRows =
    orderIds.length === 0
      ? []
      : await database
          .select({ orderId: shipment.orderId, trackingNo: shipment.trackingNo })
          .from(shipment)
          .where(inArray(shipment.orderId, orderIds));

  // 탭 뱃지 — 한 번의 group by로 전 상태 건수를 얻는다(탭마다 쿼리하지 않는다)
  const statusCountRows = await database
    .select({ status: orders.status, total: count() })
    .from(orders)
    .groupBy(orders.status);
  const countByStatus = new Map(statusCountRows.map((row) => [row.status, row.total]));
  const sumOf = (statuses: OrderStatus[]) =>
    statuses.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0);

  const tabCounts: Record<AdminOrderTab, number> = {
    all: statusCountRows.reduce((sum, row) => sum + row.total, 0),
    paid: sumOf(["paid"]),
    preparing: sumOf(["preparing"]),
    shipping: sumOf(["shipping"]),
    delivered: sumOf(["delivered", "confirmed"]),
    cancelled: sumOf(["cancelled"]),
  };

  return {
    cards: orderRows.map((row) => {
      const lines = itemRows.filter((item) => item.orderId === row.orderId);
      return {
        orderId: row.orderId,
        orderNo: row.orderNo,
        orderStatus: row.status,
        orderStatusLabel: orderStatusLabel(row.status),
        orderedAt: row.createdAt,
        ordererName: row.ordererName,
        ordererPhone: row.ordererPhone,
        isGuestOrder: row.customerId === null,
        grandTotal: row.grandTotal,
        leadProductName: lines[0]?.productName ?? "(품목 없음)",
        itemCount: lines.length,
        hasTrackingNo: shipmentRows.some(
          (row2) => row2.orderId === row.orderId && row2.trackingNo !== null,
        ),
      };
    }),
    totalCount,
    page,
    pageSize: ADMIN_ORDER_PAGE_SIZE,
    tabCounts,
  };
}

export class AdminOrderNotFoundError extends Error {
  constructor(readonly orderNo: string) {
    super(`주문을 찾을 수 없습니다: ${orderNo}`);
    this.name = "AdminOrderNotFoundError";
  }
}

export type AdminOrderDetail = {
  orderId: number;
  orderNo: string;
  orderStatus: OrderStatus;
  orderStatusLabel: string;
  /** 이 관리자가 지금 옮길 수 있는 상태 — 도메인 전이표가 정한다 */
  nextStatuses: { status: OrderStatus; label: string }[];
  orderedAt: Date;
  orderer: { name: string; phone: string; email: string | null };
  isGuestOrder: boolean;
  shippingAddress: {
    recipient: string;
    phone: string;
    zipcode: string;
    addr1: string;
    addr2: string | null;
    deliveryMemo: string | null;
  };
  amounts: { subtotal: number; shippingFee: number; grandTotal: number };
  paymentSummary: { status: string; methodLabel: string | null; approvedAt: Date | null } | null;
  items: {
    orderItemId: number;
    productName: string;
    optionLabel: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  shipmentInfo: { carrierCode: string | null; trackingNo: string | null; shippedAt: Date | null } | null;
};

/** 관리자 상세 — 고객 화면과 달리 마스킹하지 않는다(CS가 연락처로 전화한다) */
export async function getAdminOrderDetail(
  database: DatabaseClient,
  orderNo: string,
): Promise<AdminOrderDetail> {
  const [orderRow] = await database
    .select()
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .limit(1);
  if (!orderRow) throw new AdminOrderNotFoundError(orderNo);

  const items = await database
    .select({
      orderItemId: orderItem.id,
      productName: orderItem.productName,
      optionLabel: orderItem.variantName,
      unitPrice: orderItem.unitPrice,
      quantity: orderItem.quantity,
      lineTotal: orderItem.lineTotal,
    })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderRow.id));

  const [paymentRow] = await database
    .select({
      status: payment.status,
      methodLabel: payment.method,
      approvedAt: payment.approvedAt,
    })
    .from(payment)
    .where(eq(payment.orderId, orderRow.id))
    .orderBy(desc(payment.id))
    .limit(1);

  const [shipmentRow] = await database
    .select({
      carrierCode: shipment.carrier,
      trackingNo: shipment.trackingNo,
      shippedAt: shipment.shippedAt,
    })
    .from(shipment)
    .where(eq(shipment.orderId, orderRow.id))
    .orderBy(desc(shipment.id))
    .limit(1);

  return {
    orderId: orderRow.id,
    orderNo: orderRow.orderNo,
    orderStatus: orderRow.status,
    orderStatusLabel: orderStatusLabel(orderRow.status),
    // 화면이 버튼을 임의로 그리지 않게 서버가 가능한 전이만 내려준다
    nextStatuses: allowedTargets(orderRow.status, "admin").map((status) => ({
      status,
      label: orderStatusLabel(status),
    })),
    orderedAt: orderRow.createdAt,
    orderer: {
      name: orderRow.ordererName,
      phone: orderRow.ordererPhone,
      email: orderRow.ordererEmail,
    },
    isGuestOrder: orderRow.customerId === null,
    shippingAddress: {
      recipient: orderRow.recipient,
      phone: orderRow.phone,
      zipcode: orderRow.zipcode,
      addr1: orderRow.addr1,
      addr2: orderRow.addr2,
      deliveryMemo: orderRow.deliveryMemo,
    },
    amounts: {
      subtotal: orderRow.subtotal,
      shippingFee: orderRow.shippingFee,
      grandTotal: orderRow.grandTotal,
    },
    paymentSummary: paymentRow ?? null,
    items,
    shipmentInfo: shipmentRow ?? null,
  };
}

export class InvoiceRequiresPreparingError extends Error {
  constructor() {
    super("배송 준비중 상태에서만 송장을 등록할 수 있습니다.");
    this.name = "InvoiceRequiresPreparingError";
  }
}

/**
 * 송장 등록 — 등록과 동시에 배송중으로 전이한다(목업 동작).
 *
 * 두 작업을 한 트랜잭션에 묶는 이유: 송장만 남고 상태가 그대로면 고객 화면에
 * "배송 준비중인데 송장이 있는" 모순이 보인다. 전이가 실패하면 송장도 남지 않아야 한다.
 */
export async function registerShipmentInvoice(
  database: DatabaseClient,
  input: {
    orderNo: string;
    carrierCode: string;
    trackingNo: string;
    actor: TransitionActor;
  },
): Promise<{ orderNo: string; orderStatus: OrderStatus }> {
  return database.transaction(async (tx) => {
    const [orderRow] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.orderNo, input.orderNo))
      .for("update")
      .limit(1);
    if (!orderRow) throw new AdminOrderNotFoundError(input.orderNo);
    if (orderRow.status !== "preparing") throw new InvoiceRequiresPreparingError();

    const [existing] = await tx
      .select({ id: shipment.id })
      .from(shipment)
      .where(and(eq(shipment.orderId, orderRow.id), sql`${shipment.claimId} IS NULL`))
      .limit(1);

    if (existing) {
      await tx
        .update(shipment)
        .set({
          carrier: input.carrierCode,
          trackingNo: input.trackingNo,
          shippedAt: sql`now()`,
        })
        .where(eq(shipment.id, existing.id));
    } else {
      await tx.insert(shipment).values({
        orderId: orderRow.id,
        carrier: input.carrierCode,
        trackingNo: input.trackingNo,
        shippedAt: sql`now()`,
      });
    }

    await applyOrderTransition(tx, {
      orderId: orderRow.id,
      toStatus: "shipping",
      actor: input.actor,
      memo: `송장 등록 (${input.carrierCode} ${input.trackingNo})`,
    });

    return { orderNo: input.orderNo, orderStatus: "shipping" as OrderStatus };
  });
}

/** 상태 변경 — 고객 경로와 같은 초크포인트를 지난다(전이표·이력 공유) */
export async function changeAdminOrderStatus(
  database: DatabaseClient,
  input: {
    orderNo: string;
    toStatus: OrderStatus;
    actor: TransitionActor;
    memo?: string | null;
  },
): Promise<{ orderNo: string; changed: boolean; orderStatus: OrderStatus }> {
  return database.transaction(async (tx) => {
    const [orderRow] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.orderNo, input.orderNo))
      .limit(1);
    if (!orderRow) throw new AdminOrderNotFoundError(input.orderNo);

    const result = await applyOrderTransition(tx, {
      orderId: orderRow.id,
      toStatus: input.toStatus,
      actor: input.actor,
      memo: input.memo ?? undefined,
    });
    return {
      orderNo: input.orderNo,
      changed: result.changed,
      orderStatus: result.toStatus,
    };
  });
}
