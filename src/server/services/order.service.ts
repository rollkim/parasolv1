import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  cart,
  orderItem,
  orderItemAddon,
  orders,
  orderStatusHistory,
  payment,
} from "@/db/schema";
import {
  buildOrderDraft,
  type OrderDraftLine,
} from "@/domain/order";

import { getCartWithItems, type CartLine } from "./cart.service";
import type { DatabaseClient, QueryClient } from "./db-client";
import { serializeActor } from "./order-status.service";
import { allocateOrderNo } from "./order-number.service";
import { getSiteSetting } from "./site-setting.service";
import type { ShippingPolicy } from "@/domain/cart";

/**
 * 주문 서비스 — 생성(체크아웃) 트랜잭션.
 *
 * 설계 확정(§2 단계1): 이 시점에는 **재고를 차감하지 않고 카트도 비우지 않는다.**
 * "재고 차감됨 ⇔ 결제 완료(paid)"라는 불변식을 지키기 위해서다. 결제창에서 이탈하거나
 * 결제가 거절되는 흔한 경우에 재고가 묶이지 않고, 되돌리는 청소 로직도 필요 없다.
 *
 * 금액은 트랜잭션 안에서 다시 계산한다(RULE-11) — 클라이언트가 보낸 금액은 신뢰하지 않고,
 * 카트 화면을 본 뒤 가격이 바뀌었을 수 있으므로 결제 직전 값으로 확정한다.
 */

const DEFAULT_SHIPPING_POLICY: ShippingPolicy = { baseFee: 3000, freeThreshold: 30000 };

async function loadShippingPolicy(client: QueryClient): Promise<ShippingPolicy> {
  const stored = await getSiteSetting(client, "shipping_policy");
  if (stored && typeof stored === "object") {
    const candidate = stored as Partial<ShippingPolicy>;
    if (
      typeof candidate.baseFee === "number" &&
      typeof candidate.freeThreshold === "number"
    ) {
      return { baseFee: candidate.baseFee, freeThreshold: candidate.freeThreshold };
    }
  }
  return DEFAULT_SHIPPING_POLICY;
}

/** 카트 라인 → 도메인 입력. 주문 가능 여부 판정은 카트 서비스가 이미 계산한 값을 따른다 */
function toDraftLine(line: CartLine): OrderDraftLine {
  return {
    variantId: line.variantId,
    productId: line.productId,
    productName: line.productName,
    makerName: line.makerName,
    variantName: line.optionLabel,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    addons: line.addons.map((addon) => ({
      addonId: addon.addonId,
      addonName: addon.addonName,
      addonPrice: addon.addonPrice,
      addonQuantity: addon.addonQuantity,
    })),
    orderable:
      !line.unavailable &&
      !line.soldOut &&
      line.quantity <= line.stock &&
      line.addons.every(
        (addon) =>
          !addon.addonSoldOut &&
          !addon.addonUnavailable &&
          addon.addonQuantity <= addon.addonStock,
      ),
  };
}

export type OrdererInput = {
  name: string;
  phone: string;
  email?: string | null;
};

export type ShippingAddressInput = {
  recipient: string;
  phone: string;
  zipcode: string;
  addr1: string;
  addr2?: string | null;
  deliveryMemo?: string | null;
};

export type CreatePendingOrderInput = {
  cartToken: string;
  customerId: number | null;
  orderer: OrdererInput;
  shippingAddress: ShippingAddressInput;
};

export type CreatePendingOrderResult = {
  orderId: number;
  orderNo: string;
  /** 비회원 주문조회용 — 회원 주문이면 null */
  guestToken: string | null;
  grandTotal: number;
};

export class CartNotFoundError extends Error {
  constructor() {
    super("장바구니를 찾을 수 없습니다.");
    this.name = "CartNotFoundError";
  }
}

/**
 * 결제 전 주문(pending)을 만든다. 토스 결제위젯에 넘길 orderId·amount의 출처다.
 *
 * 카트 행을 FOR UPDATE로 잠가 같은 카트의 동시 체크아웃(더블 클릭 포함)을 직렬화한다.
 * 잠그지 않으면 두 요청이 같은 카트로 각각 주문을 만들 수 있다.
 */
