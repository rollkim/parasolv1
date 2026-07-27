import "server-only";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { db as Database } from "@/db";
import { product, productVariant, restockNotification, wishlist } from "@/db/schema";
import {
  getProductCardsByIds,
  type ProductCard,
} from "@/server/services/product.service";

/**
 * 찜·재입고 알림 도메인 서비스 — 찜은 회원 전용(PK: customerId+productId),
 * 재입고 알림은 비회원 phone 신청도 받는다. 세션 판독 등 HTTP 관심사는 라우터가 담당(RULE-14).
 */

type DatabaseClient = typeof Database;

// =============================================================
// 찜
// =============================================================

/**
 * 하트 토글 — 이미 찜한 상태면 해제, 아니면 등록.
 * 응답 wished가 곧 다음 화면 상태(aria-pressed)다.
 */
export async function toggleWishlist(
  database: DatabaseClient,
  input: { customerId: number; productId: number },
): Promise<{ wished: boolean }> {
  // 해제 먼저 시도 — 이미 찜한 상태면 삭제만으로 끝난다
  const deletedRows = await database
    .delete(wishlist)
    .where(
      and(
        eq(wishlist.customerId, input.customerId),
        eq(wishlist.productId, input.productId),
      ),
    )
    .returning({ productId: wishlist.productId });
  if (deletedRows.length > 0) return { wished: false };

  // 노출 중인 상품만 등록 허용 — 없는 id의 FK 오류를 사용자 메시지로 바꾼다
  const [visibleProductRow] = await database
    .select({ productId: product.id })
    .from(product)
    .where(
      and(
        eq(product.id, input.productId),
        eq(product.status, "active"),
        isNull(product.deletedAt),
      ),
    )
    .limit(1);
  if (!visibleProductRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "지금은 판매하지 않는 상품입니다. 상품 목록에서 다시 선택해 주세요.",
    });
  }

  // 동시 토글로 이미 들어가 있어도 실패시키지 않는다 — 결과 상태(찜됨)는 동일
  await database
    .insert(wishlist)
    .values({ customerId: input.customerId, productId: input.productId })
    .onConflictDoNothing();
  return { wished: true };
}

/** 찜 목록 화면 — 최근 찜한 순. 카드 조립은 product.service를 재사용한다 */
export async function getWishlistCards(
  database: DatabaseClient,
  customerId: number,
): Promise<ProductCard[]> {
  const wishedRows = await database
    .select({ productId: wishlist.productId })
    .from(wishlist)
    .where(eq(wishlist.customerId, customerId))
    .orderBy(desc(wishlist.createdAt), desc(wishlist.productId));

  // 판매중지·삭제 상품은 getProductCardsByIds의 노출 조건에서 자연히 걸러진다
  return getProductCardsByIds(
    database,
    wishedRows.map((row) => row.productId),
  );
}

/** 상품 상세 진입 시 하트 초기 상태 */
export async function isProductWished(
  database: DatabaseClient,
  input: { customerId: number; productId: number },
): Promise<boolean> {
  const [wishedRow] = await database
    .select({ productId: wishlist.productId })
    .from(wishlist)
    .where(
      and(
        eq(wishlist.customerId, input.customerId),
        eq(wishlist.productId, input.productId),
      ),
    )
    .limit(1);
  return wishedRow !== undefined;
}

/** 찜 목록 선택 삭제 — 본인 것만 지워지도록 customerId를 조건에 묶는다 */
export async function removeWishlistMany(
  database: DatabaseClient,
  input: { customerId: number; productIds: number[] },
): Promise<{ removedCount: number }> {
  if (input.productIds.length === 0) return { removedCount: 0 };

  const deletedRows = await database
    .delete(wishlist)
    .where(
      and(
        eq(wishlist.customerId, input.customerId),
        inArray(wishlist.productId, input.productIds),
      ),
    )
    .returning({ productId: wishlist.productId });
  return { removedCount: deletedRows.length };
}

// =============================================================
// 재입고 알림
// =============================================================

export type RestockNotificationRequestInput = {
  variantId: number;
  /** 회원 신청 — 세션에서 온 값만 넣는다 */
  customerId?: number | null;
  /** 비회원 신청 — 하이픈 제거된 휴대폰 번호 */
  phone?: string | null;
};

/**
 * 재입고 알림 신청 — 회원은 variant+customer, 비회원은 variant+phone 기준으로
 * 아직 발송되지 않은(notifiedAt null) 동일 신청을 중복 등록하지 않는다.
 * 발송이 끝난 뒤의 재신청은 새 신청으로 받는다.
 */
export async function requestRestockNotification(
  database: DatabaseClient,
  input: RestockNotificationRequestInput,
): Promise<{ alreadyRequested: boolean }> {
  const requesterCustomerId = input.customerId ?? null;
  const requesterPhone = input.phone ?? null;

  // 신청 주체 식별자 둘 다 없으면 알림을 보낼 곳이 없다 — 라우터 검증의 마지막 방어선
  const requesterCondition =
    requesterCustomerId !== null
      ? eq(restockNotification.customerId, requesterCustomerId)
      : requesterPhone !== null
        ? eq(restockNotification.phone, requesterPhone)
        : null;
  if (requesterCondition === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "재입고 알림 신청에는 로그인 또는 휴대폰 번호가 필요합니다.",
    });
  }

  // 판매 중인 variant만 — 품절(재고 0)이 신청 대상이므로 재고는 조건에 넣지 않는다
  const [sellableVariantRow] = await database
    .select({ variantId: productVariant.id })
    .from(productVariant)
    .innerJoin(product, eq(productVariant.productId, product.id))
    .where(
      and(
        eq(productVariant.id, input.variantId),
        eq(productVariant.isActive, true),
        isNull(productVariant.deletedAt),
        eq(product.status, "active"),
        isNull(product.deletedAt),
      ),
    )
    .limit(1);
  if (!sellableVariantRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "지금은 판매하지 않는 상품입니다. 상품 목록에서 다시 선택해 주세요.",
    });
  }

  const [existingRequestRow] = await database
    .select({ restockNotificationId: restockNotification.id })
    .from(restockNotification)
    .where(
      and(
        eq(restockNotification.variantId, input.variantId),
        isNull(restockNotification.notifiedAt),
        requesterCondition,
      ),
    )
    .limit(1);
  if (existingRequestRow) return { alreadyRequested: true };

  await database.insert(restockNotification).values({
    variantId: input.variantId,
    customerId: requesterCustomerId,
    // 회원 신청은 발송 시점의 customer.phone을 쓴다 — 번호 변경이 자동 반영되게 저장하지 않는다
    phone: requesterCustomerId !== null ? null : requesterPhone,
  });
  return { alreadyRequested: false };
}
