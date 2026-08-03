/**
 * 관리자 기획전 관리 검증 (E2).
 * 실행: npm run check:admin-promotion   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **상품 구성이 화면이 보낸 전체로 정확히 교체되고, 잘못된 입력은 서비스가 거른다.**
 *
 * 시나리오: [0]★coupon_id 컬럼 [1]등록·조회 [2]구성 교체(순서 포함) [3]잘못된 입력 거절
 *           [4]slug 중복 [5]중지(삭제 아님) — 스토어에서 사라지고 관리자에는 남는다
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { product, promotion } from "@/db/schema";

import {
  AdminPromotionInvalidError,
  createAdminPromotion,
  deactivateAdminPromotion,
  getAdminPromotion,
  listAdminPromotions,
  updateAdminPromotion,
  type AdminPromotionInput,
} from "../admin-promotion.service";
import {
  getStorePromotionDetail,
  listStorePromotions,
} from "../promotion.service";
import type { TransitionActor } from "../order-status.service";

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

const SUFFIX = randomUUID().slice(0, 8);
const ADMIN: TransitionActor = { role: "admin", id: 1 };

async function expectRejected(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (caught) {
    return caught instanceof AdminPromotionInvalidError;
  }
}

async function main() {
  console.log("PaRaSOL 관리자 기획전 검증 (임시 데이터는 종료 시 삭제)");

  const productRows = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.status, "active"))
    .orderBy(product.id)
    .limit(3);
  if (productRows.length < 3) throw new Error("활성 상품 3개 필요 — npm run db:seed:dev 먼저 실행");
  const [firstProduct, secondProduct, thirdProduct] = productRows.map((row) => row.id);

  const promotionIds: number[] = [];

  const BASE_INPUT: AdminPromotionInput = {
    slug: `adm-ev-${SUFFIX}`,
    title: `관리자기획전${SUFFIX}`,
    description: "검증용",
    heroImagePath: null,
    heroMobileImagePath: null,
    startsAt: null,
    endsAt: null,
    couponId: null,
    isActive: true,
    productIds: [firstProduct, secondProduct],
  };

  try {
    console.log("\n[0] ★coupon_id 컬럼이 실제로 있는가 (SQL 적용 확인)");
    await db.select({ probe: promotion.couponId }).from(promotion).limit(1);
    check(true, "promotion.coupon_id 조회 가능");

    console.log("\n[1] 등록·조회");
    const created = await createAdminPromotion(db, { promotion: BASE_INPUT, actor: ADMIN });
    promotionIds.push(created.promotionId);
    const saved = await getAdminPromotion(db, created.promotionId);
    check(
      saved.title === BASE_INPUT.title &&
        saved.products.map((item) => item.productId).join(",") ===
          `${firstProduct},${secondProduct}`,
      "입력 그대로 저장 — 상품 순서 포함",
      saved.products,
    );
    const listed = await listAdminPromotions(db, { keyword: SUFFIX });
    check(
      listed.rows.some((row) => row.promotionId === created.promotionId && row.productCount === 2),
      "목록에 상품 수와 함께 나온다",
    );

    console.log("\n[2] 구성 교체 — 화면이 보낸 전체가 진실");
    await updateAdminPromotion(db, {
      promotionId: created.promotionId,
      promotion: { ...BASE_INPUT, productIds: [thirdProduct, firstProduct] },
      actor: ADMIN,
    });
    const replaced = await getAdminPromotion(db, created.promotionId);
    check(
      replaced.products.map((item) => item.productId).join(",") ===
        `${thirdProduct},${firstProduct}`,
      "교체·순서변경이 그대로 반영된다 (남은 상품이 섞이지 않는다)",
      replaced.products,
    );

    console.log("\n[3] 잘못된 입력 — 서비스가 거른다");
    check(
      await expectRejected(() =>
        createAdminPromotion(db, {
          promotion: { ...BASE_INPUT, slug: `한글주소${SUFFIX}` },
          actor: ADMIN,
        }),
      ),
      "한글 slug 거절 — URL이 %EC%…로 깨진다",
    );
    check(
      await expectRejected(() =>
        createAdminPromotion(db, {
          promotion: { ...BASE_INPUT, slug: `adm-ev2-${SUFFIX}`, productIds: [] },
          actor: ADMIN,
        }),
      ),
      "★빈 구성 거절 — 백지 기획전이 스토어에 열리면 안 된다",
    );
    check(
      await expectRejected(() =>
        createAdminPromotion(db, {
          promotion: {
            ...BASE_INPUT,
            slug: `adm-ev3-${SUFFIX}`,
            startsAt: new Date("2026-12-01"),
            endsAt: new Date("2026-01-01"),
          },
          actor: ADMIN,
        }),
      ),
      "기간 역전 거절",
    );

    console.log("\n[4] slug 중복");
    check(
      await expectRejected(() =>
        createAdminPromotion(db, { promotion: BASE_INPUT, actor: ADMIN }),
      ),
      "같은 주소로 또 만들면 거절된다",
    );
    check(
      (await updateAdminPromotion(db, {
        promotionId: created.promotionId,
        promotion: { ...BASE_INPUT, title: `수정${SUFFIX}` },
        actor: ADMIN,
      })).updated,
      "자기 slug는 그대로 두고 수정할 수 있다",
    );

    console.log("\n[5] 중지 — 스토어에서 사라지고 관리자에는 남는다");
    await deactivateAdminPromotion(db, { promotionId: created.promotionId, actor: ADMIN });
    const storeList = await listStorePromotions(db);
    check(
      !storeList.some((card) => card.promotionId === created.promotionId),
      "스토어 목록에서 빠진다",
    );
    check(
      (await getStorePromotionDetail(db, BASE_INPUT.slug)) === null,
      "스토어 상세도 닫힌다",
    );
    const adminList = await listAdminPromotions(db, { keyword: SUFFIX });
    check(
      adminList.rows.some(
        (row) => row.promotionId === created.promotionId && row.isActive === false,
      ),
      "★관리자 목록에는 '중지됨'으로 남는다 — 지난 기획전 기록이 사라지면 안 된다",
    );
  } finally {
    if (promotionIds.length > 0) {
      await db.delete(promotion).where(inArray(promotion.id, promotionIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
