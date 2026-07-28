/**
 * 관리자 카테고리 관리 검증 — 2단계 트리 규칙을 실제 DB에서 확인한다.
 * 실행: npm run check:admin-category   (SSH 터널 켠 상태)
 *
 * 핵심 검증은 **깊이 2 강제**다. 3단계를 만들 수 있으면 손자 카테고리의 상품이
 * 조부모 목록에서 사라진다(스토어 필터가 직계 자식까지만 펼친다) — 관리자는 등록했는데
 * 스토어에는 안 보이는, 가장 찾기 어려운 종류의 버그다.
 *
 * 시드 카테고리의 순서를 건드리지 않도록, 순서 이동은 **검증용 대분류의 자식들 사이에서만**
 * 시험한다(형제 renumbering이 같은 부모의 다른 행에 닿기 때문이다).
 *
 * 시나리오: [1]트리 조회 [2]추가(대·중) [3]3단계 차단 [4]slug 중복 차단
 *           [5]순서 이동 [6]하위 있는 카테고리 삭제 차단 [7]삭제·상품 미분류 [8]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { adminUser, category, product, productCategory } from "@/db/schema";
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

const SUFFIX = randomUUID().slice(0, 6);

async function main() {
  console.log("PaRaSOL 관리자 카테고리 검증 (임시 카테고리는 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const createdCategoryIds: number[] = [];

  try {
    const caller = await adminCaller(admin.id);

    console.log("\n[1] 트리 조회 — 2단계 구조 기대");
    const initialTree = await caller.adminCategory.tree();
    check(initialTree.length > 0, `대분류 ${initialTree.length}개`);
    check(
      initialTree.every((node) => node.children.every((child) => !("children" in child) || child.children.length === 0)),
      "중분류 아래에는 자식이 없다 — 트리가 2단계다",
    );
    check(
      initialTree.some((node) => node.productCount >= 0 && typeof node.slug === "string"),
      "노드가 slug·상품 수를 함께 준다",
    );

    console.log("\n[2] 추가 — 대분류와 하위 카테고리 기대");
    const parentCreated = await caller.adminCategory.create({
      parentId: null,
      name: `검증 대분류 ${SUFFIX}`,
      slug: `check-parent-${SUFFIX}`,
    });
    createdCategoryIds.push(parentCreated.categoryId);

    const childIds: number[] = [];
    for (const childIndex of [1, 2, 3]) {
      const childCreated = await caller.adminCategory.create({
        parentId: parentCreated.categoryId,
        name: `검증 중분류 ${childIndex}`,
        slug: `check-child-${SUFFIX}-${childIndex}`,
      });
      childIds.push(childCreated.categoryId);
      createdCategoryIds.push(childCreated.categoryId);
    }

    const treeAfterCreate = await caller.adminCategory.tree();
    const testParent = treeAfterCreate.find((node) => node.categoryId === parentCreated.categoryId);
    check(testParent !== undefined, "새 대분류가 트리에 보인다");
    check(testParent?.children.length === 3, `하위 3개 (${testParent?.children.length})`);
    check(
      treeAfterCreate[treeAfterCreate.length - 1]?.categoryId === parentCreated.categoryId,
      "새 대분류는 맨 뒤에 붙는다 — 중간에 끼면 어디 생겼는지 못 찾는다",
    );

    console.log("\n[3] 3단계 차단 — 중분류 아래에는 만들 수 없다 기대");
    let depthBlocked = false;
    try {
      await caller.adminCategory.create({
        parentId: childIds[0],
        name: "손자 카테고리",
        slug: `check-grandchild-${SUFFIX}`,
      });
    } catch (error) {
      depthBlocked = error instanceof Error && /2단계/.test(error.message);
    }
    check(depthBlocked, "3단계 생성 차단 — 스토어 목록에서 상품이 사라지는 것을 구조로 막는다");

    console.log("\n[4] slug 중복 — 차단 기대");
    let slugBlocked = false;
    try {
      await caller.adminCategory.create({
        parentId: null,
        name: "중복 시도",
        slug: `check-parent-${SUFFIX}`,
      });
    } catch (error) {
      slugBlocked = error instanceof Error && /이미 사용 중인 URL/.test(error.message);
    }
    check(slugBlocked, "같은 URL 주소로 만들 수 없다");

    // 수정에서 자기 slug를 그대로 두는 것은 중복이 아니다
    await caller.adminCategory.update({
      categoryId: parentCreated.categoryId,
      name: `검증 대분류 ${SUFFIX} 수정`,
      slug: `check-parent-${SUFFIX}`,
      isActive: false,
    });
    const treeAfterUpdate = await caller.adminCategory.tree();
    const updatedParent = treeAfterUpdate.find(
      (node) => node.categoryId === parentCreated.categoryId,
    );
    check(
      updatedParent?.name.endsWith("수정") === true && updatedParent.isActive === false,
      "이름·노출 수정 반영 (자기 slug 유지는 중복이 아니다)",
      { name: updatedParent?.name, isActive: updatedParent?.isActive },
    );

    console.log("\n[5] 순서 이동 — 형제 안에서만 기대");
    const beforeMove = updatedParent?.children.map((child) => child.categoryId) ?? [];
    await caller.adminCategory.move({ categoryId: childIds[2], direction: "up" });
    const treeAfterMove = await caller.adminCategory.tree();
    const afterMove =
      treeAfterMove
        .find((node) => node.categoryId === parentCreated.categoryId)
        ?.children.map((child) => child.categoryId) ?? [];
    check(
      afterMove[1] === childIds[2] && afterMove[2] === childIds[1],
      "세 번째 항목이 두 번째로 올라온다",
      { before: beforeMove, after: afterMove },
    );

    const noMove = await caller.adminCategory.move({
      categoryId: afterMove[0],
      direction: "up",
    });
    check(!noMove.moved, "첫 항목을 더 위로 올릴 수 없다 — 조용히 아무 일도 하지 않는다");

    console.log("\n[6] 하위가 있는 카테고리 삭제 — 차단 기대");
    const preview = await caller.adminCategory.deletePreview({
      categoryId: parentCreated.categoryId,
    });
    check(preview.childCount === 3, `삭제 미리보기가 하위 3개를 알려준다 (${preview.childCount})`);

    let childBlocked = false;
    try {
      await caller.adminCategory.remove({ categoryId: parentCreated.categoryId });
    } catch (error) {
      childBlocked = error instanceof Error && /하위 카테고리가 있어/.test(error.message);
    }
    check(childBlocked, "하위가 있으면 삭제 차단 — 자식이 고아가 되지 않는다");

    console.log("\n[7] 삭제 — 상품은 남고 연결만 끊긴다 기대");
    const [sampleProduct] = await db
      .select({ id: product.id })
      .from(product)
      .where(isNull(product.deletedAt))
      .orderBy(product.id)
      .limit(1);
    if (!sampleProduct) throw new Error("상품 없음 — npm run db:seed:dev 먼저 실행");

    await db
      .insert(productCategory)
      .values({ productId: sampleProduct.id, categoryId: childIds[0] });

    const childPreview = await caller.adminCategory.deletePreview({ categoryId: childIds[0] });
    check(
      childPreview.productCount === 1,
      `삭제 미리보기가 연결 상품 1개를 알려준다 (${childPreview.productCount})`,
    );

    const removed = await caller.adminCategory.remove({ categoryId: childIds[0] });
    check(removed.detachedProductCount === 1, `연결 해제 1건 보고 (${removed.detachedProductCount})`);

    const [survivingProduct] = await db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.id, sampleProduct.id));
    check(survivingProduct !== undefined, "상품은 지워지지 않는다 — 미분류가 될 뿐이다");

    const remainingLinks = await db
      .select({ categoryId: productCategory.categoryId })
      .from(productCategory)
      .where(
        and(
          eq(productCategory.productId, sampleProduct.id),
          eq(productCategory.categoryId, childIds[0]),
        ),
      );
    check(remainingLinks.length === 0, "연결은 사라진다");

    console.log("\n[8] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let treeForbidden = false;
    let createForbidden = false;
    try {
      await anonymous.adminCategory.tree();
    } catch (error) {
      treeForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminCategory.create({ parentId: null, name: "몰래", slug: "sneaky-cat" });
    } catch (error) {
      createForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(treeForbidden, "관리자 세션 없이는 트리 조회 불가");
    check(createForbidden, "관리자 세션 없이는 카테고리 생성 불가");
  } finally {
    if (createdCategoryIds.length > 0) {
      // 자식 → 부모 순으로 지운다(자식이 남으면 부모 삭제가 막힌다)
      await db.delete(productCategory).where(inArray(productCategory.categoryId, createdCategoryIds));
      await db.delete(category).where(inArray(category.parentId, createdCategoryIds));
      await db.delete(category).where(inArray(category.id, createdCategoryIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
