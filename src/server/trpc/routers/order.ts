import { headers } from "next/headers";
import { z } from "zod";

import { getPaymentGateway } from "@/server/payments";
import { assertGuestLookupAllowed } from "@/server/security/rate-limit";
import {
  getOrderResult,
  lookupGuestOrder,
} from "@/server/services/order-query.service";
import { createPendingOrder } from "@/server/services/order.service";
import { confirmPayment } from "@/server/services/payment.service";

import { publicProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 주문 라우터 — 체크아웃·결제 승인·주문 조회의 HTTP 표면.
 *
 * 비회원 구매가 정책이라(UX 규칙 4) 전부 publicProcedure이고, 소유 증명은
 * 세션 customerId 또는 게스트 토큰·연락처로 서비스가 판정한다.
 * 여기서는 zod 검증과 요청 컨텍스트(IP·쿠키) 수집만 하고 로직은 서비스에 위임한다(RULE-14).
 */

/** 프록시 뒤 실제 클라이언트 IP — 동의 증빙·레이트리밋 키에 쓴다 */
async function readClientIp(): Promise<string | null> {
  const forwardedFor = (await headers()).get("x-forwarded-for");
  return forwardedFor ? forwardedFor.split(",")[0].trim() : null;
}

/** 하이픈이 섞여 들어와도 통과시키고, 정규화·형식 검증은 도메인 규칙으로 한다 */
const phoneInputSchema = z
  .string()
  .trim()
  .min(1, "연락처를 입력해 주세요.")
  .max(20, "연락처를 다시 확인해 주세요.");

const ordererSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "주문자 이름을 입력해 주세요.")
    .max(50, "이름은 50자 이하로 입력해 주세요."),
  phone: phoneInputSchema,
  email: z.email("이메일 형식이 올바르지 않습니다.").optional().or(z.literal("")),
});

const shippingAddressSchema = z.object({
  recipient: z
    .string()
    .trim()
    .min(1, "받는 분 이름을 입력해 주세요.")
    .max(50, "받는 분 이름은 50자 이하로 입력해 주세요."),
  phone: phoneInputSchema,
  zipcode: z
    .string()
    .trim()
    .regex(/^[0-9]{5}$/, "우편번호가 올바르지 않습니다. 주소 검색을 이용해 주세요."),
  addr1: z
    .string()
    .trim()
    .min(1, "주소를 입력해 주세요. 주소 검색을 이용해 주세요.")
    .max(200, "주소는 200자 이하로 입력해 주세요."),
  addr2: z.string().trim().max(200, "상세 주소는 200자 이하로 입력해 주세요.").optional(),
  deliveryMemo: z.string().trim().max(200).optional(),
});

/** 주문번호 형식 — "YYYYMMDD-####". 형식 검증으로 무의미한 조회를 먼저 거른다 */
const orderNoSchema = z
  .string()
  .trim()
  .regex(/^\d{8}-\d{4,}$/, "주문번호 형식이 올바르지 않습니다. 다시 확인해 주세요.");

export const orderRouter = router({
  /**
   * 체크아웃 — 결제 전 주문(pending)을 만든다.
   * 반환한 orderNo·grandTotal이 토스 결제위젯의 orderId·amount가 된다.
   * 이 시점에는 재고를 잡지 않는다(결제 승인 시 차감).
   */
  createOrder: publicProcedure
    .input(
      z.object({
        orderer: ordererSchema,
        shippingAddress: shippingAddressSchema,
        /** 장바구니에서 체크한 라인 — 비우면 카트 전체 */
        cartItemIds: z.array(z.number().int().positive()).optional(),
        agreedTermsDocumentIds: z.array(z.number().int().positive()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const clientIp = await readClientIp();
      return withOrderErrorMapping(() =>
        createPendingOrder(ctx.db, {
          // 토큰이 없으면 카트도 없다 — 서비스의 CartNotFoundError에 맡긴다
          cartToken: ctx.cartToken ?? "",
          customerId: ctx.customerId,
          orderer: {
            name: input.orderer.name,
            phone: input.orderer.phone,
            email: input.orderer.email ? input.orderer.email : null,
          },
          shippingAddress: {
            recipient: input.shippingAddress.recipient,
            phone: input.shippingAddress.phone,
            zipcode: input.shippingAddress.zipcode,
            addr1: input.shippingAddress.addr1,
            addr2: input.shippingAddress.addr2 ?? null,
            deliveryMemo: input.shippingAddress.deliveryMemo ?? null,
          },
          cartItemIds: input.cartItemIds,
          agreedTermsDocumentIds: input.agreedTermsDocumentIds,
          agreementIp: clientIp,
        }),
      );
    }),

  /**
   * 결제 승인 — 토스 successUrl 콜백이 호출한다.
   * amount는 참고용이며 실제 승인은 서버 저장 금액으로 한다(위변조 차단).
   * 웹훅이 먼저 도착해 이미 확정됐어도 멱등하게 성공을 돌려준다.
   */
  confirmPayment: publicProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        paymentKey: z.string().trim().min(1).max(200),
        amount: z.number().int().nonnegative(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withOrderErrorMapping(() =>
        confirmPayment(ctx.db, getPaymentGateway(), {
          orderNo: input.orderNo,
          paymentKey: input.paymentKey,
          amount: input.amount,
          cartToken: ctx.cartToken,
        }),
      );
    }),

  /**
   * 주문완료 화면 — 결제 직후 본인이 보므로 마스킹하지 않는다.
   * 회원은 세션으로, 비회원은 주문 생성 때 받은 guestToken으로 소유를 증명한다.
   */
  getOrderResult: publicProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        guestToken: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        getOrderResult(ctx.db, {
          orderNo: input.orderNo,
          customerId: ctx.customerId,
          guestToken: input.guestToken ?? null,
        }),
      ),
    ),

  /**
   * 비회원 주문조회 — 주문번호 + 주문자 연락처 2요소.
   * 무차별 탐색 방지를 위해 IP 기준 시도 한도를 둔다(주문번호는 날짜+연번이라 추측 가능).
   */
  lookupGuestOrder: publicProcedure
    .input(
      z.object({
        orderNo: orderNoSchema,
        ordererPhone: phoneInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertGuestLookupAllowed(await readClientIp());
      return withOrderErrorMapping(() =>
        lookupGuestOrder(ctx.db, {
          orderNo: input.orderNo,
          ordererPhone: input.ordererPhone,
        }),
      );
    }),
});
