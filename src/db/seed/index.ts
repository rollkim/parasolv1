/**
 * 시드 실행기 — `npm run db:seed`
 *
 * 여러 번 실행해도 안전하다(멱등): 이미 있는 행은 건너뛰고 새 행만 넣는다.
 * 기존 값을 덮어쓰지 않으므로, 운영자가 관리자 화면에서 고친 내용이 시드로 되돌아가지 않는다.
 *
 * 데이터는 seed-data.ts가 소유한다 — 재판매 시 그 파일만 교체한다.
 */

import "dotenv/config";

import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  adminUser,
  board,
  category,
  commonCode,
  customerGrade,
  displaySection,
  siteSetting,
  termsDocument,
} from "@/db/schema";

import {
  BOARDS,
  CATEGORIES,
  COMMON_CODES,
  CUSTOMER_GRADES,
  DISPLAY_SECTIONS,
  SITE_SETTINGS,
  TERMS_DOCUMENTS,
} from "./seed-data";

/** 시드가 만든 행의 감사 컬럼 주체 — "admin:{id}"/"customer:{id}"와 구분되는 규약값 */
const SEED_ACTOR = "system";

const BCRYPT_ROUNDS = 12;

function logStep(stepName: string, insertedCount: number, skippedCount: number) {
  console.log(
    `  ${stepName.padEnd(18)} 추가 ${String(insertedCount).padStart(3)}건` +
      (skippedCount > 0 ? ` · 기존 유지 ${skippedCount}건` : ""),
  );
}

async function seedCommonCodes() {
  const inserted = await db
    .insert(commonCode)
    .values(
      COMMON_CODES.map((row, index) => ({
        groupCode: row.groupCode,
        code: row.code,
        name: row.name,
        meta: row.meta ?? null,
        sortOrder: index,
        createdBy: SEED_ACTOR,
      })),
    )
    .onConflictDoNothing({ target: [commonCode.groupCode, commonCode.code] })
    .returning({ id: commonCode.id });

  logStep("공통코드", inserted.length, COMMON_CODES.length - inserted.length);
}

async function seedBoards() {
  const inserted = await db
    .insert(board)
    .values(
      BOARDS.map((row) => ({
        slug: row.slug,
        name: row.name,
        type: row.boardKind,
        createdBy: SEED_ACTOR,
      })),
    )
    .onConflictDoNothing({ target: board.slug })
    .returning({ id: board.id });

  logStep("게시판", inserted.length, BOARDS.length - inserted.length);
}

/**
 * 카테고리는 부모를 먼저 넣고 그 id로 자식을 넣는다.
 * 이미 있는 부모는 slug로 다시 조회해야 자식이 붙을 곳을 찾는다.
 */
async function seedCategories() {
  let insertedCount = 0;
  let rootSortOrder = 0;

  for (const rootSeed of CATEGORIES) {
    rootSortOrder += 1;

    const [insertedRoot] = await db
      .insert(category)
      .values({
        parentId: null,
        name: rootSeed.name,
        slug: rootSeed.slug,
        sortOrder: rootSortOrder,
        isActive: rootSeed.isActive ?? true,
        createdBy: SEED_ACTOR,
      })
      .onConflictDoNothing({ target: category.slug })
      .returning({ id: category.id });

    if (insertedRoot) insertedCount += 1;

    const rootId =
      insertedRoot?.id ??
      (
        await db
          .select({ id: category.id })
          .from(category)
          .where(eq(category.slug, rootSeed.slug))
          .limit(1)
      )[0]?.id;

    if (!rootId || !rootSeed.children?.length) continue;

    const insertedChildren = await db
      .insert(category)
      .values(
        rootSeed.children.map((childSeed, childIndex) => ({
          parentId: rootId,
          name: childSeed.name,
          slug: childSeed.slug,
          sortOrder: childIndex + 1,
          isActive: childSeed.isActive ?? true,
          createdBy: SEED_ACTOR,
        })),
      )
      .onConflictDoNothing({ target: category.slug })
      .returning({ id: category.id });

    insertedCount += insertedChildren.length;
  }

  const totalSeedCount = CATEGORIES.reduce(
    (sum, root) => sum + 1 + (root.children?.length ?? 0),
    0,
  );
  logStep("카테고리", insertedCount, totalSeedCount - insertedCount);
}

