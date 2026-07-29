import "server-only";

import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";

import { board, bulkInquiry, comment, commonCode, customer, post, product } from "@/db/schema";
import { formatPhone } from "@/domain/phone";

import type { DatabaseClient, TransactionClient } from "./db-client";

/**
 * 관리자 게시판 관리 — 공지사항 · FAQ · 1:1 문의.
 *
 * 세 게시판이 한 테이블(post)을 쓰지만 **의미가 다르다**:
 *   공지 = title/content + 상단 고정, FAQ = title(질문)/content(답변),
 *   문의 = 고객이 쓰고 관리자가 comment로 답한다.
 * 그래서 함수도 셋으로 나눈다 — 하나로 합치면 "제목이 질문인지 공지인지" 호출부가 헷갈린다.
 *
 * 답변 여부는 post.is_answered와 comment 존재가 **함께** 맞아야 한다.
 * 둘이 어긋나면 목록의 '미답변' 뱃지와 상세의 답변이 서로 다른 말을 한다.
 */

/** slug는 시드가 고정한다(notice/faq/qna) — 게시판 자체를 관리자가 만들지는 않는다 */
async function getBoardId(
  client: TransactionClient | DatabaseClient,
  boardSlug: "notice" | "faq" | "qna",
): Promise<number> {
  const [row] = await client
    .select({ id: board.id })
    .from(board)
    .where(eq(board.slug, boardSlug))
    .limit(1);
  if (!row) throw new AdminBoardNotFoundError(boardSlug);
  return row.id;
}

export class AdminBoardNotFoundError extends Error {
  constructor(readonly boardSlug: string) {
    super(`게시판을 찾을 수 없습니다: ${boardSlug}. 시드 데이터를 확인해 주세요.`);
    this.name = "AdminBoardNotFoundError";
  }
}

export class AdminPostNotFoundError extends Error {
  constructor(readonly postId: number) {
    super(`글을 찾을 수 없습니다: id=${postId}`);
    this.name = "AdminPostNotFoundError";
  }
}

// =============================================================
// 공지사항
// =============================================================

export type AdminNoticeCard = {
  postId: number;
  title: string;
  isPinned: boolean;
  viewCount: number;
  createdAt: Date;
};

export type AdminNoticeListResult = {
  cards: AdminNoticeCard[];
  totalCount: number;
  page: number;
  pageSize: number;
};

const ADMIN_BOARD_PAGE_SIZE = 20;

export async function listAdminNotices(
  database: DatabaseClient,
  input: { keyword?: string; page?: number } = {},
): Promise<AdminNoticeListResult> {
  const boardId = await getBoardId(database, "notice");
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();
  const listFilter = and(
    eq(post.boardId, boardId),
    keyword ? ilike(post.title, `%${keyword}%`) : undefined,
  );

  const [totalRow] = await database.select({ total: count() }).from(post).where(listFilter);

  const cards = await database
    .select({
      postId: post.id,
      title: post.title,
      isPinned: post.isPinned,
      viewCount: post.viewCount,
      createdAt: post.createdAt,
    })
    .from(post)
    .where(listFilter)
    // 고정 글이 위 — 스토어 목록과 같은 순서라야 관리자가 실제 노출 순서를 본다
    .orderBy(desc(post.isPinned), desc(post.createdAt), desc(post.id))
    .limit(ADMIN_BOARD_PAGE_SIZE)
    .offset((page - 1) * ADMIN_BOARD_PAGE_SIZE);

  return {
    cards,
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_BOARD_PAGE_SIZE,
  };
}

export type AdminNoticeDetail = AdminNoticeCard & { content: string };

export async function getAdminNotice(
  database: DatabaseClient,
  postId: number,
): Promise<AdminNoticeDetail> {
  const [row] = await database
    .select({
      postId: post.id,
      title: post.title,
      content: post.content,
      isPinned: post.isPinned,
      viewCount: post.viewCount,
      createdAt: post.createdAt,
    })
    .from(post)
    .where(eq(post.id, postId))
    .limit(1);
  if (!row) throw new AdminPostNotFoundError(postId);
  return row;
}

