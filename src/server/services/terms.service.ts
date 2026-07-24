import "server-only";

import { desc, eq } from "drizzle-orm";

import type { db as Database } from "@/db";
import { termsDocument } from "@/db/schema";

/**
 * 약관 문서 도메인 서비스 — 약관문서 화면(이용약관·개인정보·배송정책)과 푸터 링크가 쓴다.
 * terms_document는 (code, version) 누적 구조라 "코드별 최신 버전"을 고르는 규칙을
 * 여기 한 곳에 둔다 — 가입 동의(customer.service)와 같은 기준(effectiveAt → id 최신).
 */

type DatabaseClient = typeof Database;

export type TermsDocumentSummary = {
  termsDocumentId: number;
  termsCode: string;
  title: string;
  version: string;
  isRequired: boolean;
  effectiveAt: Date;
};

export type TermsDocumentDetail = TermsDocumentSummary & {
  content: string;
};

/**
 * 코드별 최신 버전 목록 — 화면 탭·목차용이라 본문(content)은 내리지 않는다.
 * 정렬은 문서 id 오름차순 — 시드 등록순이 화면 탭 순서(이용약관→개인정보→…)와 일치한다.
 */
export async function getTermsDocuments(
  database: DatabaseClient,
): Promise<TermsDocumentSummary[]> {
  const documentRows = await database
    .select({
      termsDocumentId: termsDocument.id,
      termsCode: termsDocument.code,
      title: termsDocument.title,
      version: termsDocument.version,
      isRequired: termsDocument.isRequired,
      effectiveAt: termsDocument.effectiveAt,
    })
    .from(termsDocument)
    .orderBy(desc(termsDocument.effectiveAt), desc(termsDocument.id));

  // 최신 우선으로 정렬해 두었으므로 코드별 첫 행이 곧 최신 버전이다
  const latestByCode = new Map<string, TermsDocumentSummary>();
  for (const documentRow of documentRows) {
    if (!latestByCode.has(documentRow.termsCode)) {
      latestByCode.set(documentRow.termsCode, documentRow);
    }
  }

  return [...latestByCode.values()].sort(
    (a, b) => a.termsDocumentId - b.termsDocumentId,
  );
}

/** 특정 코드의 최신 버전 본문 — 없는 코드는 null(화면이 404/빈 상태를 그린다) */
export async function getTermsDocument(
  database: DatabaseClient,
  termsCode: string,
): Promise<TermsDocumentDetail | null> {
  const [documentRow] = await database
    .select({
      termsDocumentId: termsDocument.id,
      termsCode: termsDocument.code,
      title: termsDocument.title,
      version: termsDocument.version,
      isRequired: termsDocument.isRequired,
      effectiveAt: termsDocument.effectiveAt,
      content: termsDocument.content,
    })
    .from(termsDocument)
    .where(eq(termsDocument.code, termsCode))
    .orderBy(desc(termsDocument.effectiveAt), desc(termsDocument.id))
    .limit(1);

  return documentRow ?? null;
}
