import { cookies } from "next/headers";
import { z } from "zod";

import { getPaymentGateway } from "@/server/payments";
import { assertGuestLookupAllowed } from "@/server/security/rate-limit";
import { getCheckoutView } from "@/server/services/checkout-view.service";
import {
  getMyOrderDetail,
  getOrderResult,
  listMyOrders,
  lookupGuestOrder,
} from "@/server/services/order-query.service";
import { isDirectBuyToken } from "@/server/services/cart.service";
import { confirmOrderByCustomer } from "@/server/services/order-confirm.service";
import { createPendingOrder } from "@/server/services/order.service";
import { confirmPayment } from "@/server/services/payment.service";

import { GUEST_ORDER_COOKIE_NAME } from "../context";
import { protectedProcedure, publicProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/** 주문 직후 완료 화면을 보는 동안만 필요하다 — 오래 두면 공용 PC에서 남의 주문이 열린다 */
const GUEST_ORDER_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/**
 * 체크아웃이 읽을 카트 토큰을 정한다.
 *
 * 바로구매는 토큰이 URL(`/checkout?buy=…`)로 오므로, **바로구매로 만든 토큰만** 허용한다.
 * 접두사 검사가 없으면 남의 장바구니 토큰을 URL에 넣어 그 사람 장바구니를 들여다볼 수 있다.
 * 일반 장바구니 토큰은 지금처럼 쿠키에서만 온다.
 */
function resolveCheckoutToken(
  cookieCartToken: string | null,
  buyToken: string | undefined,
): string | null {
  if (buyToken && isDirectBuyToken(buyToken)) return buyToken;
  return cookieCartToken;
}

/**
 * 비회원 주문완료 화면의 본인 확인 수단 — URL이 아니라 쿠키로 넘긴다.
 * 쿼리스트링에 실으면 Referer 헤더·브라우저 기록·공유 링크로 새어 남의 주문이 열린다.
 *
 * HTTP 요청 밖(서버 컴포넌트 caller·배치·검증)에서는 쿠키를 실을 응답 자체가 없다.
 * 그 경우 발급을 건너뛰는 것이 맞다 — 주문 생성은 이미 성공했으므로 실패로 만들지 않는다.
 */
async function issueGuestOrderCookie(guestToken: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.set(GUEST_ORDER_COOKIE_NAME, guestToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: GUEST_ORDER_COOKIE_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // 요청 스코프 밖 — 쿠키를 받을 브라우저가 없다
  }
}

/**
 * 주문 라우터 — 체크아웃·결제 승인·주문 조회의 HTTP 표면.
 *
 * 비회원 구매가 정책이라(UX 규칙 4) 전부 publicProcedure이고, 소유 증명은
 * 세션 customerId 또는 게스트 토큰·연락처로 서비스가 판정한다.
 * 여기서는 zod 검증과 요청 컨텍스트(IP·쿠키) 수집만 하고 로직은 서비스에 위임한다(RULE-14).
 */

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
   * 체크아웃 진입 데이터 — 카트 요약·주문자 프리필·배송지·약관·위젯 키를 한 번에.
   * 비회원도 호출하므로 publicProcedure이고, 회원 전용 값은 서비스가 세션 기준으로 채운다.
   */
  getCheckoutView: publicProcedure
    .input(z.object({ buyToken: z.string().max(64).optional() }).optional())
    .query(({ ctx, input }) =>
      getCheckoutView(ctx.db, {
        cartToken: resolveCheckoutToken(ctx.cartToken, input?.buyToken),
        customerId: ctx.customerId,
      }),
    ),

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
        /**
         * 사용할 적립금. 여기서는 "정수·음수 아님"만 본다 —
         * 최소액·단위·잔액·주문금액 초과는 서버 정책과 실제 잔액을 봐야 하므로 서비스가 판정한다.
         */
        pointToUse: z.number().int().min(0).optional(),
        couponIssueId: z.number().int().positive().optional(),
        /** 바로구매 — 장바구니가 아니라 이 임시 카트로 주문한다 */
        buyToken: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await withOrderErrorMapping(() =>
        createPendingOrder(ctx.db, {
          // 토큰이 없으면 카트도 없다 — 서비스의 CartNotFoundError에 맡긴다
          cartToken: resolveCheckoutToken(ctx.cartToken, input.buyToken) ?? "",
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
          agreementIp: ctx.clientIp,
          pointToUse: input.pointToUse,
          couponIssueId: input.couponIssueId,
        }),
      );

      if (created.guestToken) await issueGuestOrderCookie(created.guestToken);
      return created;
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
    .input(z.object({ orderNo: orderNoSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        getOrderResult(ctx.db, {
          orderNo: input.orderNo,
          customerId: ctx.customerId,
          // 비회원 소유 증명은 주문 생성 때 발급한 쿠키가 한다 — 화면이 토큰을 다루지 않는다
          guestToken: ctx.guestOrderToken,
        }),
      ),
    ),

  /** 마이페이지 주문 내역 — 최신순 */
  listMyOrders: protectedProcedure.query(({ ctx }) =>
    withOrderErrorMapping(() => listMyOrders(ctx.db, ctx.customerId)),
  ),

  /** 회원 주문 상세 — 세션 소유자만. 본인 화면이라 마스킹하지 않는다 */
  /**
   * 구매확정 — **이 경로가 없으면 구매 적립이 한 번도 실행되지 않는다.**
   * 전이표가 delivered→confirmed를 customer·system에만 허용하는데(운영자가 고객 대신
   * 확정하면 클레임 기한을 임의로 끊는 셈이다) 그 둘을 부르는 코드가 없었다.
   * 적립은 applyOrderTransition 안에 걸려 있어 도달만 하면 일어난다.
   */
  confirmPurchase: protectedProcedure
    .input(z.object({ orderNo: z.string().trim().min(1).max(40) }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        confirmOrderByCustomer(ctx.db, {
          orderNo: input.orderNo,
          customerId: ctx.customerId,
        }),
      ),
    ),

  getMyOrderDetail: protectedProcedure
    .input(z.object({ orderNo: orderNoSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        getMyOrderDetail(ctx.db, { orderNo: input.orderNo, customerId: ctx.customerId }),
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
    .mutation(({ ctx, input }) => {
      assertGuestLookupAllowed(ctx.clientIp);
      return withOrderErrorMapping(() =>
        lookupGuestOrder(ctx.db, {
          orderNo: input.orderNo,
          ordererPhone: input.ordererPhone,
        }),
      );
    }),
});