export async function saveAdminNotice(
  database: DatabaseClient,
  input: { postId: number | null; title: string; content: string; isPinned: boolean },
): Promise<{ postId: number }> {
  if (input.postId === null) {
    const boardId = await getBoardId(database, "notice");
    const [inserted] = await database
      .insert(post)
      .values({
        boardId,
        authorType: "admin",
        title: input.title,
        content: input.content,
        isPinned: input.isPinned,
      })
      .returning({ id: post.id });
    return { postId: inserted.id };
  }

  const updated = await database
    .update(post)
    .set({ title: input.title, content: input.content, isPinned: input.isPinned })
    .where(eq(post.id, input.postId))
    .returning({ id: post.id });
  if (updated.length === 0) throw new AdminPostNotFoundError(input.postId);
  return { postId: updated[0].id };
}

// =============================================================
// FAQ — title이 질문, content가 답변이다
// =============================================================

export type AdminFaqCard = {
  postId: number;
  categoryCode: string | null;
  categoryName: string | null;
  question: string;
  answer: string;
};

export async function listAdminFaqs(
  database: DatabaseClient,
  input: { categoryCode?: string } = {},
): Promise<{ cards: AdminFaqCard[]; categoryOptions: { code: string; name: string }[] }> {
  const boardId = await getBoardId(database, "faq");

  const cards = await database
    .select({
      postId: post.id,
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
        eq(post.boardId, boardId),
        input.categoryCode ? eq(post.categoryCode, input.categoryCode) : undefined,
      ),
    )
    .orderBy(asc(post.createdAt), asc(post.id));

  const categoryOptions = await database
    .select({ code: commonCode.code, name: commonCode.name })
    .from(commonCode)
    .where(and(eq(commonCode.groupCode, "faq_category"), eq(commonCode.isActive, true)))
    .orderBy(asc(commonCode.sortOrder), asc(commonCode.id));

  return { cards, categoryOptions };
}

export async function saveAdminFaq(
  database: DatabaseClient,
  input: {
    postId: number | null;
    categoryCode: string | null;
    question: string;
    answer: string;
  },
): Promise<{ postId: number }> {
  if (input.postId === null) {
    const boardId = await getBoardId(database, "faq");
    const [inserted] = await database
      .insert(post)
      .values({
        boardId,
        authorType: "admin",
        categoryCode: input.categoryCode,
        title: input.question,
        content: input.answer,
      })
      .returning({ id: post.id });
    return { postId: inserted.id };
  }

  const updated = await database
    .update(post)
    .set({
      categoryCode: input.categoryCode,
      title: input.question,
      content: input.answer,
    })
    .where(eq(post.id, input.postId))
    .returning({ id: post.id });
  if (updated.length === 0) throw new AdminPostNotFoundError(input.postId);
  return { postId: updated[0].id };
}

// =============================================================
// 1:1 문의 — 고객이 쓰고 관리자가 답한다
// =============================================================

export type AdminQnaTab = "all" | "waiting" | "answered";

/**
 * 문의 종류 — 같은 게시판(qna)에 살지만 답변하는 맥락이 다르다.
 *  - product: 상품 상세에서 온 문의. **어느 상품인지 모르면 답을 쓸 수 없다.**
 *  - direct: 고객센터 1:1 문의. 유형(배송·환불 등)으로 갈래를 잡는다.
 * product_id 유무가 그대로 구분 기준이다 — 별도 플래그를 두면 둘이 어긋날 수 있다.
 */
export type AdminInquiryKind = "all" | "product" | "direct";

