import "server-only";

import { eq } from "drizzle-orm";

import { bulkInquiry, commonCode } from "@/db/schema";
import { normalizePhone } from "@/domain/phone";

import type { DatabaseClient } from "./db-client";

/**
 * 단체구매 문의 접수 — 핸드오프 'PaRaSOL 단체구매문의.dc.html'.
 *
 * 1:1 문의(post)와 테이블을 나눈 이유: 다루는 값이 다르다. 회사명·사업자번호·수량·예산·
 * 납기일·세금계산서 여부는 게시판 글에 담을 수 없고, 처리 흐름도 다르다
 * (문의는 답변을 달지만 단체구매는 담당자가 연락해 견적을 낸다).
 *
 * 로그인 없이 접수한다 — 기업 담당자가 회원가입부터 하게 만들면 대부분 이탈한다.
 */

export type BulkPurchaseTypeOption = { code: string; name: string; summary: string | null };

/** 구매 유형 — 코드는 common_code(bulk_type)가 원천이다(화면 하드코딩 금지) */
export async function getBulkPurchaseTypes(
  database: DatabaseClient,
): Promise<BulkPurchaseTypeOption[]> {
  const rows = await database
    .select({ code: commonCode.code, name: commonCode.name, meta: commonCode.meta })
    .from(commonCode)
    .where(eq(commonCode.groupCode, "bulk_type"))
    .orderBy(commonCode.sortOrder);

  return rows
    .filter((row) => row.code.length > 0)
    .map((row) => ({
      code: row.code,
      name: row.name,
      summary:
        row.meta && typeof row.meta === "object" && "summary" in row.meta
          ? String((row.meta as { summary: unknown }).summary)
          : null,
    }));
}

export class UnknownBulkPurchaseTypeError extends Error {
  constructor() {
    super("구매 유형을 다시 선택해 주세요.");
    this.name = "UnknownBulkPurchaseTypeError";
  }
}

export type CreateBulkInquiryInput = {
  purchaseTypeCode: string;
  companyName: string;
  businessNo: string | null;
  managerName: string;
  phone: string;
  email: string | null;
  /** 희망 상품 — 별도 컬럼이 없어 요청사항 맨 앞에 붙인다 */
  wantedProduct: string | null;
  quantity: number | null;
  budget: number | null;
  dueDate: Date | null;
  needTaxInvoice: boolean;
  content: string | null;
};

/**
 * 접수. 화면 선택을 우회한 임의 코드가 컬럼에 남지 않게 실존 코드만 통과시킨다
 * (1:1 문의의 qna_type 검증과 같은 규약).
 */
export async function createBulkInquiry(
  database: DatabaseClient,
  input: CreateBulkInquiryInput,
): Promise<{ bulkInquiryId: number }> {
  const [typeRow] = await database
    .select({ id: commonCode.id })
    .from(commonCode)
    .where(eq(commonCode.code, input.purchaseTypeCode))
    .limit(1);
  if (!typeRow) throw new UnknownBulkPurchaseTypeError();

  // 희망 상품은 담당자가 견적을 낼 때 가장 먼저 보는 값이라 요청사항 맨 앞에 둔다
  const mergedContent = [
    input.wantedProduct ? `[희망 상품] ${input.wantedProduct}` : null,
    input.content,
  ]
    .filter(Boolean)
    .join("\n\n");

  const [created] = await database
    .insert(bulkInquiry)
    .values({
      purchaseTypeCode: input.purchaseTypeCode,
      companyName: input.companyName,
      businessNo: input.businessNo,
      managerName: input.managerName,
      // 정규화(숫자만) 저장 — 관리자 화면이 이 값으로 대조·표시한다(주문과 같은 규약)
      phone: normalizePhone(input.phone),
      email: input.email,
      quantity: input.quantity,
      budget: input.budget,
      dueDate: input.dueDate,
      needTaxInvoice: input.needTaxInvoice,
      content: mergedContent || null,
    })
    .returning({ id: bulkInquiry.id });

  return { bulkInquiryId: created.id };
}
