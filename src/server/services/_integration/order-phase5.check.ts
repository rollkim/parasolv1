/**
 * Phase 5 검증 — 주문 조회 표면(주문완료·비회원조회)과 마스킹·소유검증을 실제 DB에서 확인한다.
 * 실행: npm run check:order5   (SSH 터널 켠 상태)
 *
 * 시나리오: [1]주문완료 조회(무마스킹·소유검증) [2]비회원조회(2요소·마스킹) [3]조회 실패 구분 없음
 *           [4]선택 라인만 주문 [5]전화번호 정규화 [6]정가·썸네일 스냅샷 불변성
 * `tsx --conditions=react-server`로 도는 이유는 order-phase2.check.ts 주석 참조.
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";

import { db } from "@/db";
import {
  cart,
  cartItem,
  orders,
  productImage,
  productVariant,
  termsDocument,
} from "@/db/schema";
import { maskOrdererName, maskPhone } from "@/domain/order";
import { normalizePhone } from "@/domain/phone";

import {
  getOrderResult,
  lookupGuestOrder,
  OrderAccessDeniedError,
} from "../order-query.service";
import { createPendingOrder } from "../order.service";

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

// 하이픈 포함 입력 — 저장은 정규화(숫자만)돼야 한다
const ORDERER = { name: "홍정성", phone: "010-1234-5678", email: "check5@example.com" };
const ADDRESS = {
  recipient: "김보람",
  phone: "010-9876-5432",
  zipcode: "04168",
  addr1: "서울특별시 마포구 만리재로 00",
  addr2: "3층 301호",
  deliveryMemo: "문 앞에 두고 벨 눌러주세요",
};

type Leftovers = { orderIds: number[]; cartIds: number[] };

async function loadRequiredTermsIds(): Promise<number[]> {
  const rows = await db
    .select({ id: termsDocument.id })
    .from(termsDocument)
    .where(and(eq(termsDocument.isRequired, true), lte(termsDocument.effectiveAt, new Date())));
  return rows.map((row) => row.id);
}

async function pickVariants() {
  const rows = await db
    .select({ id: productVariant.id, price: productVariant.price, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.isActive, true))
    .orderBy(productVariant.id)
    .limit(2);
  if (rows.length < 2) throw new Error("활성 variant 2종 필요 — npm run db:seed:dev 먼저 실행");
  return rows;
}

/** 카트 생성 + 주문 생성. 카트 id는 주문 전에 등록해 실패해도 정리가 닿게 한다 */
async function setupOrder(
  lines: { variantId: number; quantity: number }[],
  leftovers: Leftovers,
  options: { cartItemIds?: "selected-first" } = {},
) {
  const cartToken = `CHECK5-${randomUUID()}`;
  const [cartRow] = await db
    .insert(cart)
    .values({ sessionToken: cartToken })
    .returning({ id: cart.id });
  leftovers.cartIds.push(cartRow.id);

  const insertedItems = await db
    .insert(cartItem)
    .values(lines.map((line) => ({ cartId: cartRow.id, ...line })))
    .returning({ id: cartItem.id });

  const created = await createPendingOrder(db, {
    cartToken,
    customerId: null,
    orderer: ORDERER,
    shippingAddress: ADDRESS,
    cartItemIds:
      options.cartItemIds === "selected-first" ? [insertedItems[0].id] : undefined,
    agreedTermsDocumentIds: await loadRequiredTermsIds(),
    agreementIp: "127.0.0.1",
  });
  leftovers.orderIds.push(created.orderId);
  return { cartToken, cartId: cartRow.id, created, insertedItems };
}

