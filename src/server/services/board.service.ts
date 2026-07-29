import "server-only";

import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import type { db as Database } from "@/db";
import { board, comment, commonCode, customer, post } from "@/db/schema";
import { maskOrdererName } from "@/domain/order";

/**
 * 게시판 도메인 서비스 — 공지사항·FAQ 조회와 1:1 문의 등록.
 * 세 게시판(notice/faq/qna)은 모두 post 한 테이블을 쓰므로,
 * "어느 게시판의 글인가"를 boardId로 반드시 한정한다 — id만으로 조회하면
 * 비밀글(qna)이 공지 상세 경로로 새어 나갈 수 있다.
 */

type DatabaseClient = typeof Database;

const BCRYPT_ROUNDS = 12;

/**
 * slug로 게시판 id를 찾는다. 게시판 3종은 기본 시드가 만드는 고정 구조라
 * 없다는 것은 시드 누락 — 사용자 잘못이 아니므로 서버 오류로 낸다.
 */
async function getBoardIdBySlug(
  database: DatabaseClient,
  boardSlug: "notice" | "faq" | "qna",
): Promise<number> {
  const [boardRow] = await database
    .select({ boardId: board.id })
    .from(board)
    .where(eq(board.slug, boardSlug))
    .limit(1);

  if (!boardRow) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `게시판(${boardSlug})이 등록되어 있지 않습니다. 관리자에게 문의해 주세요.`,
    });
  }
  return boardRow.boardId;
}

// =============================================================
// 공지사항
// =============================================================

export type NoticeListItem = {
  noticeId: number;
  categoryCode: string | null;
  /** common_code(notice_category) 표시명 — 코드가 없거나 매칭 실패면 null */
  categoryName: string | null;
  title: string;
  isPinned: boolean;
  viewCount: number;
  createdAt: Date;
};