export type AdminQnaCard = {
  postId: number;
  title: string;
  categoryCode: string | null;
  categoryName: string | null;
  authorName: string;
  isSecret: boolean;
  isAnswered: boolean;
  createdAt: Date;
  /** 상품 문의면 그 상품 — 1:1 문의는 null */
  inquiryProduct: { productId: number; name: string; slug: string } | null;
};

export type AdminQnaListResult = {
  cards: AdminQnaCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  tabCounts: Record<AdminQnaTab, number>;
  /** 종류별 건수 — 종류를 바꾸기 전에 몇 건인지 보인다 */
  kindCounts: Record<AdminInquiryKind, number>;
};

export async function listAdminQnas(
  database: DatabaseClient,
  input: {
    tab?: AdminQnaTab;
    inquiryKind?: AdminInquiryKind;
    keyword?: string;
    page?: number;
  } = {},
): Promise<AdminQnaListResult> {
  const boardId = await getBoardId(database, "qna");
  const tab = input.tab ?? "all";
  const inquiryKind = input.inquiryKind ?? "all";
  const page = Math.max(1, input.page ?? 1);
  const keyword = input.keyword?.trim();

  const tabFilter =
    tab === "waiting"
      ? eq(post.isAnswered, false)
      : tab === "answered"
        ? eq(post.isAnswered, true)
        : undefined;

  // 상품 문의인지 아닌지는 product_id 유무가 정한다 — 별도 플래그를 두면 둘이 어긋난다
  const kindFilter =
    inquiryKind === "product"
      ? isNotNull(post.productId)
      : inquiryKind === "direct"
        ? isNull(post.productId)
        : undefined;

  const keywordFilter = keyword
    ? or(
        ilike(post.title, `%${keyword}%`),
        ilike(post.content, `%${keyword}%`),
        ilike(post.guestName, `%${keyword}%`),
      )
    : undefined;

  const listFilter = and(eq(post.boardId, boardId), tabFilter, kindFilter, keywordFilter);

  const [totalRow] = await database.select({ total: count() }).from(post).where(listFilter);

  const rows = await database
    .select({
      postId: post.id,
      title: post.title,
      categoryCode: post.categoryCode,
      categoryName: commonCode.name,
      memberName: customer.name,
      guestName: post.guestName,
      isSecret: post.isSecret,
      isAnswered: post.isAnswered,
      createdAt: post.createdAt,
      productId: post.productId,
      productName: product.name,
      productSlug: product.slug,
    })
    .from(post)
    .leftJoin(customer, eq(post.customerId, customer.id))
    // 상품이 지워져도 문의는 남는다(product_id는 set null) — 그때는 상품 칸만 빈다
    .leftJoin(product, eq(post.productId, product.id))
    .leftJoin(
      commonCode,
      and(eq(commonCode.groupCode, "qna_type"), eq(commonCode.code, post.categoryCode)),
    )
    .where(listFilter)
    // 미답변이 위 — 대기열 화면이라 오래된 미답변이 묻히면 안 된다
    .orderBy(asc(post.isAnswered), desc(post.id))
    .limit(ADMIN_BOARD_PAGE_SIZE)
    .offset((page - 1) * ADMIN_BOARD_PAGE_SIZE);

  // 탭 건수는 **선택한 종류 안에서** 센다 — 상품 문의를 보는데 미답변 수가 전체 기준이면
  // "미답변 3"을 눌렀는데 1건만 나오는 일이 생긴다
  const [tabCountRow] = await database
    .select({
      all: count(),
      waiting: sql<number>`count(*) filter (where not ${post.isAnswered})::int`,
      answered: sql<number>`count(*) filter (where ${post.isAnswered})::int`,
    })
    .from(post)
    .where(and(eq(post.boardId, boardId), kindFilter));

  const [kindCountRow] = await database
    .select({
      all: count(),
      product: sql<number>`count(*) filter (where ${post.productId} is not null)::int`,
      direct: sql<number>`count(*) filter (where ${post.productId} is null)::int`,
    })
    .from(post)
    .where(and(eq(post.boardId, boardId), tabFilter));

  return {
    cards: rows.map((row) => ({
      postId: row.postId,
      title: row.title,
      categoryCode: row.categoryCode,
      categoryName: row.categoryName,
      authorName: row.memberName ?? row.guestName ?? "비회원",
      isSecret: row.isSecret,
      isAnswered: row.isAnswered,
      createdAt: row.createdAt,
      inquiryProduct:
        row.productId !== null && row.productName !== null && row.productSlug !== null
          ? { productId: row.productId, name: row.productName, slug: row.productSlug }
          : null,
    })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_BOARD_PAGE_SIZE,
    tabCounts: {
      all: tabCountRow?.all ?? 0,
      waiting: Number(tabCountRow?.waiting ?? 0),
      answered: Number(tabCountRow?.answered ?? 0),
    },
    kindCounts: {
      all: kindCountRow?.all ?? 0,
      product: Number(kindCountRow?.product ?? 0),
      direct: Number(kindCountRow?.direct ?? 0),
    },
  };
}

export type AdminQnaDetail = {
  postId: number;
  title: string;
  content: string;
  categoryCode: string | null;
  categoryName: string | null;
  authorName: string;
  /** 비회원 문의는 연락처가 유일한 회신 수단이다 */
  contactPhone: string | null;
  isMember: boolean;
  isSecret: boolean;
  isAnswered: boolean;
  createdAt: Date;
  answers: { commentId: number; content: string; createdAt: Date }[];
};

export async function getAdminQna(
  database: DatabaseClient,
  postId: number,
): Promise<AdminQnaDetail> {
  const [row] = await database
    .select({
      postId: post.id,
      title: post.title,
      content: post.content,
      categoryCode: post.categoryCode,
      categoryName: commonCode.name,
      memberName: customer.name,
      memberPhone: customer.phone,
      guestName: post.guestName,
      guestPhone: post.guestPhone,
      customerId: post.customerId,
      isSecret: post.isSecret,
      isAnswered: post.isAnswered,
      createdAt: post.createdAt,
    })
    .from(post)
    .leftJoin(customer, eq(post.customerId, customer.id))
    .leftJoin(
      commonCode,
      and(eq(commonCode.groupCode, "qna_type"), eq(commonCode.code, post.categoryCode)),
    )
    .where(eq(post.id, postId))
    .limit(1);
  if (!row) throw new AdminPostNotFoundError(postId);

  const answers = await database
    .select({
      commentId: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
    })
    .from(comment)
    .where(and(eq(comment.postId, postId), eq(comment.authorType, "admin")))
    .orderBy(asc(comment.id));

  const contactPhone = row.memberPhone ?? row.guestPhone;

  return {
    postId: row.postId,
    title: row.title,
    content: row.content,
    categoryCode: row.categoryCode,
    categoryName: row.categoryName,
    authorName: row.memberName ?? row.guestName ?? "비회원",
    contactPhone: contactPhone ? formatPhone(contactPhone) : null,
    isMember: row.customerId !== null,
    isSecret: row.isSecret,
    isAnswered: row.isAnswered,
    createdAt: row.createdAt,
    answers,
  };
}

/**
 * 답변 등록·수정 — **답변 존재와 is_answered를 한 트랜잭션에서 맞춘다.**
 * 둘이 어긋나면 목록의 '미답변' 뱃지와 상세의 답변이 서로 다른 말을 한다.
 */
export async function answerAdminQna(
  database: DatabaseClient,
  input: { postId: number; commentId: number | null; content: string },
): Promise<{ postId: number; commentId: number }> {
  return database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: post.id })
      .from(post)
      .where(eq(post.id, input.postId))
      .limit(1);
    if (!existing) throw new AdminPostNotFoundError(input.postId);

    let commentId: number;
    if (input.commentId === null) {
      const [inserted] = await tx
        .insert(comment)
        .values({ postId: input.postId, authorType: "admin", content: input.content })
        .returning({ id: comment.id });
      commentId = inserted.id;
    } else {
      const updated = await tx
        .update(comment)
        .set({ content: input.content })
        .where(and(eq(comment.id, input.commentId), eq(comment.postId, input.postId)))
        .returning({ id: comment.id });
      if (updated.length === 0) throw new AdminPostNotFoundError(input.postId);
      commentId = updated[0].id;
    }

    await tx.update(post).set({ isAnswered: true }).where(eq(post.id, input.postId));

    return { postId: input.postId, commentId };
  });
}

