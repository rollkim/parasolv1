import { z } from "zod";

import {
  createAddress,
  deleteAddress,
  getMyProfile,
  listMyAddresses,
  setDefaultAddress,
  updateAddress,
  updateMyProfile,
} from "@/server/services/customer.service";

import {
  countUsableCoupons,
  listCustomerCoupons,
} from "@/server/services/coupon.service";
import { getCustomerGradeSummary } from "@/server/services/grade.service";
import { emailInput, mobilePhoneInput } from "@/server/trpc/shared-input";
import {
  getPointHistory,
  getPointSummary,
} from "@/server/services/point-history.service";

import { withOrderErrorMapping } from "../order-error";
import { protectedProcedure, router } from "../init";

/**
 * 마이페이지 라우터 — 프로필·배송지 관리, 전부 회원 전용(protectedProcedure).
 * 여기서는 zod 검증만 하고, 소유 검증·기본 배송지 단일 보장은 서비스가 한다(RULE-14).
 */

/** 연락처 검증은 라우터마다 따로 두지 않는다 — shared-input 하나만 쓴다 */
const mobilePhoneSchema = mobilePhoneInput;

const addressFieldsSchema = z.object({
  label: z
    .string()
    .trim()
    .max(20, "배송지 이름은 20자 이하로 입력해 주세요.")
    .optional(),
  recipient: z
    .string()
    .trim()
    .min(1, "받는 분 이름을 입력해 주세요.")
    .max(50, "받는 분 이름은 50자 이하로 입력해 주세요."),
  phone: mobilePhoneSchema,
  zipcode: z
    .string()
    .trim()
    .regex(/^[0-9]{5}$/, "우편번호가 올바르지 않습니다. 주소 검색을 이용해 주세요."),
  addr1: z
    .string()
    .trim()
    .min(1, "주소를 입력해 주세요. 주소 검색을 이용해 주세요.")
    .max(200, "주소는 200자 이하로 입력해 주세요."),
  addr2: z
    .string()
    .trim()
    .max(200, "상세 주소는 200자 이하로 입력해 주세요.")
    .optional(),
  isDefault: z.boolean().optional(),
});

export const mypageRouter = router({
  /** 회원정보 화면 초기 데이터 */
  getProfile: protectedProcedure.query(({ ctx }) => getMyProfile(ctx.db, ctx.customerId)),

  /** 회원정보 수정 — 검증 메시지는 원인+해결이 함께 보이게 쓴다(접근성 규칙) */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, "이름을 입력해 주세요.")
          .max(50, "이름은 50자 이하로 입력해 주세요."),
        email: emailInput,
        phone: mobilePhoneSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      updateMyProfile(ctx.db, { customerId: ctx.customerId, ...input }),
    ),

  /** 배송지 목록 — 기본 배송지가 맨 위 */
  listAddresses: protectedProcedure.query(({ ctx }) =>
    listMyAddresses(ctx.db, ctx.customerId),
  ),

  /**
   * 배송지 등록 — 상한 초과는 서버가 판정한다.
   * 매핑을 거치지 않으면 상한 오류가 500(서버 잘못)으로 나간다. 이건 고객이 고칠 수 있는 상황이라
   * 409 + "지우고 다시" 문구로 내려야 한다.
   */
  createAddress: protectedProcedure
    .input(addressFieldsSchema)
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() =>
        createAddress(ctx.db, { customerId: ctx.customerId, ...input }),
      ),
    ),

  updateAddress: protectedProcedure
    .input(addressFieldsSchema.extend({ addressId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      updateAddress(ctx.db, { customerId: ctx.customerId, ...input }),
    ),

  /** 배송지 삭제 — 화면은 확인 모달을 거친 뒤에만 부른다 */
  deleteAddress: protectedProcedure
    .input(z.object({ addressId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      deleteAddress(ctx.db, { customerId: ctx.customerId, ...input }),
    ),

  /** 적립금 요약 — 보유·사용가능·30일 내 소멸 예정 */
  pointSummary: protectedProcedure.query(({ ctx }) =>
    getPointSummary(ctx.db, ctx.customerId),
  ),

  /** 적립금 내역 — 잔액만 보여주면 "왜 줄었는지"를 운영자에게 물어야 한다 */
  pointHistory: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).optional() }).optional())
    .query(({ ctx, input }) =>
      getPointHistory(ctx.db, { customerId: ctx.customerId, page: input?.page }),
    ),

  /** 등급 요약 — 현재 등급·추가 적립률·다음 등급까지 남은 금액 */
  gradeSummary: protectedProcedure.query(({ ctx }) =>
    getCustomerGradeSummary(ctx.db, ctx.customerId),
  ),

  /** 보유 쿠폰 — 사용 가능·사용함·만료를 화면이 세 묶음으로 나눈다 */
  coupons: protectedProcedure.query(({ ctx }) => listCustomerCoupons(ctx.db, ctx.customerId)),

  /** 사용 가능 쿠폰 개수 — 요약 카드가 쓴다 */
  usableCouponCount: protectedProcedure.query(({ ctx }) =>
    countUsableCoupons(ctx.db, ctx.customerId),
  ),

  setDefaultAddress: protectedProcedure
    .input(z.object({ addressId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      setDefaultAddress(ctx.db, { customerId: ctx.customerId, ...input }),
    ),
});