export type NoticePage = {
  notices: NoticeListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * 공지 목록 한 페이지 — 고정글 우선, 그 안에서 최신순.
 * page·pageSize는 URL searchParams에서 그대로 올 수 있어 여기서 방어한다.
 */
export async function getNoticePage(
  database: DatabaseClient,
  pagination: { page: number; pageSize: number },
): Promise<NoticePage> {
  const pageSize = Math.min(Math.max(Math.floor(pagination.pageSize) || 1, 1), 50);
  const requestedPage = Math.max(Math.floor(pagination.page) || 1, 1);

  const noticeBoardId = await getBoardIdBySlug(database, "notice");

  const [noticeRows, [{ totalCount }]] = await Promise.all([
    database
      .select({
        noticeId: post.id,
        categoryCode: post.categoryCode,
        categoryName: commonCode.name,
        title: post.title,
        isPinned: post.isPinned,
        viewCount: post.viewCount,
        createdAt: post.createdAt,
      })
      .from(post)
      .leftJoin(
        commonCode,
        and(
          eq(commonCode.groupCode, "notice_category"),
          eq(commonCode.code, post.categoryCode),
        ),
      )
      .where(eq(post.boardId, noticeBoardId))
      // createdAt이 같은 시드 데이터도 순서가 흔들리지 않게 id를 최종 타이브레이커로 둔다
      .orderBy(desc(post.isPinned), desc(post.createdAt), desc(post.id))
      .limit(pageSize)
      .offset((requestedPage - 1) * pageSize),
    database
      .select({ totalCount: count() })
      .from(post)
      .where(eq(post.boardId, noticeBoardId)),
  ]);

  return {
    notices: noticeRows,
    totalCount,
    page: requestedPage,
    pageSize,
    totalPages: Math.max(Math.ceil(totalCount / pageSize), 1),
  };
}

export type NoticeDetail = {
  noticeId: number;
  categoryCode: string | null;
  categoryName: string | null;
  title: string;
  content: string;
  isPinned: boolean;
  /** 이번 열람이 반영된 조회수 */
  viewCount: number;
  createdAt: Date;
};

/**
 * 공지 상세 — 조회수 증가를 원자적 UPDATE(view_count = view_count + 1)로 처리한다.
 * 읽고-더하고-쓰는 방식은 동시 열람에서 증가분을 잃는다(RULE-11 조건부 UPDATE와 같은 원리).
 * 없는 id·다른 게시판 글이면 null — 화면이 404/빈 상태를 그린다.
 */
export async function getNoticeDetail(
  database: DatabaseClient,
  noticeId: number,
): Promise<NoticeDetail | null> {
  const noticeBoardId = await getBoardIdBySlug(database, "notice");

  const [updatedNotice] = await database
    .update(post)
    .set({
      viewCount: sql`${post.viewCount} + 1`,
      // 열람은 내용 수정이 아니다 — $onUpdate가 수정일을 덮지 않게 현재 값으로 고정
      updatedAt: sql`${post.updatedAt}`,
    })
    .where(and(eq(post.id, noticeId), eq(post.boardId, noticeBoardId)))
    .returning({
      noticeId: post.id,
      categoryCode: post.categoryCode,
      title: post.title,
      content: post.content,
      isPinned: post.isPinned,
      viewCount: post.viewCount,
      createdAt: post.createdAt,
    });

  if (!updatedNotice) return null;

  let categoryName: string | null = null;
  if (updatedNotice.categoryCode) {
    const [categoryRow] = await database
      .select({ categoryName: commonCode.name })
      .from(commonCode)
      .where(
        and(
          eq(commonCode.groupCode, "notice_category"),
          eq(commonCode.code, updatedNotice.categoryCode),
        ),
      )
      .limit(1);
    categoryName = categoryRow?.categoryName ?? null;
  }

  return { ...updatedNotice, categoryName };
}

// =============================================================
// FAQ
// =============================================================

export type FaqListItem = {
  faqPostId: number;
  categoryCode: string | null;
  /** common_code(faq_category) 표시명 */
  categoryName: string | null;
  question: string;
  answer: string;
};

/**
 * FAQ 전체(또는 분류 필터) — 아코디언 화면이 한 번에 받아 클라이언트에서 펼친다.
 * 정렬은 등록순(id 오름차순) — 별도 정렬 컬럼이 없는 현재 스키마의 자연 순서.
 */
export async function getFaqList(
  database: DatabaseClient,
  filter: { categoryCode?: string } = {},
): Promise<FaqListItem[]> {
  const faqBoardId = await getBoardIdBySlug(database, "faq");

  return database
    .select({
      faqPostId: post.id,
      categoryCode: post.categoryCode,
      categoryName: commonCode.name,
      question: post.title,
      answer: post.content,
    })
    .from(post)
    .leftJoin(
      commonCode,
      and(eq(commonCode.groupCode, "faq_category"), eq(commonCode.code, post.categoryCode)),
    )
    .where(
      and(
        eq(post.boardId, faqBoardId),
        filter.categoryCode ? eq(post.categoryCode, filter.categoryCode) : undefined,
      ),
    )
    .orderBy(asc(post.createdAt), asc(post.id));
}

// =============================================================
// 1:1 문의 등록
// =============================================================

/** customerId 유무로 회원/비회원이 갈린다 — 비회원은 열람 검증용 자격 3종이 필수 */
export type CreateQnaPostInput = {
  /** common_code(qna_type)의 영문 code — 여기서 실존 여부를 검증한다 */
  categoryCode: string;
  title: string;
  content: string;
  isSecret: boolean;
} & (
  | { customerId: number }
  | {
      customerId?: undefined;
      guestName: string;
      guestPhone: string;
      /** 평문으로 받아 여기서 bcrypt 해시만 저장한다 */
      guestPassword: string;
    }
);

export type CreatedQnaPost = {
  qnaPostId: number;
  createdAt: Date;
};

/**
 * 1:1 문의 등록 — 회원(customerId) 또는 비회원(이름·연락처·비밀번호 해시).
 * 첨부는 1차 화면에 입력이 없어 받지 않는다(attachments null 유지).
 */
export async function createQnaPost(
  database: DatabaseClient,
  input: CreateQnaPostInput,
): Promise<CreatedQnaPost> {
  // 화면 셀렉트를 우회한 임의 문자열이 코드 컬럼에 남지 않게 실존 코드만 통과시킨다
  const [qnaTypeRow] = await database
    .select({ qnaTypeCodeId: commonCode.id })
    .from(commonCode)
    .where(
      and(
        eq(commonCode.groupCode, "qna_type"),
        eq(commonCode.code, input.categoryCode),
        eq(commonCode.isActive, true),
      ),
    )
    .limit(1);
  if (!qnaTypeRow) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "문의 유형이 올바르지 않습니다. 유형을 다시 선택해 주세요.",
    });
  }

  const qnaBoardId = await getBoardIdBySlug(database, "qna");

  const commonColumns = {
    boardId: qnaBoardId,
    categoryCode: input.categoryCode,
    title: input.title,
    content: input.content,
    isSecret: input.isSecret,
  };

  const insertValues: typeof post.$inferInsert =
    input.customerId !== undefined
      ? { ...commonColumns, authorType: "customer", customerId: input.customerId }
      : {
          ...commonColumns,
          authorType: "guest",
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          // 평문 비밀번호는 어디에도 남기지 않는다 — 비회원 열람 검증은 해시 비교로만
          guestPasswordHash: await bcrypt.hash(input.guestPassword, BCRYPT_ROUNDS),
        };

  const [createdPost] = await database
    .insert(post)
    .values(insertValues)
    .returning({ qnaPostId: post.id, createdAt: post.createdAt });

  return createdPost;
}