/** 답변 삭제 — 남은 답변이 없으면 미답변으로 되돌린다(뱃지와 내용이 어긋나지 않게) */
export async function deleteAdminQnaAnswer(
  database: DatabaseClient,
  input: { postId: number; commentId: number },
): Promise<{ postId: number; isAnswered: boolean }> {
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(comment)
      .where(and(eq(comment.id, input.commentId), eq(comment.postId, input.postId)))
      .returning({ id: comment.id });
    if (deleted.length === 0) throw new AdminPostNotFoundError(input.postId);

    const [remaining] = await tx
      .select({ total: count() })
      .from(comment)
      .where(and(eq(comment.postId, input.postId), eq(comment.authorType, "admin")));

    const isAnswered = (remaining?.total ?? 0) > 0;
    await tx.update(post).set({ isAnswered }).where(eq(post.id, input.postId));

    return { postId: input.postId, isAnswered };
  });
}

/** 글 삭제 — 공지·FAQ·문의 공통. 댓글은 cascade로 함께 사라진다 */
export async function deleteAdminPost(
  database: DatabaseClient,
  input: { postId: number },
): Promise<{ postId: number }> {
  const deleted = await database
    .delete(post)
    .where(eq(post.id, input.postId))
    .returning({ id: post.id });
  if (deleted.length === 0) throw new AdminPostNotFoundError(input.postId);
  return { postId: deleted[0].id };
}

