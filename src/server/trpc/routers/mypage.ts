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

import { protectedProcedure, router } from "../init";

/**
 * 마이페이지 라우터 — 프로필·배송지 관리, 전부 회원 전용(protectedProcedure).
 * 여기서는 zod 검증만 하고, 소유 검증·기본 배송지 단일 보장은 서비스가 한다(RULE-14).
 */

const mobilePhoneSchema = z
  .string()
  .transform((rawPhone) => rawPhone.replaceAll("-", ""))
  .pipe(
    z.string().regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 올바르지 않습니다."),
  );

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
        email: z.email("이메일 형식이 올바르지 않습니다. 다시 확인해 주세요."),
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

  createAddress: protectedProcedure
    .input(addressFieldsSchema)
    .mutation(({ ctx, input }) =>
      createAddress(ctx.db, { customerId: ctx.customerId, ...input }),
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

  setDefaultAddress: protectedProcedure
    .input(z.object({ addressId: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      setDefaultAddress(ctx.db, { customerId: ctx.customerId, ...input }),
    ),
});
