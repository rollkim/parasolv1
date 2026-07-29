/**
 * 관리자 설정 검증 — 저장한 값이 **실제 소비 지점에 도달하는지**까지 확인한다.
 * 실행: npm run check:admin-setting   (SSH 터널 켠 상태)
 *
 * 설정 화면은 "저장됐다"는 토스트만 보고 넘어가기 쉽다. 정작 중요한 것은 그 값이
 * 푸터(getBusinessInfo)와 주문·클레임 배송비(loadShippingPolicy)에 실제로 반영되는가다.
 * 키 이름 오타 하나면 저장은 되고 아무 데도 안 읽히는 값이 된다.
 *
 * 시나리오: [1]기본 조회·서버 관리 키 안내 [2]사업자 정보 → 푸터 소비 지점 도달
 *           [3]배송 정책 → 주문/클레임 소비 지점 도달 [4]배송 정책 검증 [5]측정 ID 형식
 *           [6]시크릿은 저장 대상이 아님 [7]권한
 */

import "dotenv/config";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adminUser, siteSetting } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { SignJWT } from "jose";

import { loadShippingPolicy } from "../shipping-policy.service";
import { getBusinessInfo } from "../site-setting.service";

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

/** 검증이 남의 설정을 망가뜨리면 안 된다 — 원본을 떠 두고 끝에 되돌린다 */
const TOUCHED_KEYS = ["business_info", "shipping_policy", "policy_text", "analytics"];