/** ① 주문완료 조회 — 본인 화면이라 마스킹 없음 + 소유 검증 */
async function checkOrderResult(variantId: number, leftovers: Leftovers) {
  console.log("\n[1] 주문완료 조회 — 무마스킹·소유검증 기대");
  const { created } = await setupOrder([{ variantId, quantity: 2 }], leftovers);

  const view = await getOrderResult(db, {
    orderNo: created.orderNo,
    customerId: null,
    guestToken: created.guestToken,
  });

  check(view.orderNo === created.orderNo, "주문번호 일치");
  check(view.orderStatus === "pending" && view.orderStatusLabel === "결제 대기", "상태·라벨", {
    status: view.orderStatus,
    label: view.orderStatusLabel,
  });
  check(view.timeline.outOfTimeline, "결제 대기는 타임라인 밖(별도 안내 블록)");
  check(view.orderer.name === "홍정성", "주문자명 무마스킹", view.orderer.name);
  check(view.shippingAddress.addr2 === ADDRESS.addr2, "상세주소 무마스킹");
  check(view.shippingAddress.deliveryMemo === ADDRESS.deliveryMemo, "배송메모 노출");
  check(view.isGuestOrder, "비회원 주문 표시(가입 유도 배너 조건)");
  check(view.items.length === 1 && view.items[0].quantity === 2, "품목 스냅샷", view.items.length);
  check(view.amounts.grandTotal === created.grandTotal, "결제 예정금액 일치");
  check(view.paymentSummary?.status === "ready", "결제행 요약", view.paymentSummary);

  // 소유 증명 없이 조회 — 남의 주문번호만으로 열리면 안 된다
  let denied = false;
  try {
    await getOrderResult(db, { orderNo: created.orderNo, customerId: null, guestToken: null });
  } catch (error) {
    denied = error instanceof OrderAccessDeniedError;
  }
  check(denied, "토큰 없는 조회 거부");

  let wrongTokenDenied = false;
  try {
    await getOrderResult(db, {
      orderNo: created.orderNo,
      customerId: null,
      guestToken: randomUUID(),
    });
  } catch (error) {
    wrongTokenDenied = error instanceof OrderAccessDeniedError;
  }
  check(wrongTokenDenied, "다른 토큰 조회 거부");

  return created;
}

/** ② 비회원 조회 — 주문번호 + 연락처 2요소, 마스킹 적용 */
async function checkGuestLookup(created: { orderNo: string }) {
  console.log("\n[2] 비회원 조회 — 2요소 인증·마스킹 기대");

  // 하이픈 있는 입력으로 조회 — 저장은 정규화돼 있어도 찾아야 한다
  const view = await lookupGuestOrder(db, {
    orderNo: created.orderNo,
    ordererPhone: "010-1234-5678",
  });
  check(view.orderNo === created.orderNo, "하이픈 입력으로 조회 성공");

  const digitsView = await lookupGuestOrder(db, {
    orderNo: created.orderNo,
    ordererPhone: "01012345678",
  });
  check(digitsView.orderNo === created.orderNo, "숫자만 입력으로도 조회 성공");

  check(view.orderer.name === maskOrdererName("홍정성"), "주문자명 마스킹(홍**)", view.orderer.name);
  check(view.orderer.phone === maskPhone("01012345678"), "연락처 마스킹", view.orderer.phone);
  check(view.orderer.email === null, "이메일 미노출");
  check(view.shippingAddress.recipient === "김**", "수령인 마스킹", view.shippingAddress.recipient);
  check(
    view.shippingAddress.addr1 === ADDRESS.addr1 &&
      view.shippingAddress.addr2 === "*".repeat([...ADDRESS.addr2].length),
    "주소는 노출·상세주소만 마스킹",
    view.shippingAddress,
  );
  check(view.shippingAddress.deliveryMemo === null, "배송메모 미노출");
  check(view.amounts.grandTotal === view.amounts.subtotal + view.amounts.shippingFee, "금액 일관");
}

/** ③ 조회 실패 — 원인을 구분해 알리지 않는다(주문 존재 여부 누설 차단) */
async function checkLookupFailureIsUniform(created: { orderNo: string }) {
  console.log("\n[3] 조회 실패 — 원인 미구분 기대");

  let wrongPhone: unknown;
  try {
    await lookupGuestOrder(db, { orderNo: created.orderNo, ordererPhone: "01000000000" });
  } catch (error) {
    wrongPhone = error;
  }
  let missingOrder: unknown;
  try {
    await lookupGuestOrder(db, { orderNo: "19990101-0001", ordererPhone: "01012345678" });
  } catch (error) {
    missingOrder = error;
  }

  check(wrongPhone instanceof OrderAccessDeniedError, "연락처 불일치 거부");
  check(missingOrder instanceof OrderAccessDeniedError, "없는 주문번호 거부");
  check(
    wrongPhone instanceof Error &&
      missingOrder instanceof Error &&
      wrongPhone.message === missingOrder.message,
    "두 실패의 메시지가 동일(존재 여부 누설 없음)",
    {
      wrongPhone: (wrongPhone as Error).message,
      missingOrder: (missingOrder as Error).message,
    },
  );
}