// =============================================================
// 상품 문의 — 상품 상세 탭에서 묻고 답한다
// =============================================================

export type ProductQnaCard = {
  qnaPostId: number;
  title: string;
  /** 비밀글이면 본문을 내리지 않는다 — 목록에서 새어나가면 비밀글이 아니다 */
  content: string | null;
  isSecret: boolean;
  isAnswered: boolean;
  authorName: string;
  answer: { content: string; createdAt: Date } | null;
  createdAt: Date;
};

/**
 * 상품 문의 목록.
 *
 * **비밀글은 본문과 답변을 아예 내려보내지 않는다.** 화면에서 가리는 방식은 응답을 열어보면
 * 그대로 보여 비밀글이 아니게 된다. 작성자 본인에게만 내용을 준다.
 */
export async function getProductQnas(
  database: DatabaseClient,
  input: { productId: number; viewerCustomerId: number | null; page?: number },
): Promise<{ cards: ProductQnaCard[]; totalCount: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = 10;
  const qnaBoardId = await getBoardIdBySlug(database, "qna");
  const listFilter = and(eq(post.boardId, qnaBoardId), eq(post.productId, input.productId));

  const [totalRow] = await database.select({ total: count() }).from(post).where(listFilter);

  const rows = await database
    .select({
      qnaPostId: post.id,
      title: post.title,
      content: post.content,
      isSecret: post.isSecret,
      isAnswered: post.isAnswered,
      customerId: post.customerId,
      memberName: customer.name,
      guestName: post.guestName,
      createdAt: post.createdAt,
    })
    .from(post)
    .leftJoin(customer, eq(post.customerId, customer.id))
    .where(listFilter)
    .orderBy(desc(post.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const postIds = rows.map((row) => row.qnaPostId);
  const answerRows =
    postIds.length === 0
      ? []
      : await database
          .select({
            postId: comment.postId,
            content: comment.content,
            createdAt: comment.createdAt,
          })
          .from(comment)
          .where(and(inArray(comment.postId, postIds), eq(comment.authorType, "admin")))
          .orderBy(asc(comment.id));

  return {
    cards: rows.map((row) => {
      const isOwner = input.viewerCustomerId !== null && row.customerId === input.viewerCustomerId;
      const canRead = !row.isSecret || isOwner;
      const answer = answerRows.find((answerRow) => answerRow.postId === row.qnaPostId);
      const authorName = row.memberName ?? row.guestName ?? "비회원";
      return {
        qnaPostId: row.qnaPostId,
        title: canRead ? row.title : "비밀글입니다",
        content: canRead ? row.content : null,
        isSecret: row.isSecret,
        isAnswered: row.isAnswered,
        // 이름도 마스킹한다 — 문의 목록은 누구나 본다
        authorName: maskOrdererName(authorName),
        answer: canRead && answer ? { content: answer.content, createdAt: answer.createdAt } : null,
        createdAt: row.createdAt,
      };
    }),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize,
  };
}

/** 상품 문의 등록 — 1:1 문의와 같은 테이블이지만 productId가 붙는다 */
export async function createProductQna(
  database: DatabaseClient,
  input: CreateQnaPostInput & { productId: number },
): Promise<CreatedQnaPost> {
  const created = await createQnaPost(database, input);
  await database
    .update(post)
    .set({ productId: input.productId })
    .where(eq(post.id, created.qnaPostId));
  return created;
}
