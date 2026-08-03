import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";

import { claim, claimItem, orderItem, orderItemAddon, orders } from "@/db/schema";
import {
  assertOrderClaimable,
  allowedFeeMethods,
  parseClaimReasonMeta,
  type ClaimFault,
  type ClaimFeeMethod,
  type ClaimType,
} from "@/domain/claim";

import { getActiveCommonCodesWithMeta } from "./common-code.service";
import type { DatabaseClient } from "./db-client";
import { OrderAccessDeniedError } from "./order-query.service";
import { loadShippingPolicy } from "./shipping-policy.service";

/**
 * 클레임 신청 화면의 진입 데이터.
 *
 * 금액 미리보기는 **화면이 도메인 함수로 직접 계산**한다(domain/claim은 순수 모듈이라
 * 클라이언트에서도 쓸 수 있다). 서버는 계산에 필요한 사실(잔여 수량·사유 정책·기본 배송비)만
 * 준다 — 서버가 조합마다 금액을 미리 만들어 내려주면 사유를 바꿀 때마다 왕복해야 하고,
 * 화면이 자체 공식을 두면 접수 시 서버 계산과 어긋난다.
 */

export type ClaimRequestTarget = {
  orderItemId: number;
  productName: string;
  makerName: string | null;
  optionLabel: string | null;
  unitPrice: number;
  /** 주문 수량 */
  orderedQuantity: number;
  /** 이미 접수된(반려 제외) 수량 — 이만큼은 다시 신청할 수 없다 */
  claimedQuantity: number;
  /** 신청 가능한 남은 수량 */
  claimableQuantity: number;
  /** 라인 전량 클레임일 때만 금액·복원에 포함되는 추가상품 합계(설계 D11) */
  addonTotal: number;
  thumbnailPath: string | null;
  thumbnailAlt: string | null;
};

export type ClaimRequestReason = {
  reasonCode: string;
  name: string;
  fault: ClaimFault;
};

export type ClaimRequestView = {
  orderNo: string;
  claimType: ClaimType;
  /** 취소는 전체 주문 단위라 대상 선택 UI가 없다(설계 §2) */
  wholeOrderOnly: boolean;
  targets: ClaimRequestTarget[];
  reasons: ClaimRequestReason[];
  /** 클레임 배송비 계산의 기준 — 화면이 도메인 함수에 그대로 넘긴다 */
  baseShippingFee: number;
  /** 주문 배송비 — 취소 환불액에 더해진다 */
  orderShippingFee: number;
  /** 주문의 쿠폰 할인 — 취소 예상 환불액에서 빠지고, 반품이면 정산 안내의 근거가 된다 */
  orderCouponDiscount: number;
  /** 주문의 적립금 사용액 — 위와 같은 용도 */
  orderPointUsed: number;
  /** 이 유형에서 쓸 수 있는 배송비 수취 방법(반품=차감, 교환=계좌이체) */
  feeMethods: ClaimFeeMethod[];
};