/** ④ 선택 라인만 주문 — 나머지는 카트에 남는다 */
async function checkSelectedLinesOnly(
  variants: { id: number }[],
  leftovers: Leftovers,
) {
  console.log("\n[4] 선택 라인만 주문 — 미선택 라인 카트 잔류 기대");
  const { cartId, created, insertedItems } = await setupOrder(
    [
      { variantId: variants[0].id, quantity: 1 },
      { variantId: variants[1].id, quantity: 1 },
    ],
    leftovers,
    { cartItemIds: "selected-first" },
  );

  const view = await getOrderResult(db, {
    orderNo: created.orderNo,
    customerId: null,
    guestToken: created.guestToken,
  });
  check(view.items.length === 1, `주문에 선택 라인 1건만 (실제 ${view.items.length})`);

  const remaining = await db
    .select({ id: cartItem.id })
    .from(cartItem)
    .where(eq(cartItem.cartId, cartId));
  check(remaining.length === 2, `카트 2건 유지 (실제 ${remaining.length}) — 결제 전이므로 미소비`);
  check(insertedItems.length === 2, "카트 라인 2건 생성 확인");
}

/**
 * ⑥ 정가·썸네일 스냅샷 — 주문 이후 상품이 바뀌어도 주문 화면이 흔들리지 않아야 한다.
 * 이 시나리오가 스냅샷 컬럼을 추가한 이유 그 자체다.
 */
async function checkPriceSnapshotSurvivesProductChange(leftovers: Leftovers) {
  console.log("\n[6] 정가·썸네일 스냅샷 — 상품 변경 후에도 불변 기대");

  // 정가가 설정된 variant를 고른다 (시드: compare_at_price 있는 상품들)
  const [variant] = await db
    .select({
      id: productVariant.id,
      productId: productVariant.productId,
      price: productVariant.price,
      listPrice: productVariant.compareAtPrice,
      stock: productVariant.stock,
    })
    .from(productVariant)
    .where(and(eq(productVariant.isActive, true), isNotNull(productVariant.compareAtPrice)))
    .orderBy(productVariant.id)
    .limit(1);
  if (!variant || variant.listPrice === null) {
    console.log("  – 정가(compare_at_price) 설정된 variant가 없어 건너뜀");
    return;
  }

  /**
   * 상품 이미지는 5주차 업로드 기능 소관이라 개발 시드에 없다.
   * 원본이 없으면 "복사됐는지"를 물을 수 없으므로(빈 검증), 임시 이미지를 만들어
   * 카트→주문 복사 경로 자체를 증명하고 끝나면 지운다.
   */
  const [existingImage] = await db
    .select({ id: productImage.id, path: productImage.path, alt: productImage.alt })
    .from(productImage)
    .where(and(eq(productImage.productId, variant.productId), eq(productImage.kind, "thumbnail")))
    .orderBy(desc(productImage.isPrimary), asc(productImage.position))
    .limit(1);

  let temporaryImageId: number | null = null;
  let expectedThumbnail = existingImage
    ? { path: existingImage.path, alt: existingImage.alt }
    : { path: "/uploads/check5-temp.webp", alt: "검증용 임시 썸네일" };

  if (!existingImage) {
    const [inserted] = await db
      .insert(productImage)
      .values({
        productId: variant.productId,
        kind: "thumbnail",
        path: expectedThumbnail.path,
        alt: expectedThumbnail.alt,
        isPrimary: true,
        position: 0,
      })
      .returning({ id: productImage.id });
    temporaryImageId = inserted.id;
    console.log("  – 시드에 상품 이미지가 없어 임시 썸네일 생성(종료 시 삭제)");
  }

  try {
    await runSnapshotAssertions(variant, expectedThumbnail, leftovers);
  } finally {
    if (temporaryImageId !== null) {
      await db.delete(productImage).where(eq(productImage.id, temporaryImageId));
    }
  }
}

