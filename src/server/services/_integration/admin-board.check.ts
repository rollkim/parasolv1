/**
 * 관리자 게시판 관리 검증 — 공지·FAQ·1:1 문의·단체구매를 실제 DB에서 확인한다.
 * 실행: npm run check:admin-board   (SSH 터널 켠 상태)
 *
 * 핵심 검증은 **답변 상태 정합**이다. post.is_answered와 실제 답변(comment)이 어긋나면
 * 목록의 '미답변' 뱃지와 상세의 답변이 서로 다른 말을 하고, 운영자가 답변을 두 번 단다.
 *
 * 시나리오: [1]공지 CRUD·고정 정렬 [2]FAQ CRUD [3]문의 답변(등록·수정·삭제 시 상태 동기)
 *           [4]미답변 우선 정렬·탭 [5]단체구매 상태·메모 [6]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adminUser, board, bulkInquiry, comment, post } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

let passCount = 0;
let failCount = 0;

function check(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    passCount += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failCount += 1;
    console.log(`  ✗ ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function adminCaller(adminUserId: number) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(adminUserId))
    .setAudience("admin")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const headers = new Headers({ cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}` });
  return createCaller(await createTRPCContext({ headers }));
}

const SUFFIX = randomUUID().slice(0, 8);

async function main() {
  console.log("PaRaSOL 관리자 게시판 검증 (임시 글은 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const [qnaBoard] = await db
    .select({ id: board.id })
    .from(board)
    .where(eq(board.slug, "qna"))
    .limit(1);
  if (!qnaBoard) throw new Error("qna 게시판 없음 — npm run db:seed 먼저 실행");

  const createdPostIds: number[] = [];
  const createdInquiryIds: number[] = [];

  try {
    const caller = await adminCaller(admin.id);

    console.log("\n[1] 공지 — 작성·수정·고정 정렬 기대");
    const plainNotice = await caller.adminBoard.saveNotice({
      postId: null,
      title: `일반 공지 ${SUFFIX}`,
      content: "본문",
      isPinned: false,
    });
    createdPostIds.push(plainNotice.postId);

    const pinnedNotice = await caller.adminBoard.saveNotice({
      postId: null,
      title: `고정 공지 ${SUFFIX}`,
      content: "본문",
      isPinned: true,
    });
    createdPostIds.push(pinnedNotice.postId);

    const noticeList = await caller.adminBoard.listNotices({ keyword: SUFFIX });
    check(noticeList.totalCount === 2, `검색으로 2건 (${noticeList.totalCount})`);
    check(
      noticeList.cards[0]?.postId === pinnedNotice.postId,
      "고정 공지가 위 — 스토어 목록과 같은 순서라야 실제 노출 순서를 본다",
      noticeList.cards.map((card) => ({ id: card.postId, pinned: card.isPinned })),
    );

    await caller.adminBoard.saveNotice({
      postId: plainNotice.postId,
      title: `일반 공지 ${SUFFIX} 수정`,
      content: "수정된 본문",
      isPinned: true,
    });
    const editedNotice = await caller.adminBoard.getNotice({ postId: plainNotice.postId });
    check(
      editedNotice.title.endsWith("수정") && editedNotice.isPinned && editedNotice.content === "수정된 본문",
      "수정 반영(제목·본문·고정)",
      { title: editedNotice.title, pinned: editedNotice.isPinned },
    );

    console.log("\n[2] FAQ — 질문이 제목, 답변이 본문 기대");
    const faq = await caller.adminBoard.saveFaq({
      postId: null,
      categoryCode: null,
      question: `배송은 얼마나 걸리나요 ${SUFFIX}`,
      answer: "영업일 기준 2~3일 걸립니다.",
    });
    createdPostIds.push(faq.postId);

    const faqList = await caller.adminBoard.listFaqs({});
    const savedFaq = faqList.cards.find((card) => card.postId === faq.postId);
    check(
      savedFaq?.question.includes(SUFFIX) === true &&
        savedFaq.answer === "영업일 기준 2~3일 걸립니다.",
      "질문·답변이 각각 제목·본문으로 저장된다",
      savedFaq,
    );

    await caller.adminBoard.saveFaq({
      postId: faq.postId,
      categoryCode: null,
      question: `배송은 얼마나 걸리나요 ${SUFFIX}`,
      answer: "영업일 기준 1~2일 걸립니다.",
    });
    const faqAfterEdit = await caller.adminBoard.listFaqs({});
    check(
      faqAfterEdit.cards.find((card) => card.postId === faq.postId)?.answer ===
        "영업일 기준 1~2일 걸립니다.",
      "FAQ 답변 수정 반영",
    );

    console.log("\n[3] 1:1 문의 답변 — 상태가 함께 맞춰진다 기대");
    // 고객이 쓴 문의를 직접 만든다(고객 경로는 board.service가 담당)
    const [customerQna] = await db
      .insert(post)
      .values({
        boardId: qnaBoard.id,
        authorType: "guest",
        guestName: `검증문의자${SUFFIX}`,
        guestPhone: "01077778888",
        title: `배송 언제 오나요 ${SUFFIX}`,
        content: "주문한 지 3일 됐습니다.",
        isSecret: true,
      })
      .returning({ id: post.id });
    createdPostIds.push(customerQna.id);

    const beforeAnswer = await caller.adminBoard.getQna({ postId: customerQna.id });
    check(!beforeAnswer.isAnswered && beforeAnswer.answers.length === 0, "처음에는 미답변");
    check(
      beforeAnswer.contactPhone === "010-7777-8888",
      "비회원 연락처가 하이픈 표기로 온다 — 회신 수단이 그것뿐이다",
      beforeAnswer.contactPhone,
    );
    check(beforeAnswer.isSecret && !beforeAnswer.isMember, "비밀글·비회원 표시");

    const answered = await caller.adminBoard.answerQna({
      postId: customerQna.id,
      commentId: null,
      content: "오늘 발송 예정입니다.",
    });
    const afterAnswer = await caller.adminBoard.getQna({ postId: customerQna.id });
    check(
      afterAnswer.isAnswered && afterAnswer.answers.length === 1,
      "답변 등록 시 상태가 함께 '답변 완료'가 된다",
    );

    await caller.adminBoard.answerQna({
      postId: customerQna.id,
      commentId: answered.commentId,
      content: "내일 발송 예정입니다.",
    });
    const afterEdit = await caller.adminBoard.getQna({ postId: customerQna.id });
    check(
      afterEdit.answers.length === 1 && afterEdit.answers[0].content === "내일 발송 예정입니다.",
      "답변 수정은 새 답변을 만들지 않는다",
      afterEdit.answers,
    );

    const afterDelete = await caller.adminBoard.deleteQnaAnswer({
      postId: customerQna.id,
      commentId: answered.commentId,
    });
    check(
      !afterDelete.isAnswered,
      "답변을 지우면 미답변으로 되돌아간다 — 뱃지와 내용이 어긋나면 답변을 두 번 단다",
    );
    const [rawPost] = await db
      .select({ isAnswered: post.isAnswered })
      .from(post)
      .where(eq(post.id, customerQna.id));
    check(rawPost.isAnswered === false, "DB의 is_answered도 함께 내려간다", rawPost);

    console.log("\n[4] 문의 목록 — 미답변 우선·탭 기대");
    const [answeredQna] = await db
      .insert(post)
      .values({
        boardId: qnaBoard.id,
        authorType: "guest",
        guestName: `이미답변${SUFFIX}`,
        title: `교환 문의 ${SUFFIX}`,
        content: "교환 가능한가요",
        isAnswered: true,
      })
      .returning({ id: post.id });
    createdPostIds.push(answeredQna.id);
    await db
      .insert(comment)
      .values({ postId: answeredQna.id, authorType: "admin", content: "가능합니다." });

    const qnaList = await caller.adminBoard.listQnas({ keyword: SUFFIX });
    check(qnaList.totalCount === 2, `검색으로 2건 (${qnaList.totalCount})`);
    check(
      qnaList.cards[0]?.postId === customerQna.id,
      "미답변이 위 — 대기열이라 오래된 미답변이 묻히면 안 된다",
      qnaList.cards.map((card) => ({ id: card.postId, answered: card.isAnswered })),
    );

    const waitingOnly = await caller.adminBoard.listQnas({ tab: "waiting", keyword: SUFFIX });
    check(
      waitingOnly.cards.every((card) => !card.isAnswered) &&
        waitingOnly.cards.some((card) => card.postId === customerQna.id),
      "미답변 탭이 미답변만 남긴다",
    );

    const waitingCount = await caller.adminBoard.waitingQnaCount();
    check(waitingCount >= 1, `미답변 뱃지 수 ${waitingCount}`);

    console.log("\n[5] 단체구매 문의 — 상태·메모 기대");
    const [inquiry] = await db
      .insert(bulkInquiry)
      .values({
        purchaseTypeCode: "corporate",
        companyName: `검증상사${SUFFIX}`,
        managerName: "김담당",
        phone: "01055556666",
        quantity: 300,
        needTaxInvoice: true,
        content: "명절 선물세트 견적 부탁드립니다.",
      })
      .returning({ id: bulkInquiry.id });
    createdInquiryIds.push(inquiry.id);

    const bulkList = await caller.adminBoard.listBulkInquiries({});
    const bulkCard = bulkList.cards.find((card) => card.inquiryId === inquiry.id);
    check(bulkCard !== undefined, "단체구매 문의가 목록에 보인다");
    check(bulkCard?.phone === "010-5555-6666", "담당자 연락처 하이픈 표기", bulkCard?.phone);
    check(bulkCard?.inquiryStatusLabel === "접수", "초기 상태 접수", bulkCard?.inquiryStatusLabel);
    check(bulkCard?.needTaxInvoice === true, "세금계산서 필요 표시");

    await caller.adminBoard.updateBulkInquiry({
      inquiryId: inquiry.id,
      inquiryStatus: "contacted",
      adminMemo: "07/29 통화 완료, 견적 발송",
    });
    const contactedList = await caller.adminBoard.listBulkInquiries({
      inquiryStatus: "contacted",
    });
    const contactedCard = contactedList.cards.find((card) => card.inquiryId === inquiry.id);
    check(
      contactedCard?.inquiryStatus === "contacted" &&
        contactedCard.adminMemo === "07/29 통화 완료, 견적 발송",
      "상태·메모가 함께 저장되고 필터에 잡힌다",
      { status: contactedCard?.inquiryStatus, memo: contactedCard?.adminMemo },
    );

    console.log("\n[6] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let listForbidden = false;
    let answerForbidden = false;
    try {
      await anonymous.adminBoard.listNotices({});
    } catch (error) {
      listForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminBoard.answerQna({
        postId: customerQna.id,
        commentId: null,
        content: "몰래 답변",
      });
    } catch (error) {
      answerForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(listForbidden, "관리자 세션 없이는 공지 목록 조회 불가");
    check(answerForbidden, "관리자 세션 없이는 문의 답변 불가");
  } finally {
    if (createdPostIds.length > 0) {
      await db.delete(post).where(inArray(post.id, createdPostIds));
    }
    if (createdInquiryIds.length > 0) {
      await db.delete(bulkInquiry).where(inArray(bulkInquiry.id, createdInquiryIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
