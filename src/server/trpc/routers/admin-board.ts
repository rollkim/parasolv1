import { z } from "zod";

import {
  answerAdminQna,
  countWaitingQnas,
  deleteAdminPost,
  deleteAdminQnaAnswer,
  getAdminNotice,
  getAdminQna,
  listAdminFaqs,
  listAdminBulkInquiries,
  listAdminNotices,
  listAdminQnas,
  saveAdminFaq,
  saveAdminNotice,
  updateAdminBulkInquiry,
} from "@/server/services/admin-board.service";

import { adminProcedure, router } from "../init";
import { withOrderErrorMapping } from "../order-error";

/**
 * 관리자 게시판 라우터 — 공지·FAQ·문의를 각각 다룬다.
 * 한 테이블(post)을 쓰지만 의미가 달라 프로시저를 합치지 않는다 —
 * 합치면 호출부에서 "제목이 질문인지 공지인지"가 흐려진다.
 */

const postIdSchema = z.number().int().positive();
const titleSchema = z.string().trim().min(1, "제목을 입력해 주세요.").max(200);
const bodySchema = z.string().trim().min(1, "내용을 입력해 주세요.").max(20_000);

export const adminBoardRouter = router({
  // ── 공지
  listNotices: adminProcedure
    .input(
      z.object({
        keyword: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminNotices(ctx.db, input)),

  getNotice: adminProcedure
    .input(z.object({ postId: postIdSchema }))
    .query(({ ctx, input }) =>
      withOrderErrorMapping(() => getAdminNotice(ctx.db, input.postId)),
    ),

  saveNotice: adminProcedure
    .input(
      z.object({
        postId: postIdSchema.nullable(),
        title: titleSchema,
        content: bodySchema,
        isPinned: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => saveAdminNotice(ctx.db, input))),

  // ── FAQ
  listFaqs: adminProcedure
    .input(z.object({ categoryCode: z.string().trim().max(50).optional() }))
    .query(({ ctx, input }) => listAdminFaqs(ctx.db, input)),

  saveFaq: adminProcedure
    .input(
      z.object({
        postId: postIdSchema.nullable(),
        categoryCode: z.string().trim().max(50).nullable(),
        question: titleSchema,
        answer: bodySchema,
      }),
    )
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => saveAdminFaq(ctx.db, input))),

  // ── 1:1 문의
  listQnas: adminProcedure
    .input(
      z.object({
        tab: z.enum(["all", "waiting", "answered"]).optional(),
        keyword: z.string().trim().max(100).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminQnas(ctx.db, input)),

  getQna: adminProcedure
    .input(z.object({ postId: postIdSchema }))
    .query(({ ctx, input }) => withOrderErrorMapping(() => getAdminQna(ctx.db, input.postId))),

  /** 답변 등록·수정 — is_answered가 함께 맞춰진다 */
  answerQna: adminProcedure
    .input(
      z.object({
        postId: postIdSchema,
        commentId: postIdSchema.nullable(),
        content: bodySchema,
      }),
    )
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => answerAdminQna(ctx.db, input))),

  deleteQnaAnswer: adminProcedure
    .input(z.object({ postId: postIdSchema, commentId: postIdSchema }))
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => deleteAdminQnaAnswer(ctx.db, input)),
    ),

  // ── 공통
  deletePost: adminProcedure
    .input(z.object({ postId: postIdSchema }))
    .mutation(({ ctx, input }) => withOrderErrorMapping(() => deleteAdminPost(ctx.db, input))),

  waitingQnaCount: adminProcedure.query(({ ctx }) => countWaitingQnas(ctx.db)),

  // ── 단체구매 문의
  listBulkInquiries: adminProcedure
    .input(
      z.object({
        inquiryStatus: z.enum(["all", "received", "contacted", "closed"]).optional(),
        page: z.number().int().min(1).optional(),
      }),
    )
    .query(({ ctx, input }) => listAdminBulkInquiries(ctx.db, input)),

  updateBulkInquiry: adminProcedure
    .input(
      z.object({
        inquiryId: postIdSchema,
        inquiryStatus: z.enum(["received", "contacted", "closed"]),
        adminMemo: z.string().trim().max(2000).nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      withOrderErrorMapping(() => updateAdminBulkInquiry(ctx.db, input)),
    ),
});
