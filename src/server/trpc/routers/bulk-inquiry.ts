import { z } from "zod";

import { assertQnaAllowed } from "@/server/security/rate-limit";
import {
  createBulkInquiry,
  getBulkPurchaseTypes,
} from "@/server/services/bulk-inquiry.service";

import { publicProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 단체구매 문의 — 로그인 없이 접수한다.
 * 기업 담당자에게 회원가입부터 요구하면 대부분 이탈한다.
 */
export const bulkInquiryRouter = router({
  /** 구매 유형 선택지 — common_code(bulk_type)가 원천 */
  purchaseTypes: publicProcedure.query(({ ctx }) => getBulkPurchaseTypes(ctx.db)),

  create: publicProcedure
    .input(
      z.object({
        purchaseTypeCode: z.string().trim().min(1, "구매 유형을 선택해 주세요.").max(30),
        companyName: z
          .string()
          .trim()
          .min(1, "회사/단체명을 입력해 주세요.")
          .max(100, "회사/단체명은 100자 이하로 입력해 주세요."),
        businessNo: z.string().trim().max(20).optional(),
        managerName: z
          .string()
          .trim()
          .min(1, "담당자명을 입력해 주세요.")
          .max(50, "담당자명은 50자 이하로 입력해 주세요."),
        phone: z
          .string()
          .transform((rawPhone) => rawPhone.replaceAll("-", ""))
          .pipe(
            z
              .string()
              .regex(/^0[0-9]{8,10}$/, "연락처 형식이 올바르지 않습니다. 숫자만 입력해 주세요."),
          ),
        email: z.email("이메일 형식이 올바르지 않습니다.").optional().or(z.literal("")),
        wantedProduct: z.string().trim().max(200).optional(),
        // 수량은 필수다 — 없으면 견적을 낼 수 없다(목업도 필수 표시)
        quantity: z
          .number()
          .int()
          .min(1, "예상 수량을 입력해 주세요.")
          .max(1_000_000, "수량이 너무 큽니다. 담당자에게 직접 문의해 주세요."),
        /** 예산 상한(원) — 화면은 구간을 고르고 그 상한을 보낸다. 선택 안 하면 생략 */
        budget: z.number().int().min(0).optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
        needTaxInvoice: z.boolean(),
        content: z.string().trim().max(5000, "요청사항은 5,000자 이하로 입력해 주세요.").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1:1 문의와 같은 스팸 억제 — 로그인이 없어 IP가 유일한 기준이다
      assertQnaAllowed(ctx.clientIp);

      return withOrderErrorMapping(() =>
        createBulkInquiry(ctx.db, {
          purchaseTypeCode: input.purchaseTypeCode,
          companyName: input.companyName,
          businessNo: input.businessNo || null,
          managerName: input.managerName,
          phone: input.phone,
          email: input.email || null,
          wantedProduct: input.wantedProduct || null,
          quantity: input.quantity,
          budget: input.budget ?? null,
          // 날짜 문자열로 받는다 — Date로 받으면 브라우저 시간대에 따라 하루가 밀린다
          dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00`) : null,
          needTaxInvoice: input.needTaxInvoice,
          content: input.content || null,
        }),
      );
    }),
});
