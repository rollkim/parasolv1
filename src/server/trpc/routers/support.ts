import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQnaAllowed } from "@/server/security/rate-limit";
import {
  createProductQna,
  createQnaPost,
  getProductQnas,
} from "@/server/services/board.service";

import { publicProcedure, router } from "../init";

/**
 * 고객지원 라우터 — 1:1 문의 등록.
 * 공지·FAQ·약관 조회는 서버 컴포넌트가 서비스를 직접 부르므로(선례: (store) 레이아웃)
 * tRPC 표면은 클라이언트 상호작용이 필요한 뮤테이션만 연다(RULE-14 공개 표면 최소화).
 */

// bcrypt는 72바이트 초과분을 조용히 잘라내므로 상한을 명시해 착각을 막는다
const guestPasswordSchema = z
  .string()
  .min(4, "비밀번호는 4자 이상 입력해 주세요.")
  .max(72, "비밀번호는 72자 이하로 입력해 주세요.");

const guestPhoneSchema = z
  .string()
  .transform((rawPhone) => rawPhone.replaceAll("-", ""))
  .pipe(
    z.string().regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 올바르지 않습니다."),
  );

const qnaCreateInputSchema = z.object({
  // 코드값 규약(영문 소문자 snake_case)만 통과 — 실존 여부는 서비스가 DB로 검증한다
  categoryCode: z
    .string()
    .regex(/^[a-z0-9_]+$/, "문의 유형이 올바르지 않습니다."),
  title: z
    .string()
    .trim()
    .min(1, "제목을 입력해 주세요.")
    .max(200, "제목은 200자 이하로 입력해 주세요."),
  content: z
    .string()
    .trim()
    .min(1, "문의 내용을 입력해 주세요.")
    .max(5000, "문의 내용은 5,000자 이하로 입력해 주세요."),
  isSecret: z.boolean(),
  // 비회원 전용 3종 — "비회원이면 필수"는 세션(ctx)을 아는 뮤테이션 본문에서 판정한다.
  // zod는 요청 본문만 볼 수 있어 로그인 여부에 따른 조건부 필수를 표현할 수 없다.
  guestName: z
    .string()
    .trim()
    .min(1, "이름을 입력해 주세요.")
    .max(50, "이름은 50자 이하로 입력해 주세요.")
    .optional(),
  guestPhone: guestPhoneSchema.optional(),
  guestPassword: guestPasswordSchema.optional(),
});

export const supportRouter = router({
  qna: router({
    /** 문의 등록 — 회원은 세션으로 귀속, 비회원은 이름·연락처·비밀번호로 등록 */
    create: publicProcedure
      .input(qnaCreateInputSchema)
      .mutation(async ({ ctx, input }) => {
        // 문의 스팸 억제 — IP 기준 시간당 한도.
        // IP는 컨텍스트에서 온다: next/headers를 라우터가 직접 부르면 HTTP 밖 호출자
        // (검증 스크립트·배치)에서 "headers was called outside a request scope"로 깨진다.
        assertQnaAllowed(ctx.clientIp);

        if (ctx.customerId !== null) {
          // 회원 문의 — 클라이언트가 보낸 guest 필드는 신뢰하지 않고 버린다
          return createQnaPost(ctx.db, {
            customerId: ctx.customerId,
            categoryCode: input.categoryCode,
            title: input.title,
            content: input.content,
            isSecret: input.isSecret,
          });
        }

        if (!input.guestName || !input.guestPhone || !input.guestPassword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "비회원 문의는 이름·휴대폰 번호·비밀번호를 모두 입력해 주세요.",
          });
        }
        return createQnaPost(ctx.db, {
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          guestPassword: input.guestPassword,
          categoryCode: input.categoryCode,
          title: input.title,
          content: input.content,
          isSecret: input.isSecret,
        });
      }),
  }),

  /** 상품 문의 — 1:1 문의와 같은 게시판이지만 상품에 묶인다 */
  productQna: router({
    list: publicProcedure
      .input(
        z.object({
          productId: z.number().int().positive(),
          page: z.number().int().min(1).optional(),
        }),
      )
      .query(({ ctx, input }) =>
        getProductQnas(ctx.db, {
          productId: input.productId,
          // 비밀글 본문은 작성자에게만 — 화면에서 가리면 응답을 열어보는 순간 새어나간다
          viewerCustomerId: ctx.customerId,
          page: input.page,
        }),
      ),

    create: publicProcedure
      .input(qnaCreateInputSchema.extend({ productId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        assertQnaAllowed(ctx.clientIp);

        if (ctx.customerId !== null) {
          return createProductQna(ctx.db, {
            productId: input.productId,
            customerId: ctx.customerId,
            categoryCode: input.categoryCode,
            title: input.title,
            content: input.content,
            isSecret: input.isSecret,
          });
        }

        if (!input.guestName || !input.guestPhone || !input.guestPassword) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "비회원 문의는 이름·휴대폰 번호·비밀번호를 모두 입력해 주세요.",
          });
        }
        return createProductQna(ctx.db, {
          productId: input.productId,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          guestPassword: input.guestPassword,
          categoryCode: input.categoryCode,
          title: input.title,
          content: input.content,
          isSecret: input.isSecret,
        });
      }),
  }),
});