async function main() {
  console.log("PaRaSOL 관리자 설정 검증 (기존 설정은 종료 시 복원)");

  const [admin] = await db
    .select({ id: adminUser.id })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!admin) throw new Error("활성 관리자 계정 없음 — npm run db:seed 먼저 실행");

  const originalRows = await db
    .select({ key: siteSetting.key, value: siteSetting.value })
    .from(siteSetting)
    .where(inArray(siteSetting.key, TOUCHED_KEYS));

  try {
    const caller = await adminCaller(admin.id);

    console.log("\n[1] 조회 — 형태 보장·서버 관리 키 안내 기대");
    const initial = await caller.adminSetting.get();
    check(
      typeof initial.businessInfo.brandName === "string" &&
        typeof initial.shippingPolicy.baseFee === "number",
      "설정이 비어 있어도 형태가 보장된다",
    );
    check(
      initial.serverManagedKeys.length > 0 &&
        initial.serverManagedKeys.every((entry) => entry.reason.length > 0),
      "서버가 소유하는 값은 이유와 함께 밝힌다 — 없는 칸을 찾아 헤매지 않게",
    );
    check(
      initial.serverManagedKeys.some((entry) => entry.label.includes("토스")),
      "PG 시크릿이 서버 관리 목록에 있다",
    );

    console.log("\n[2] 사업자 정보 — 푸터 소비 지점에 도달 기대");
    await caller.adminSetting.saveBusinessInfo({
      brandName: "검증브랜드",
      companyName: "검증 협동조합",
      ceoName: "홍길동",
      businessNo: "123-45-67890",
      mailOrderNo: "제2026-검증-0001호",
      address: "서울특별시 마포구 만리재로 00",
      privacyOfficer: "김보호",
      hostingProvider: "검증호스팅",
      csPhone: "1600-0000",
      csHours: ["평일 10:00–17:00", "주말·공휴일 휴무"],
      csEmail: "cs@example.com",
      brandTagline: "검증 태그라인",
      copyrightNotice: "© 2026 검증",
    });

    // 저장 확인이 아니라 **푸터가 읽는 함수**로 확인한다 — 키 오타면 여기서 걸린다
    const footerInfo = await getBusinessInfo(db);
    check(
      footerInfo.brandName === "검증브랜드" && footerInfo.companyName === "검증 협동조합",
      "푸터가 읽는 getBusinessInfo에 반영된다 — 저장만 되고 안 읽히면 여기서 걸린다",
      { brandName: footerInfo.brandName },
    );
    check(footerInfo.csHours.length === 2, "운영시간 줄 배열 저장", footerInfo.csHours);

    console.log("\n[3] 배송 정책 — 주문·클레임 소비 지점에 도달 기대");
    await caller.adminSetting.saveShippingPolicy({
      baseFee: 4500,
      freeThreshold: 50000,
      remoteSurcharge: 3500,
    });

    const policy = await loadShippingPolicy(db);
    check(
      policy.baseFee === 4500 && policy.freeThreshold === 50000,
      "주문·클레임이 읽는 loadShippingPolicy에 반영된다 — 반품 배송비도 이 값에서 나온다",
      policy,
    );

    const reread = await caller.adminSetting.get();
    check(
      reread.shippingPolicy.remoteSurcharge === 3500,
      "도서·산간 값도 저장된다 (주문 반영은 check:remote-shipping이 확인한다)",
    );

    console.log("\n[4] 배송 정책 검증 — 잘못된 값 차단 기대");
    let negativeBlocked = false;
    try {
      await caller.adminSetting.saveShippingPolicy({
        baseFee: -1,
        freeThreshold: 0,
        remoteSurcharge: 0,
      });
    } catch {
      negativeBlocked = true;
    }
    check(negativeBlocked, "음수 배송비 차단");

    let invertedBlocked = false;
    try {
      await caller.adminSetting.saveShippingPolicy({
        baseFee: 5000,
        freeThreshold: 3000,
        remoteSurcharge: 0,
      });
    } catch (error) {
      invertedBlocked = error instanceof Error && /무료배송 기준이 배송비보다/.test(error.message);
    }
    check(invertedBlocked, "무료배송 기준이 배송비보다 낮으면 차단 — 실수로 전 주문 무료가 된다");

    // 0은 '항상 무료'라는 뜻이라 허용해야 한다
    await caller.adminSetting.saveShippingPolicy({
      baseFee: 3000,
      freeThreshold: 0,
      remoteSurcharge: 0,
    });
    const alwaysFree = await loadShippingPolicy(db);
    check(alwaysFree.freeThreshold === 0, "기준 0(항상 무료)은 허용");

    console.log("\n[5] 측정 ID — 형식 검증 기대");
    let ga4Blocked = false;
    try {
      await caller.adminSetting.saveAnalytics({
        ga4MeasurementId: "UA-12345",
        naverWcsId: "",
      });
    } catch {
      ga4Blocked = true;
    }
    check(ga4Blocked, "GA4 형식이 아니면 차단 — 잘못된 ID는 '측정이 안 되는데 이유를 모르는' 상태를 만든다");

    await caller.adminSetting.saveAnalytics({
      ga4MeasurementId: "G-ABC123XYZ",
      naverWcsId: "wcs-0001",
    });
    const analyticsSaved = await caller.adminSetting.get();
    check(
      analyticsSaved.analytics.ga4MeasurementId === "G-ABC123XYZ",
      "올바른 형식은 저장된다",
    );
    // 빈 값은 '측정 안 함'이라 허용해야 한다
    await caller.adminSetting.saveAnalytics({ ga4MeasurementId: "", naverWcsId: "" });
    check(
      (await caller.adminSetting.get()).analytics.ga4MeasurementId === "",
      "빈 값(측정 안 함)은 허용",
    );

    console.log("\n[6] 시크릿 — 저장 대상이 아니다 기대");
    const settingKeys = await db.select({ key: siteSetting.key }).from(siteSetting);
    const secretLike = settingKeys.filter((row) =>
      /secret|password|private_key/i.test(row.key),
    );
    check(
      secretLike.length === 0,
      "site_setting에 시크릿류 키가 없다 — 관리자 화면이 뚫려도 결제 키는 나가지 않는다",
      secretLike,
    );

    console.log("\n[7] 권한 게이트 — 비로그인 차단 기대");
    const anonymous = createCaller(await createTRPCContext({ headers: new Headers() }));
    let getForbidden = false;
    let saveForbidden = false;
    try {
      await anonymous.adminSetting.get();
    } catch (error) {
      getForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    try {
      await anonymous.adminSetting.saveShippingPolicy({
        baseFee: 0,
        freeThreshold: 0,
        remoteSurcharge: 0,
      });
    } catch (error) {
      saveForbidden = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(getForbidden, "관리자 세션 없이는 설정 조회 불가");
    check(saveForbidden, "관리자 세션 없이는 배송 정책 변경 불가 — 주문 금액이 걸린 값이다");
  } finally {
    // 검증이 건드린 키를 원래대로 — 없던 키는 지운다
    await db.delete(siteSetting).where(inArray(siteSetting.key, TOUCHED_KEYS));
    if (originalRows.length > 0) {
      await db.insert(siteSetting).values(
        originalRows.map((row) => ({ key: row.key, value: row.value })),
      );
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
