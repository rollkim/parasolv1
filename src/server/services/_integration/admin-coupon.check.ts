/**
 * 관리자 쿠폰 관리 검증 (C6).
 * 실행: npm run check:admin-coupon   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **잘못 등록된 쿠폰은 돈이 잘못 나간다.** 화면이 먼저 걸러도 API 직접
 * 호출로 뚫리므로 서비스가 다시 본다 — 그 판정이 실제로 걸리는지 확인한다.
 *
 * 시나리오: [0]★관리자 쿠폰 입구 [1]등록·목록 [2]발급/사용 현황 [3]잘못된 입력 거절
 *           [4]코드 중복 [5]수정 [6]사용 중지(삭제 아님)
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { coupon, customer } from "@/db/schema";

import {
  AdminCouponInvalidError,
  createAdminCoupon,
  deactivateAdminCoupon,
  getAdminCoupon,
  listAdminCoupons,
  updateAdminCoupon,
  type AdminCouponInput,
} from "../admin-coupon.service";
import { issueCouponToCustomer } from "../coupon.service";
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

const BASE_INPUT: AdminCouponInput = {
  name: `관리자쿠폰${SUFFIX}`,
  discountKind: "fixed",
  discountValue: 3000,
  maxDiscountAmount: null,
  minOrderAmount: 10_000,
  scopeKind: "all",
  scopeRefId: null,
  issueMethod: "download",
  code: null,
  totalQuantity: 100,
  perCustomerLimit: 2,
  validDays: 30,
  startsAt: null,
  endsAt: null,
  isActive: true,
};

async function expectRejected(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (caught) {
    return caught instanceof AdminCouponInvalidError;
  }
}

async function main() {
  console.log("PaRaSOL 관리자 쿠폰 관리 검증 (임시 데이터는 종료 시 삭제)");

  const couponIds: number[] = [];
  const customerIds: number[] = [];

  try {
    console.log("\n[0] ★관리자 쿠폰 입구 — 등록이 실제로 저장되는가");
    const created = await createAdminCoupon(db, { coupon: BASE_INPUT, actor: ADMIN });
    couponIds.push(created.couponId);
    check(created.couponId > 0, "쿠폰이 생성됐다");

    const saved = await getAdminCoupon(db, created.couponId);
    check(
      saved.name === BASE_INPUT.name &&
        saved.discountValue === 3000 &&
        saved.perCustomerLimit === 2,
      "입력한 조건 그대로 저장됐다",
      saved,
    );

    console.log("\n[1] 목록 — 검색·탭 필터가 걸린다");
    const searched = await listAdminCoupons(db, { keyword: SUFFIX });
    check(
      searched.rows.some((row) => row.couponId === created.couponId),
      "쿠폰명 검색으로 찾힌다",
    );
    const activeOnly = await listAdminCoupons(db, { tab: "active", keyword: SUFFIX });
    check(
      activeOnly.rows.some((row) => row.couponId === created.couponId),
      "운영중 탭에 나온다",
    );

    console.log("\n[2] 발급·사용 현황 — 목록이 실제 숫자를 보여준다");
    const [buyer] = await db
      .insert(customer)
      .values({ name: `쿠폰관리${SUFFIX}`, email: `ac-${SUFFIX}@example.com`, isActive: true })
      .returning({ id: customer.id });
    customerIds.push(buyer.id);
    await db.transaction((tx) =>
      issueCouponToCustomer(tx, { couponId: created.couponId, customerId: buyer.id }),
    );

    const afterIssue = await getAdminCoupon(db, created.couponId);
    check(afterIssue.issuedCount === 1, "발급 수가 1로 보인다", afterIssue.issuedCount);
    check(
      afterIssue.usedCount === 0,
      "사용 수는 0 — 발급만 되고 안 쓰인 쿠폰이 구분된다",
      afterIssue.usedCount,
    );

    console.log("\n[3] 잘못된 입력 — 서비스가 거절한다 (화면만 막으면 API로 뚫린다)");
    check(
      await expectRejected(() =>
        createAdminCoupon(db, {
          coupon: { ...BASE_INPUT, name: `퍼센트초과${SUFFIX}`, discountKind: "percent", discountValue: 1500 },
          actor: ADMIN,
        }),
      ),
      "★할인율 100% 초과는 거절 — 0.1% 단위를 %로 착각한 경우",
    );
    check(
      await expectRejected(() =>
        createAdminCoupon(db, {
          coupon: { ...BASE_INPUT, name: `정액상한${SUFFIX}`, maxDiscountAmount: 1000 },
          actor: ADMIN,
        }),
      ),
      "정액 쿠폰에 최대 할인액은 거절 — 둘 중 작은 값이 적용돼 의도와 달라진다",
    );
    check(
      await expectRejected(() =>
        createAdminCoupon(db, {
          coupon: { ...BASE_INPUT, name: `범위없음${SUFFIX}`, scopeKind: "product", scopeRefId: null },
          actor: ADMIN,
        }),
      ),
      "★범위 쿠폰인데 대상이 비면 거절 — 아무에게도 안 걸리는 쿠폰이 조용히 만들어진다",
    );
    check(
      await expectRejected(() =>
        createAdminCoupon(db, {
          coupon: { ...BASE_INPUT, name: `코드없음${SUFFIX}`, issueMethod: "code", code: null },
          actor: ADMIN,
        }),
      ),
      "코드 등록형인데 코드가 없으면 거절",
    );
    check(
      await expectRejected(() =>
        createAdminCoupon(db, {
          coupon: {
            ...BASE_INPUT,
            name: `기간역전${SUFFIX}`,
            startsAt: new Date("2026-12-01"),
            endsAt: new Date("2026-01-01"),
          },
          actor: ADMIN,
        }),
      ),
      "종료일이 시작일보다 빠르면 거절",
    );

    console.log("\n[4] 코드 중복 — 저장 실패 대신 읽을 수 있는 문구");
    const codeValue = `CODE${SUFFIX}`;
    const codeCoupon = await createAdminCoupon(db, {
      coupon: { ...BASE_INPUT, name: `코드쿠폰${SUFFIX}`, issueMethod: "code", code: codeValue },
      actor: ADMIN,
    });
    couponIds.push(codeCoupon.couponId);
    check(
      await expectRejected(() =>
        createAdminCoupon(db, {
          coupon: { ...BASE_INPUT, name: `코드중복${SUFFIX}`, issueMethod: "code", code: codeValue },
          actor: ADMIN,
        }),
      ),
      "같은 코드로 또 만들면 거절된다",
    );
    check(
      (await updateAdminCoupon(db, {
        couponId: codeCoupon.couponId,
        coupon: { ...BASE_INPUT, name: `코드쿠폰수정${SUFFIX}`, issueMethod: "code", code: codeValue },
        actor: ADMIN,
      })).updated,
      "자기 코드는 그대로 두고 수정할 수 있다 — 이름만 고치려다 막히면 안 된다",
    );

    console.log("\n[5] 수정 — 조건이 바뀐다");
    await updateAdminCoupon(db, {
      couponId: created.couponId,
      coupon: { ...BASE_INPUT, discountValue: 4000, perCustomerLimit: 3 },
      actor: ADMIN,
    });
    const afterUpdate = await getAdminCoupon(db, created.couponId);
    check(
      afterUpdate.discountValue === 4000 && afterUpdate.perCustomerLimit === 3,
      "수정한 값이 반영된다",
      afterUpdate,
    );
    check(
      afterUpdate.issuedCount === 1,
      "★수정이 발급 수를 건드리지 않는다 — 발급 원장이 진실이다",
      afterUpdate.issuedCount,
    );

    console.log("\n[6] 사용 중지 — 삭제가 아니다");
    await deactivateAdminCoupon(db, { couponId: created.couponId, actor: ADMIN });
    const afterStop = await getAdminCoupon(db, created.couponId);
    check(afterStop.isActive === false, "is_active가 false로 바뀐다");
    check(
      afterStop.issuedCount === 1,
      "★행이 남아 있다 — 지우면 발급된 쿠폰이 붙은 주문 이력이 끊긴다",
    );

    const [stillThere] = await db
      .select({ id: coupon.id })
      .from(coupon)
      .where(eq(coupon.id, created.couponId));
    check(stillThere !== undefined, "DB에도 행이 그대로 있다");

    const endedTab = await listAdminCoupons(db, { tab: "ended", keyword: SUFFIX });
    check(
      endedTab.rows.some((row) => row.couponId === created.couponId),
      "종료·중지 탭으로 옮겨간다",
    );
  } finally {
    if (couponIds.length > 0) {
      await db.delete(coupon).where(inArray(coupon.id, couponIds));
    }
    if (customerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, customerIds));
    }
    // 거절 검증에서 만들어졌을 수 있는 잔여물 정리 — 이름에 SUFFIX가 들어간다
    await db.delete(coupon).where(inArray(coupon.name, [
      `퍼센트초과${SUFFIX}`,
      `정액상한${SUFFIX}`,
      `범위없음${SUFFIX}`,
      `코드없음${SUFFIX}`,
      `기간역전${SUFFIX}`,
      `코드중복${SUFFIX}`,
      `코드쿠폰수정${SUFFIX}`,
    ]));
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
