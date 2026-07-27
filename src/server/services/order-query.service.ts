import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { orderItem, orderItemAddon, orders, payment, shipment } from "@/db/schema";
import { effectiveListPrice } from "@/domain/cart";
import {
  maskAddressDetail,
  maskOrdererName,
  maskPhone,
  maskTrackingNo,
  orderStatusLabel,
  orderTimelineFor,
  type OrderStatus,
  type OrderTimeline,
} from "@/domain/order";
import { normalizePhone } from "@/domain/phone";

import type { QueryClient } from "./db-client";

/**
 * 주문 조회 서비스 — 주문완료·비회원 주문조회·(추후)회원 주문상세가 공유한다.
 *
 * 조립은 여기서, 규칙(마스킹·상태 라벨·타임라인)은 domain/order가 소유한다(RULE-14).
 * 마스킹은 **서버에서 마친 값만 내려보낸다** — 원값을 보내고 화면에서 가리면
 * 클라이언트 번들에 PII가 그대로 남는다.
 */

export type OrderViewAddon = {
  addonName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type OrderViewItem = {
  orderItemId: number;
  productName: string;
  /** 만든 곳 — 주문 시점 스냅샷 */
  makerName: string | null;
  optionLabel: string | null;
  /** 주문 시점 정가 — 취소선 표시용. 할인 없었으면 null */
  listPrice: number | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  addons: OrderViewAddon[];
  /** 주문 시점 대표 이미지 스냅샷 — 상품이 삭제돼도 유지된다 */
  thumbnailPath: string | null;
  thumbnailAlt: string | null;
};

export type OrderViewShipment = {
  carrierCode: string | null;
  /** 앞 1·뒤 2자리만 노출된 송장번호 */
  maskedTrackingNo: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
};

export type OrderView = {
  orderNo: string;
  orderStatus: OrderStatus;
  orderStatusLabel: string;
  timeline: OrderTimeline;
  orderedAt: Date;
  /** 비회원 주문이면 true — 주문완료 화면의 가입 유도 배너 조건 */
  isGuestOrder: boolean;
  orderer: { name: string; phone: string; email: string | null };
  shippingAddress: {
    recipient: string;
    phone: string;
    zipcode: string;
    addr1: string;
    addr2: string | null;
    deliveryMemo: string | null;
  };
  amounts: {
    /** 정가 합계(추가상품 제외) — 화면의 '총 상품금액' 행 */
    listTotal: number;
    /** 상품 할인(정가 - 판매가) — 주문 시점 스냅샷 기준이라 나중에 값이 흔들리지 않는다 */
    productDiscount: number;
    /** 판매가 상품 합계(추가상품 제외) */
    goodsTotal: number;
    /** 추가상품 합계 — 화면 결제정보 행. order_item_addon 합산 */
    addonTotal: number;
    subtotal: number;
    shippingFee: number;
    couponDiscount: number;
    pointUsed: number;
    grandTotal: number;
  };
  paymentSummary: {
    status: string;
    /** 결제수단 표시명(카드·계좌이체…) — 승인 전이면 null */
    methodLabel: string | null;
    approvedAt: Date | null;
  } | null;
  shipmentSummary: OrderViewShipment | null;
  items: OrderViewItem[];
};

/** 마스킹 수준 — 같은 조립 로직을 노출 범위만 달리해 재사용한다 */
export type OrderViewAudience = "owner" | "guest_lookup";

/**
 * 주문 1건을 화면용 뷰로 조립한다.
 * audience가 guest_lookup이면 이름·연락처·상세주소를 마스킹한 값만 담는다.
 */
async function buildOrderView(
  client: QueryClient,
  orderRow: typeof orders.$inferSelect,
  audience: OrderViewAudience,
): Promise<OrderView> {
  const itemRows = await client
    .select({
      orderItemId: orderItem.id,
      productId: orderItem.productId,
      productName: orderItem.productName,
      makerName: orderItem.makerName,
      variantName: orderItem.variantName,
      listPrice: orderItem.listPrice,
      unitPrice: orderItem.unitPrice,
      quantity: orderItem.quantity,
      lineTotal: orderItem.lineTotal,
      thumbnailPath: orderItem.thumbnailPath,
      thumbnailAlt: orderItem.thumbnailAlt,
    })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderRow.id))
    .orderBy(asc(orderItem.id));

  const addonRows = await client
    .select({
      orderItemId: orderItemAddon.orderItemId,
      addonName: orderItemAddon.addonName,
      unitPrice: orderItemAddon.unitPrice,
      quantity: orderItemAddon.quantity,
      lineTotal: orderItemAddon.lineTotal,
    })
    .from(orderItemAddon)
    .innerJoin(orderItem, eq(orderItemAddon.orderItemId, orderItem.id))
    .where(eq(orderItem.orderId, orderRow.id))
    .orderBy(asc(orderItemAddon.id));

  // 이미지·정가 모두 주문 스냅샷에서 온다 — 상품이 삭제돼도 주문 화면은 그대로다
  const items: OrderViewItem[] = itemRows.map((row) => ({
    orderItemId: row.orderItemId,
    productName: row.productName,
    makerName: row.makerName,
    optionLabel: row.variantName,
    listPrice: row.listPrice,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    lineTotal: row.lineTotal,
    addons: addonRows
      .filter((addon) => addon.orderItemId === row.orderItemId)
      .map((addon) => ({
        addonName: addon.addonName,
        unitPrice: addon.unitPrice,
        quantity: addon.quantity,
        lineTotal: addon.lineTotal,
      })),
    thumbnailPath: row.thumbnailPath,
    thumbnailAlt: row.thumbnailAlt,
  }));

  const [paymentRow] = await client
    .select({
      status: payment.status,
      methodLabel: payment.method,
      approvedAt: payment.approvedAt,
    })
    .from(payment)
    .where(eq(payment.orderId, orderRow.id))
    .orderBy(desc(payment.id))
    .limit(1);

  const [shipmentRow] = await client
    .select({
      carrierCode: shipment.carrier,
      trackingNo: shipment.trackingNo,
      shippedAt: shipment.shippedAt,
      deliveredAt: shipment.deliveredAt,
    })
    .from(shipment)
    .where(eq(shipment.orderId, orderRow.id))
    .orderBy(desc(shipment.id))
    .limit(1);

  const isGuestLookup = audience === "guest_lookup";
  const addonTotal = items.reduce(
    (sum, item) => sum + item.addons.reduce((addonSum, addon) => addonSum + addon.lineTotal, 0),
    0,
  );
  const goodsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  // 정가는 주문 스냅샷 값이라 상품이 바뀌거나 삭제돼도 그대로다
  const listTotal = items.reduce(
    (sum, item) => sum + effectiveListPrice(item.unitPrice, item.listPrice) * item.quantity,
    0,
  );

  return {
    orderNo: orderRow.orderNo,
    orderStatus: orderRow.status,
    orderStatusLabel: orderStatusLabel(orderRow.status),
    timeline: orderTimelineFor(orderRow.status),
    orderedAt: orderRow.createdAt,
    isGuestOrder: orderRow.customerId === null,
    orderer: {
      name: isGuestLookup ? maskOrdererName(orderRow.ordererName) : orderRow.ordererName,
      phone: isGuestLookup ? maskPhone(orderRow.ordererPhone) : orderRow.ordererPhone,
      // 이메일은 비회원 조회 화면이 표시하지 않는다 — 아예 담지 않는다
      email: isGuestLookup ? null : orderRow.ordererEmail,
    },
    shippingAddress: {
      recipient: isGuestLookup ? maskOrdererName(orderRow.recipient) : orderRow.recipient,
      phone: isGuestLookup ? maskPhone(orderRow.phone) : orderRow.phone,
      zipcode: orderRow.zipcode,
      addr1: orderRow.addr1,
      addr2: isGuestLookup ? maskAddressDetail(orderRow.addr2) : orderRow.addr2,
      deliveryMemo: isGuestLookup ? null : orderRow.deliveryMemo,
    },
    amounts: {
      listTotal,
      productDiscount: listTotal - goodsTotal,
      goodsTotal,
      addonTotal,
      subtotal: orderRow.subtotal,
      shippingFee: orderRow.shippingFee,
      couponDiscount: orderRow.couponDiscount,
      pointUsed: orderRow.pointUsed,
      grandTotal: orderRow.grandTotal,
    },
    paymentSummary: paymentRow
      ? {
          status: paymentRow.status,
          methodLabel: paymentRow.methodLabel,
          approvedAt: paymentRow.approvedAt,
        }
      : null,
    shipmentSummary: shipmentRow
      ? {
          carrierCode: shipmentRow.carrierCode,
          maskedTrackingNo: shipmentRow.trackingNo
            ? maskTrackingNo(shipmentRow.trackingNo)
            : null,
          shippedAt: shipmentRow.shippedAt,
          deliveredAt: shipmentRow.deliveredAt,
        }
      : null,
    items,
  };
}