async function runSnapshotAssertions(
  variant: { id: number; price: number; listPrice: number | null },
  expectedThumbnail: { path: string; alt: string },
  leftovers: Leftovers,
) {
  if (variant.listPrice === null) return;
  const { created } = await setupOrder([{ variantId: variant.id, quantity: 2 }], leftovers);

  const before = await getOrderResult(db, {
    orderNo: created.orderNo,
    customerId: null,
    guestToken: created.guestToken,
  });
  check(
    before.items[0].listPrice === variant.listPrice,
    `정가 스냅샷 복사 (${variant.listPrice})`,
    before.items[0].listPrice,
  );
  check(
    before.amounts.listTotal === variant.listPrice * 2 &&
      before.amounts.productDiscount === (variant.listPrice - variant.price) * 2,
    `총 상품금액 ${before.amounts.listTotal} · 상품 할인 ${before.amounts.productDiscount}`,
    before.amounts,
  );
  check(
    before.items[0].thumbnailPath === expectedThumbnail.path &&
      before.items[0].thumbnailAlt === expectedThumbnail.alt,
    `썸네일 스냅샷 복사 (${expectedThumbnail.path})`,
    { path: before.items[0].thumbnailPath, alt: before.items[0].thumbnailAlt },
  );

  // ★핵심: 주문 후 상품 정가를 올린다 — 과거 주문의 할인액이 따라 변하면 안 된다
  const bumpedListPrice = variant.listPrice + 5000;
  await db
    .update(productVariant)
    .set({ compareAtPrice: bumpedListPrice })
    .where(eq(productVariant.id, variant.id));
  try {
    const after = await getOrderResult(db, {
      orderNo: created.orderNo,
      customerId: null,
      guestToken: created.guestToken,
    });
    check(
      after.items[0].listPrice === variant.listPrice,
      `상품 정가 인상(${variant.listPrice}→${bumpedListPrice}) 후에도 주문 정가 불변`,
      after.items[0].listPrice,
    );
    check(
      after.amounts.productDiscount === before.amounts.productDiscount,
      "상품 할인액 불변",
      { before: before.amounts.productDiscount, after: after.amounts.productDiscount },
    );
  } finally {
    await db
      .update(productVariant)
      .set({ compareAtPrice: variant.listPrice })
      .where(eq(productVariant.id, variant.id));
  }
}

/** ⑤ 전화번호 정규화 — 저장 형태가 조회 형태와 같은지 */
async function checkPhoneNormalization(created: { orderNo: string }) {
  console.log("\n[5] 전화번호 정규화 — 저장값 확인");
  const [row] = await db
    .select({ ordererPhone: orders.ordererPhone, phone: orders.phone })
    .from(orders)
    .where(eq(orders.orderNo, created.orderNo));
  check(
    row.ordererPhone === normalizePhone(ORDERER.phone),
    `주문자 연락처 정규화 저장 (${row.ordererPhone})`,
  );
  check(
    row.phone === normalizePhone(ADDRESS.phone),
    `수령인 연락처 정규화 저장 (${row.phone})`,
  );
}

async function main() {
  console.log("PaRaSOL 주문 Phase 5 검증 (임시 주문·카트는 종료 시 삭제)");
  const variants = await pickVariants();
  const leftovers: Leftovers = { orderIds: [], cartIds: [] };

  try {
    const created = await checkOrderResult(variants[0].id, leftovers);
    await checkGuestLookup(created);
    await checkLookupFailureIsUniform(created);
    await checkSelectedLinesOnly(variants, leftovers);
    await checkPhoneNormalization(created);
    await checkPriceSnapshotSurvivesProductChange(leftovers);
  } finally {
    const cleanupSteps: [string, () => Promise<unknown>][] = [
      ["주문(cascade)", () => db.delete(orders).where(inArray(orders.id, leftovers.orderIds))],
      ["카트", () => db.delete(cart).where(inArray(cart.id, leftovers.cartIds))],
    ];
    for (const [label, step] of cleanupSteps) {
      if (label === "주문(cascade)" && leftovers.orderIds.length === 0) continue;
      if (label === "카트" && leftovers.cartIds.length === 0) continue;
      try {
        await step();
      } catch (cleanupError) {
        console.error(`  ! 정리 실패(${label}):`, cleanupError);
      }
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