export async function getClaimRequestView(
  database: DatabaseClient,
  input: {
    orderNo: string;
    claimType: ClaimType;
    customerId: number | null;
    guestToken: string | null;
    now?: Date;
  },
): Promise<ClaimRequestView> {
  const [orderRow] = await database
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      customerId: orders.customerId,
      guestToken: orders.guestToken,
      deliveredAt: orders.deliveredAt,
      shippingFee: orders.shippingFee,
      couponDiscount: orders.couponDiscount,
      pointUsed: orders.pointUsed,
    })
    .from(orders)
    .where(eq(orders.orderNo, input.orderNo))
    .limit(1);
  if (!orderRow) throw new OrderAccessDeniedError();

  const isOwner =
    orderRow.customerId !== null
      ? orderRow.customerId === input.customerId
      : orderRow.guestToken !== null && orderRow.guestToken === input.guestToken;
  if (!isOwner) throw new OrderAccessDeniedError();

  // 신청 화면에 들어오는 시점에도 조건을 확인한다 — 목록에서 넘어오는 사이 기한이 지날 수 있다
  assertOrderClaimable({
    claimType: input.claimType,
    orderStatus: orderRow.status,
    deliveredAt: orderRow.deliveredAt,
    now: input.now ?? new Date(),
  });

  const itemRows = await database
    .select({
      orderItemId: orderItem.id,
      productName: orderItem.productName,
      makerName: orderItem.makerName,
      optionLabel: orderItem.variantName,
      unitPrice: orderItem.unitPrice,
      orderedQuantity: orderItem.quantity,
      thumbnailPath: orderItem.thumbnailPath,
      thumbnailAlt: orderItem.thumbnailAlt,
    })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderRow.id))
    .orderBy(asc(orderItem.id));

  const orderItemIds = itemRows.map((row) => row.orderItemId);

  const addonRows =
    orderItemIds.length === 0
      ? []
      : await database
          .select({
            orderItemId: orderItemAddon.orderItemId,
            lineTotal: orderItemAddon.lineTotal,
          })
          .from(orderItemAddon)
          .where(inArray(orderItemAddon.orderItemId, orderItemIds));

  // 이미 접수된 수량(반려 제외) — 잔여 수량 계산의 원천
  const claimedRows =
    orderItemIds.length === 0
      ? []
      : await database
          .select({ orderItemId: claimItem.orderItemId, quantity: claimItem.quantity })
          .from(claimItem)
          .innerJoin(claim, eq(claimItem.claimId, claim.id))
          .where(and(inArray(claimItem.orderItemId, orderItemIds), ne(claim.status, "rejected")));

  const addonTotalByItem = new Map<number, number>();
  for (const addonRow of addonRows) {
    addonTotalByItem.set(
      addonRow.orderItemId,
      (addonTotalByItem.get(addonRow.orderItemId) ?? 0) + addonRow.lineTotal,
    );
  }
  const claimedByItem = new Map<number, number>();
  for (const claimedRow of claimedRows) {
    claimedByItem.set(
      claimedRow.orderItemId,
      (claimedByItem.get(claimedRow.orderItemId) ?? 0) + claimedRow.quantity,
    );
  }

  const targets: ClaimRequestTarget[] = itemRows.map((row) => {
    const claimedQuantity = claimedByItem.get(row.orderItemId) ?? 0;
    return {
      orderItemId: row.orderItemId,
      productName: row.productName,
      makerName: row.makerName,
      optionLabel: row.optionLabel,
      unitPrice: row.unitPrice,
      orderedQuantity: row.orderedQuantity,
      claimedQuantity,
      claimableQuantity: Math.max(0, row.orderedQuantity - claimedQuantity),
      addonTotal: addonTotalByItem.get(row.orderItemId) ?? 0,
      thumbnailPath: row.thumbnailPath,
      thumbnailAlt: row.thumbnailAlt,
    };
  });

  // 사유 목록은 이 유형에 허용된 것만 — 정책은 common_code 시드가 원천이다(RULE-11)
  const reasonRows = await getActiveCommonCodesWithMeta(database, "claim_reason");
  const reasons: ClaimRequestReason[] = [];
  for (const reasonRow of reasonRows) {
    const meta = parseClaimReasonMeta(reasonRow.meta);
    if (!meta || !meta.claimTypes.includes(input.claimType)) continue;
    reasons.push({ reasonCode: reasonRow.code, name: reasonRow.name, fault: meta.fault });
  }

  const shippingPolicy = await loadShippingPolicy(database);

  return {
    orderNo: orderRow.orderNo,
    claimType: input.claimType,
    wholeOrderOnly: input.claimType === "cancel",
    targets,
    reasons,
    baseShippingFee: shippingPolicy.baseFee,
    orderShippingFee: orderRow.shippingFee,
    orderCouponDiscount: orderRow.couponDiscount,
    orderPointUsed: orderRow.pointUsed,
    feeMethods: allowedFeeMethods(input.claimType),
  };
}