export async function createPendingOrder(
  database: DatabaseClient,
  input: CreatePendingOrderInput,
): Promise<CreatePendingOrderResult> {
  return database.transaction(async (tx) => {
    const [cartRow] = await tx
      .select({ id: cart.id })
      .from(cart)
      .where(eq(cart.sessionToken, input.cartToken))
      .for("update")
      .limit(1);
    if (!cartRow) throw new CartNotFoundError();

    // 트랜잭션 안에서 재조회 — 카트 화면을 본 뒤 가격·재고가 바뀌었을 수 있다.
    // 트랜잭션은 커넥션 하나를 쓰므로 Promise.all로 겹쳐 보내면 안 된다(pg가 쿼리 충돌 경고,
    // pg@9부터는 오류). 트랜잭션 안에서는 항상 순차 실행한다.
    const cartView = await getCartWithItems(tx, input.cartToken);
    const shippingPolicy = await loadShippingPolicy(tx);

    // 주문 불가 라인이 하나라도 있으면 도메인이 throw — 부분 진행 금지(설계 D6)
    const draft = buildOrderDraft(cartView.lines.map(toDraftLine), shippingPolicy);

    const orderNo = await allocateOrderNo(tx);
    const guestToken = input.customerId === null ? randomUUID() : null;
    const actorText = serializeActor(
      input.customerId === null
        ? { role: "system" }
        : { role: "customer", id: input.customerId },
    );

    const [orderRow] = await tx
      .insert(orders)
      .values({
        orderNo,
        customerId: input.customerId,
        guestToken,
        status: "pending",
        channel: "web",
        ordererName: input.orderer.name,
        ordererPhone: input.orderer.phone,
        ordererEmail: input.orderer.email ?? null,
        recipient: input.shippingAddress.recipient,
        phone: input.shippingAddress.phone,
        zipcode: input.shippingAddress.zipcode,
        addr1: input.shippingAddress.addr1,
        addr2: input.shippingAddress.addr2 ?? null,
        deliveryMemo: input.shippingAddress.deliveryMemo ?? null,
        subtotal: draft.subtotal,
        shippingFee: draft.shippingFee,
        couponDiscount: draft.couponDiscount,
        pointUsed: draft.pointUsed,
        grandTotal: draft.grandTotal,
      })
      .returning({ id: orders.id });

    // 품목·추가상품 스냅샷 — 상품이 바뀌거나 삭제돼도 주문은 불변(RULE-11)
    for (const item of draft.items) {
      const [itemRow] = await tx
        .insert(orderItem)
        .values({
          orderId: orderRow.id,
          variantId: item.variantId,
          productId: item.productId,
          productName: item.productName,
          makerName: item.makerName,
          variantName: item.variantName,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
        })
        .returning({ id: orderItem.id });

      if (item.addons.length > 0) {
        await tx.insert(orderItemAddon).values(
          item.addons.map((addon) => ({
            orderItemId: itemRow.id,
            addonId: addon.addonId,
            addonName: addon.addonName,
            unitPrice: addon.unitPrice,
            quantity: addon.quantity,
            lineTotal: addon.lineTotal,
          })),
        );
      }
    }

    // 결제 대기 행 — 승인 시 confirmPayment가 paid로 전이시킨다
    await tx.insert(payment).values({
      orderId: orderRow.id,
      provider: "tosspayments",
      amount: draft.grandTotal,
      status: "ready",
    });

    // 생성 이력(null→pending)은 초크포인트를 거치지 않고 직접 남긴다 —
    // applyOrderTransition은 '기존 상태에서의 변경'을 다루므로 최초 진입은 여기서 기록한다
    await tx.insert(orderStatusHistory).values({
      orderId: orderRow.id,
      fromStatus: null,
      toStatus: "pending",
      actor: actorText,
      memo: "주문 생성",
    });

    return {
      orderId: orderRow.id,
      orderNo,
      guestToken,
      grandTotal: draft.grandTotal,
    };
  });
}