/** 조회 권한 없음·미존재를 구분하지 않는다 — 주문 존재 여부 자체가 정보다 */
export class OrderAccessDeniedError extends Error {
  constructor() {
    super("입력하신 정보와 일치하는 주문이 없습니다.");
    this.name = "OrderAccessDeniedError";
  }
}

/**
 * 주문완료 화면 — 결제 직후 본인이 보는 화면이라 마스킹하지 않는다.
 * 회원은 세션 customerId로, 비회원은 발급받은 guestToken으로 소유를 증명한다
 * (비회원 조회 화면의 '주문번호+연락처'와 달리, 결제 직후 리다이렉트 경로 전용).
 */
export async function getOrderResult(
  client: QueryClient,
  input: { orderNo: string; customerId: number | null; guestToken: string | null },
): Promise<OrderView> {
  const [orderRow] = await client
    .select()
    .from(orders)
    .where(eq(orders.orderNo, input.orderNo))
    .limit(1);
  if (!orderRow) throw new OrderAccessDeniedError();

  const isOwner =
    orderRow.customerId !== null
      ? orderRow.customerId === input.customerId
      : orderRow.guestToken !== null && orderRow.guestToken === input.guestToken;
  if (!isOwner) throw new OrderAccessDeniedError();

  return buildOrderView(client, orderRow, "owner");
}

/**
 * 비회원 주문조회 — 주문번호 + 주문자 연락처 2요소.
 *
 * 연락처는 정규화(숫자만)해 비교한다 — 저장은 정규화된 값이고 입력은 하이픈이 섞이므로
 * 양쪽을 같은 형태로 맞추지 않으면 정당한 주문자가 영구히 조회에 실패한다.
 * 실패는 원인을 구분하지 않는다 — 주문번호 존재 여부가 새면 무차별 탐색의 단서가 된다.
 */
export async function lookupGuestOrder(
  client: QueryClient,
  input: { orderNo: string; ordererPhone: string },
): Promise<OrderView> {
  const [orderRow] = await client
    .select()
    .from(orders)
    .where(eq(orders.orderNo, input.orderNo.trim()))
    .limit(1);
  if (!orderRow) throw new OrderAccessDeniedError();

  if (normalizePhone(orderRow.ordererPhone) !== normalizePhone(input.ordererPhone)) {
    throw new OrderAccessDeniedError();
  }

  return buildOrderView(client, orderRow, "guest_lookup");
}
