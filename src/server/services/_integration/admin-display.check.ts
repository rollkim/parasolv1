/**
 * 관리자 배너·진열 검증 — 실제 DB에서 확인한다.
 * 실행: npm run check:admin-display   (SSH 터널 켠 상태)
 *
 * 핵심 검증 둘:
 *   ① **노출 판정** — 활성이어도 기간 밖이면 스토어에 안 보인다. 활성 토글만 보면
 *      왜 배너가 없는지 알 수 없으므로 서버가 isLiveNow를 계산해 준다.
 *   ② **자동 유형 섹션의 상품 연결 제거** — manual→best로 바꿨는데 상품이 남아 있으면
 *      아무 데도 안 쓰이는 유령 데이터가 되고, 다시 manual로 돌릴 때 옛 목록이 되살아난다.
 *
 * 시나리오: [1]히어로 배너 CRUD [2]대체텍스트·기간 규칙 [3]노출 판정 [4]순서 이동
 *           [5]진열 섹션·유형 전환 [6]권한
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adminUser, banner, displaySection, displaySectionProduct, product } from "@/db/schema";
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
const SAMPLE_IMAGE = "banners/202607/abcdef012345.jpg";

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

async function main() {
  console.log("PaRaSOL 관리자 배너·진열 검증 (임시 데이터는 종료 시 삭제)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const [sampleProduct] = await db
    .select({ id: product.id })
    .from(product)
    .where(eq(product.status, "active"))
    .orderBy(product.id)
    .limit(1);
  if (!sampleProduct) throw new Error("활성 상품 없음 — npm run db:seed:dev 먼저 실행");

  const createdBannerIds: number[] = [];
  const createdSectionIds: number[] = [];

  try {
    const caller = await adminCaller(admin.id);

    console.log("\n[1] 히어로 배너 — 작성·수정 기대");
    const hero = await caller.adminDisplay.saveBanner({
      bannerId: null,
      slot: "hero",
      title: `여름 기획전 ${SUFFIX}`,
      kicker: "SUMMER",
      subtitle: "시원한 간식 모음",
      ctaLabel: "보러가기",
      imagePath: SAMPLE_IMAGE,
      alt: "여름 기획전 배너",
      toneCode: null,
      linkUrl: "/products",
      isActive: true,
      startsAt: null,
      endsAt: null,
    });
    createdBannerIds.push(hero.bannerId);

    const afterCreate = await caller.adminDisplay.listBanners();
    const heroCard = afterCreate.hero.find((card) => card.bannerId === hero.bannerId);
    check(heroCard !== undefined, "히어로 목록에 보인다");
    check(heroCard?.isLiveNow === true, "기간 없이 활성이면 지금 노출 중");
    check(heroCard?.alt === "여름 기획전 배너", "대체 텍스트 저장", heroCard?.alt);

    console.log("\n[2] 규칙 — 대체텍스트·기간 기대");
    let altBlocked = false;
    try {
      await caller.adminDisplay.saveBanner({
        bannerId: null,
        slot: "hero",
        title: "대체텍스트 없는 배너",
        kicker: null,
        subtitle: null,
        ctaLabel: null,
        imagePath: SAMPLE_IMAGE,
        alt: "   ",
        toneCode: null,
        linkUrl: null,
        isActive: true,
        startsAt: null,
        endsAt: null,
      });
    } catch (error) {
      altBlocked = error instanceof Error && /대체 텍스트/.test(error.message);
    }
    check(altBlocked, "이미지가 있으면 대체 텍스트 없이 저장할 수 없다(KWCAG)");

    let periodBlocked = false;
    try {
      await caller.adminDisplay.saveBanner({
        bannerId: hero.bannerId,
        slot: "hero",
        title: "기간 뒤집힌 배너",
        kicker: null,
        subtitle: null,
        ctaLabel: null,
        imagePath: null,
        alt: null,
        toneCode: null,
        linkUrl: null,
        isActive: true,
        startsAt: daysFromNow(5),
        endsAt: daysFromNow(1),
      });
    } catch (error) {
      periodBlocked = error instanceof Error && /종료일이 시작일보다/.test(error.message);
    }
    check(periodBlocked, "종료일이 시작일보다 빠르면 차단");

    let linkBlocked = false;
    try {
      await caller.adminDisplay.saveBanner({
        bannerId: null,
        slot: "strip",
        title: "위험한 링크",
        kicker: null,
        subtitle: null,
        ctaLabel: null,
        imagePath: null,
        alt: null,
        toneCode: "primary",
        // 클릭이 곧 스크립트 실행이 되는 스킴
        linkUrl: "javascript:alert(1)",
        isActive: true,
        startsAt: null,
        endsAt: null,
      });
    } catch {
      linkBlocked = true;
    }
    check(linkBlocked, "javascript: 링크 차단 — 클릭이 곧 실행이 되면 안 된다");

    console.log("\n[3] 노출 판정 — 활성이어도 기간 밖이면 안 보인다 기대");
    const futureBanner = await caller.adminDisplay.saveBanner({
      bannerId: null,
      slot: "strip",
      title: `예약 띠배너 ${SUFFIX}`,
      kicker: null,
      subtitle: null,
      ctaLabel: null,
      imagePath: null,
      alt: null,
      toneCode: "accent",
      linkUrl: null,
      isActive: true,
      startsAt: daysFromNow(3),
      endsAt: daysFromNow(10),
    });
    createdBannerIds.push(futureBanner.bannerId);

    const pastBanner = await caller.adminDisplay.saveBanner({
      bannerId: null,
      slot: "strip",
      title: `종료 띠배너 ${SUFFIX}`,
      kicker: null,
      subtitle: null,
      ctaLabel: null,
      imagePath: null,
      alt: null,
      toneCode: "foreground",
      linkUrl: null,
      isActive: true,
      startsAt: daysFromNow(-10),
      endsAt: daysFromNow(-1),
    });
    createdBannerIds.push(pastBanner.bannerId);

    const stripList = await caller.adminDisplay.listBanners();
    const futureCard = stripList.strip.find((card) => card.bannerId === futureBanner.bannerId);
    const pastCard = stripList.strip.find((card) => card.bannerId === pastBanner.bannerId);
    check(
      futureCard?.isActive === true && futureCard.isLiveNow === false,
      "시작 전 배너는 활성이지만 노출 중이 아니다 — 활성 토글만 보면 왜 안 보이는지 모른다",
      { active: futureCard?.isActive, live: futureCard?.isLiveNow },
    );
    check(
      pastCard?.isActive === true && pastCard.isLiveNow === false,
      "종료된 배너도 마찬가지",
      { active: pastCard?.isActive, live: pastCard?.isLiveNow },
    );
    check(futureCard?.toneCode === "accent", "띠배너는 색상값이 아니라 토큰명을 저장", futureCard?.toneCode);

    console.log("\n[4] 순서 이동 — 같은 슬롯 안에서만 기대");
    const beforeMove = stripList.strip.map((card) => card.bannerId);
    await caller.adminDisplay.moveBanner({ bannerId: pastBanner.bannerId, direction: "up" });
    const afterMove = (await caller.adminDisplay.listBanners()).strip.map((card) => card.bannerId);
    check(
      afterMove.indexOf(pastBanner.bannerId) < beforeMove.indexOf(pastBanner.bannerId),
      "띠배너가 한 칸 올라간다",
      { before: beforeMove, after: afterMove },
    );
    const heroUnchanged = (await caller.adminDisplay.listBanners()).hero.some(
      (card) => card.bannerId === hero.bannerId,
    );
    check(heroUnchanged, "히어로 슬롯은 영향받지 않는다");

    console.log("\n[5] 진열 섹션 — 유형 전환 시 상품 연결 정리 기대");
    const section = await caller.adminDisplay.saveSection({
      sectionId: null,
      kicker: "CURATED",
      title: `검증 섹션 ${SUFFIX}`,
      kind: "manual",
      isActive: true,
      productIds: [sampleProduct.id],
    });
    createdSectionIds.push(section.sectionId);

    const sectionsAfterCreate = await caller.adminDisplay.listSections();
    const savedSection = sectionsAfterCreate.find(
      (row) => row.sectionId === section.sectionId,
    );
    check(savedSection?.products.length === 1, "수동 큐레이션에 상품 1개", savedSection?.products);
    check(savedSection?.kindLabel === "수동 큐레이션", "유형 라벨", savedSection?.kindLabel);

    await caller.adminDisplay.saveSection({
      sectionId: section.sectionId,
      kicker: "BEST",
      title: `검증 섹션 ${SUFFIX}`,
      kind: "best",
      isActive: true,
      productIds: [sampleProduct.id], // 자동 유형이라 무시돼야 한다
    });
    const linkRows = await db
      .select({ productId: displaySectionProduct.productId })
      .from(displaySectionProduct)
      .where(eq(displaySectionProduct.sectionId, section.sectionId));
    check(
      linkRows.length === 0,
      "자동 유형으로 바꾸면 상품 연결이 지워진다 — 남아 있으면 다시 수동으로 돌릴 때 옛 목록이 되살아난다",
      linkRows,
    );

    const secondSection = await caller.adminDisplay.saveSection({
      sectionId: null,
      kicker: null,
      title: `두 번째 섹션 ${SUFFIX}`,
      kind: "new",
      isActive: false,
      productIds: [],
    });
    createdSectionIds.push(secondSection.sectionId);

    const beforeSectionMove = (await caller.adminDisplay.listSections()).map(
      (row) => row.sectionId,
    );
    await caller.adminDisplay.moveSection({
      sectionId: secondSection.sectionId,
      direction: "up",
    });
    const afterSectionMove = (await caller.adminDisplay.listSections()).map(
      (row) => row.sectionId,
    );
    check(
      afterSectionMove.indexOf(secondSection.sectionId) <
        beforeSectionMove.indexOf(secondSection.sectionId),
      "진열 섹션 순서 이동",
      { before: beforeSectionMove, after: afterSectionMove },
    );

    console.log("\n[6] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let listForbidden = false;
    let saveForbidden = false;
    try {
      await anonymous.adminDisplay.listBanners();
    } catch (error) {
      listForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminDisplay.deleteSection({ sectionId: section.sectionId });
    } catch (error) {
      saveForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(listForbidden, "관리자 세션 없이는 배너 목록 조회 불가");
    check(saveForbidden, "관리자 세션 없이는 진열 섹션 삭제 불가");
  } finally {
    if (createdBannerIds.length > 0) {
      await db.delete(banner).where(inArray(banner.id, createdBannerIds));
    }
    if (createdSectionIds.length > 0) {
      await db.delete(displaySection).where(inArray(displaySection.id, createdSectionIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