// =============================================================
// 단체구매 문의 — 게시판이 아니라 별도 테이블(bulk_inquiry)이지만
// 운영자 입장에서는 "답해야 할 문의"라 같은 화면에 둔다
// =============================================================

export type AdminBulkInquiryStatus = "received" | "contacted" | "closed";

const BULK_STATUS_LABELS: Record<AdminBulkInquiryStatus, string> = {
  received: "접수",
  contacted: "연락함",
  closed: "종료",
};

export function bulkInquiryStatusLabel(status: AdminBulkInquiryStatus): string {
  return BULK_STATUS_LABELS[status];
}

export type AdminBulkInquiryCard = {
  inquiryId: number;
  purchaseTypeCode: string;
  purchaseTypeName: string | null;
  companyName: string | null;
  managerName: string;
  phone: string;
  email: string | null;
  quantity: number | null;
  budget: number | null;
  dueDate: Date | null;
  needTaxInvoice: boolean;
  content: string | null;
  inquiryStatus: AdminBulkInquiryStatus;
  inquiryStatusLabel: string;
  adminMemo: string | null;
  createdAt: Date;
};

export async function listAdminBulkInquiries(
  database: DatabaseClient,
  input: { inquiryStatus?: AdminBulkInquiryStatus | "all"; page?: number } = {},
): Promise<{
  cards: AdminBulkInquiryCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  statusCounts: Record<AdminBulkInquiryStatus | "all", number>;
}> {
  const statusFilterValue = input.inquiryStatus ?? "all";
  const page = Math.max(1, input.page ?? 1);
  const listFilter =
    statusFilterValue === "all" ? undefined : eq(bulkInquiry.status, statusFilterValue);

  const [totalRow] = await database.select({ total: count() }).from(bulkInquiry).where(listFilter);

  const rows = await database
    .select({
      inquiryId: bulkInquiry.id,
      purchaseTypeCode: bulkInquiry.purchaseTypeCode,
      purchaseTypeName: commonCode.name,
      companyName: bulkInquiry.companyName,
      managerName: bulkInquiry.managerName,
      phone: bulkInquiry.phone,
      email: bulkInquiry.email,
      quantity: bulkInquiry.quantity,
      budget: bulkInquiry.budget,
      dueDate: bulkInquiry.dueDate,
      needTaxInvoice: bulkInquiry.needTaxInvoice,
      content: bulkInquiry.content,
      inquiryStatus: bulkInquiry.status,
      adminMemo: bulkInquiry.adminMemo,
      createdAt: bulkInquiry.createdAt,
    })
    .from(bulkInquiry)
    .leftJoin(
      commonCode,
      and(
        eq(commonCode.groupCode, "bulk_type"),
        eq(commonCode.code, bulkInquiry.purchaseTypeCode),
      ),
    )
    .where(listFilter)
    // 접수 건이 위 — 대기열이라 오래된 미처리가 묻히면 안 된다
    .orderBy(asc(bulkInquiry.status), desc(bulkInquiry.id))
    .limit(ADMIN_BOARD_PAGE_SIZE)
    .offset((page - 1) * ADMIN_BOARD_PAGE_SIZE);

  const [statusCountRow] = await database
    .select({
      all: count(),
      received: sql<number>`count(*) filter (where ${bulkInquiry.status} = 'received')::int`,
      contacted: sql<number>`count(*) filter (where ${bulkInquiry.status} = 'contacted')::int`,
      closed: sql<number>`count(*) filter (where ${bulkInquiry.status} = 'closed')::int`,
    })
    .from(bulkInquiry);

  return {
    cards: rows.map((row) => ({
      ...row,
      // 담당자에게 전화하는 화면이라 하이픈을 붙인다
      phone: formatPhone(row.phone),
      inquiryStatusLabel: bulkInquiryStatusLabel(row.inquiryStatus),
    })),
    totalCount: totalRow?.total ?? 0,
    page,
    pageSize: ADMIN_BOARD_PAGE_SIZE,
    statusCounts: {
      all: statusCountRow?.all ?? 0,
      received: Number(statusCountRow?.received ?? 0),
      contacted: Number(statusCountRow?.contacted ?? 0),
      closed: Number(statusCountRow?.closed ?? 0),
    },
  };
}

