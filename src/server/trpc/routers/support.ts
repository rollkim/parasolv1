import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { assertQnaAllowed, recordAttempt } from "@/server/security/rate-limit";
import {
  createProductQna,
  createQnaPost,
  getProductQnas,
  listGuestQnaPosts,
  listMyQnaPosts,
} from "@/server/services/board.service";

import { protectedProcedure, publicProcedure, router } from "../init";

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
  // isSecret은 여기 없다 — 상품 문의만 갖는다(1:1 문의는 공개 목록이 없어 뜻이 없다).
  // 공통 스키마에 두면 1:1 폼이 안 보내는 값을 검증에서 요구하게 된다.
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

/**
 * 1:1 문의는 **항상 비공개**다 — 화면이 보낸 값을 쓰지 않는다.
 *
 * 상품 문의와 달리 1:1 문의에는 공개 목록이 없다(본인만 본다: 회원은 세션, 비회원은 문의 비밀번호).
 * 그래서 "비밀글로 할까요?"는 가릴 대상이 없는 질문이라 화면에서 뺐다.
 * 값을 서버가 못박는 이유: 나중에 누군가 문의 목록 화면을 만들어도 공개 문의가 섞여 새지 않는다.
 * 기본을 비공개로 두면 실수의 방향이 안전한 쪽이 된다.
 */
const ALWAYS_PRIVATE = true;

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
            isSecret: ALWAYS_PRIVATE,
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
          isSecret: ALWAYS_PRIVATE,
        });
      }),

    /** 내 문의 내역 — 회원. 세션이 곧 인증이라 추가 입력이 없다 */
    listMine: protectedProcedure.query(({ ctx }) => listMyQnaPosts(ctx.db, ctx.customerId)),

    /**
     * 비회원 문의 확인 — 연락처 + 작성 시 비밀번호(주문조회와 같은 2요소).
     * 비밀번호 대입을 막기 위해 IP+연락처 기준으로 분당 5회로 묶는다.
     */
    guestLookup: publicProcedure
      .input(
        z.object({
          guestPhone: z
            .string()
            .transform((raw) => raw.replaceAll("-", ""))
            .pipe(z.string().regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 올바르지 않습니다.")),
          guestPassword: z.string().min(4, "비밀번호는 4자 이상입니다.").max(50),
        }),
      )
      .mutation(({ ctx, input }) => {
        const limitState = recordAttempt(
          "qna-lookup:" + (ctx.clientIp ?? "unknown") + ":" + input.guestPhone,
          { limit: 5, windowMs: 60_000 },
        );
        if (!limitState.allowed) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "시도가 너무 잦습니다. " + limitState.retryAfterSeconds + "초 뒤에 다시 시도해 주세요.",
          });
        }
        // 등록 스키마와 같은 transform이 이미 하이픈을 걷어냈다 — 저장값과 형식이 같다
        return listGuestQnaPosts(ctx.db, {
          guestPhone: input.guestPhone,
          guestPassword: input.guestPassword,
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
      .input(
        qnaCreateInputSchema.extend({
          productId: z.number().int().positive(),
          // 상품 문의는 상품 상세에 공개 목록이 있어 비밀글 선택이 실제로 뜻을 갖는다
          isSecret: z.boolean(),
        }),
      )
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