async function seedCustomerGrades() {
  const inserted = await db
    .insert(customerGrade)
    .values(
      CUSTOMER_GRADES.map((row) => ({
        code: row.code,
        name: row.name,
        bonusRate: row.bonusRate,
        sortOrder: row.sortOrder,
        createdBy: SEED_ACTOR,
      })),
    )
    .onConflictDoNothing({ target: customerGrade.code })
    .returning({ id: customerGrade.id });

  logStep("회원등급", inserted.length, CUSTOMER_GRADES.length - inserted.length);
}

async function seedTermsDocuments() {
  const effectiveAt = new Date();

  const inserted = await db
    .insert(termsDocument)
    .values(
      TERMS_DOCUMENTS.map((row) => ({
        code: row.code,
        title: row.title,
        version: row.version,
        content: row.content,
        isRequired: row.isRequired,
        effectiveAt,
        createdBy: SEED_ACTOR,
      })),
    )
    .onConflictDoNothing({ target: [termsDocument.code, termsDocument.version] })
    .returning({ id: termsDocument.id });

  logStep("약관문서", inserted.length, TERMS_DOCUMENTS.length - inserted.length);
}

async function seedSiteSettings() {
  const inserted = await db
    .insert(siteSetting)
    .values(
      SITE_SETTINGS.map((row) => ({
        key: row.key,
        value: row.value,
        createdBy: SEED_ACTOR,
      })),
    )
    .onConflictDoNothing({ target: siteSetting.key })
    .returning({ key: siteSetting.key });

  logStep("사이트설정", inserted.length, SITE_SETTINGS.length - inserted.length);
}

/** display_section에는 유니크 키가 없어 "비어 있을 때만" 넣는다 */
async function seedDisplaySections() {
  const [{ existingCount }] = await db
    .select({ existingCount: count() })
    .from(displaySection);

  if (existingCount > 0) {
    logStep("진열섹션", 0, existingCount);
    return;
  }

  const inserted = await db
    .insert(displaySection)
    .values(
      DISPLAY_SECTIONS.map((row) => ({
        kicker: row.kicker,
        title: row.title,
        kind: row.sectionKind,
        sortOrder: row.sortOrder,
        isActive: row.isActive,
        createdBy: SEED_ACTOR,
      })),
    )
    .returning({ id: displaySection.id });

  logStep("진열섹션", inserted.length, 0);
}

/**
 * 관리자 계정 — 비밀번호는 반드시 환경변수로 받는다.
 * 시드 파일에 평문을 두면 저장소에 그대로 남는다.
 */
async function seedAdminUser() {
  const seedLoginId = process.env.SEED_ADMIN_LOGIN_ID ?? "admin";
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!seedPassword) {
    console.log(
      "  관리자계정         건너뜀 — .env에 SEED_ADMIN_PASSWORD가 없습니다",
    );
    return;
  }

  const passwordHash = await bcrypt.hash(seedPassword, BCRYPT_ROUNDS);

  const inserted = await db
    .insert(adminUser)
    .values({
      loginId: seedLoginId,
      passwordHash,
      name: process.env.SEED_ADMIN_NAME ?? "최고관리자",
      role: "owner",
      createdBy: SEED_ACTOR,
    })
    .onConflictDoNothing({ target: adminUser.loginId })
    .returning({ id: adminUser.id });

  if (inserted.length > 0) {
    console.log(`  관리자계정         생성 — 로그인 ID: ${seedLoginId}`);
  } else {
    console.log(`  관리자계정         기존 유지 — ${seedLoginId} (비밀번호 변경 안 함)`);
  }
}

async function runSeed() {
  console.log("\nPaRaSOL 시드 실행\n");

  await seedCommonCodes();
  await seedBoards();
  await seedCategories();
  await seedCustomerGrades();
  await seedTermsDocuments();
  await seedSiteSettings();
  await seedDisplaySections();
  await seedAdminUser();

  console.log("\n완료.\n");
}

runSeed()
  .then(() => process.exit(0))
  .catch((seedError) => {
    console.error("\n시드 실패:", seedError);
    process.exit(1);
  });