export class AdminBulkInquiryNotFoundError extends Error {
  constructor(readonly inquiryId: number) {
    super(`단체구매 문의를 찾을 수 없습니다: id=${inquiryId}`);
    this.name = "AdminBulkInquiryNotFoundError";
  }
}

/** 진행 상태·메모 — 전화로 상담하는 업무라 상태는 세 칸이면 충분하다 */
export async function updateAdminBulkInquiry(
  database: DatabaseClient,
  input: {
    inquiryId: number;
    inquiryStatus: AdminBulkInquiryStatus;
    adminMemo: string | null;
  },
): Promise<{ inquiryId: number }> {
  const memo = input.adminMemo?.trim();
  const updated = await database
    .update(bulkInquiry)
    .set({ status: input.inquiryStatus, adminMemo: memo && memo.length > 0 ? memo : null })
    .where(eq(bulkInquiry.id, input.inquiryId))
    .returning({ id: bulkInquiry.id });
  if (updated.length === 0) throw new AdminBulkInquiryNotFoundError(input.inquiryId);
  return { inquiryId: updated[0].id };
}

/** 미답변 문의 수 — 사이드바 뱃지가 읽는다 */
export async function countWaitingQnas(database: DatabaseClient): Promise<number> {
  const [row] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(post)
    .innerJoin(board, eq(post.boardId, board.id))
    .where(and(eq(board.type, "qna"), eq(post.isAnswered, false)));
  return Number(row?.total ?? 0);
}
