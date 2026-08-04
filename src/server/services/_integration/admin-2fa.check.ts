/**
 * 관리자 2단계 인증 검증.
 * 실행: npm run check:admin-2fa   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **켜져 있으면 비밀번호만으로는 절대 세션에 못 간다.**
 * 설정 흐름(코드 확인 전 미저장)·재사용 차단(RFC 6238 §5.2)까지 실제 DB에서 확인한다.
 *
 * 시나리오: [0]★totp_last_used_step 컬럼 [1]미설정 계정은 그대로 [2]설정 흐름
 *           [3]코드 없으면 2단계 요구 [4]올바른 코드 통과 [5]★같은 코드 재사용 거절
 *           [6]틀린 코드 거절 [7]해제(코드 필요)
 */

import "dotenv/config";

import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adminUser } from "@/db/schema";

import {
  AdminTotpRequiredError,
  confirmTotpSetup,
  disableTotp,
  getTotpStatus,
  startTotpSetup,
  verifyAdminLogin,
} from "../admin-auth.service";
import { totpCodeAtStep, totpStep } from "../../security/totp";

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
const PASSWORD = `check-pw-${SUFFIX}`;

async function expectError(
  run: () => Promise<unknown>,
  match: (caught: unknown) => boolean,
): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (caught) {
    return match(caught);
  }
}

async function main() {
  console.log("PaRaSOL 관리자 2FA 검증 (임시 계정은 종료 시 삭제)");

  const adminIds: number[] = [];

  try {
    console.log("\n[0] ★totp_last_used_step 컬럼이 실제로 있는가 (SQL 적용 확인)");
    await db.select({ probe: adminUser.totpLastUsedStep }).from(adminUser).limit(1);
    check(true, "admin_user.totp_last_used_step 조회 가능");

    const [testAdmin] = await db
      .insert(adminUser)
      .values({
        loginId: `2fa-${SUFFIX}`,
        passwordHash: await bcrypt.hash(PASSWORD, 12),
        name: `2FA검증${SUFFIX}`,
        role: "manager",
        isActive: true,
      })
      .returning({ id: adminUser.id, loginId: adminUser.loginId });
    adminIds.push(testAdmin.id);

    console.log("\n[1] 미설정 계정 — 비밀번호만으로 그대로 로그인된다");
    const plainLogin = await verifyAdminLogin(db, {
      loginId: testAdmin.loginId,
      password: PASSWORD,
    });
    check(plainLogin.adminUserId === testAdmin.id, "TOTP 없는 계정은 기존 흐름 그대로");

    console.log("\n[2] 설정 흐름 — 코드 확인 전에는 저장되지 않는다");
    const material = await startTotpSetup(db, {
      adminUserId: testAdmin.id,
      issuer: "PaRaSOL검증",
    });
    check(/^[A-Z2-7]{32}$/.test(material.secretBase32), "시크릿 발급(160비트 base32)");
    check(
      material.otpauthUri.includes("otpauth://totp/") &&
        material.otpauthUri.includes(material.secretBase32),
      "otpauth URI에 시크릿이 실린다",
    );
    check(
      (await getTotpStatus(db, testAdmin.id)).totpEnabled === false,
      "★시작만으로는 꺼진 상태 그대로 — 등록을 못 끝내도 로그인이 잠기지 않는다",
    );

    const wrongConfirmRejected = await expectError(
      () =>
        confirmTotpSetup(db, {
          adminUserId: testAdmin.id,
          secretBase32: material.secretBase32,
          totpCode: "000000",
        }),
      (caught) => caught instanceof Error && caught.message.includes("올바르지"),
    );
    check(wrongConfirmRejected, "틀린 코드로는 켤 수 없다");

    const nowStep = totpStep(Date.now());
    await confirmTotpSetup(db, {
      adminUserId: testAdmin.id,
      secretBase32: material.secretBase32,
      totpCode: totpCodeAtStep(material.secretBase32, nowStep),
    });
    check(
      (await getTotpStatus(db, testAdmin.id)).totpEnabled === true,
      "올바른 코드로 활성화된다(등록 증명)",
    );

    console.log("\n[3] 켜진 계정 — 코드 없이는 2단계 요구");
    const requiresTotp = await expectError(
      () => verifyAdminLogin(db, { loginId: testAdmin.loginId, password: PASSWORD }),
      (caught) => caught instanceof AdminTotpRequiredError,
    );
    check(requiresTotp, "★비밀번호만으로는 세션에 못 간다 — AdminTotpRequiredError");

    console.log("\n[4] 올바른 코드 — 통과");
    // confirm이 현재 스텝을 사용했으므로 다음 스텝 코드로 로그인한다(재사용 차단과 무관하게)
    const loginStep = nowStep + 1;
    const loginResult = await verifyAdminLogin(db, {
      loginId: testAdmin.loginId,
      password: PASSWORD,
      totpCode: totpCodeAtStep(material.secretBase32, loginStep),
    });
    check(loginResult.adminUserId === testAdmin.id, "비밀번호+코드로 로그인된다 (±1창 허용)");

    console.log("\n[5] ★같은 코드 재사용 — 거절 (어깨너머 방어)");
    const replayRejected = await expectError(
      () =>
        verifyAdminLogin(db, {
          loginId: testAdmin.loginId,
          password: PASSWORD,
          totpCode: totpCodeAtStep(material.secretBase32, loginStep),
        }),
      (caught) => caught instanceof Error && caught.message.includes("이미 사용된"),
    );
    check(replayRejected, "한 번 쓴 코드는 두 번 통하지 않는다 (totp_last_used_step)");

    console.log("\n[6] 틀린 코드 — 거절");
    const wrongRejected = await expectError(
      () =>
        verifyAdminLogin(db, {
          loginId: testAdmin.loginId,
          password: PASSWORD,
          totpCode: "123456",
        }),
      (caught) => caught instanceof Error && caught.message.includes("올바르지"),
    );
    check(wrongRejected, "틀린 코드는 거절된다");

    console.log("\n[7] 해제 — 현재 코드가 있어야 끈다");
    const disableWithoutCodeRejected = await expectError(
      () => disableTotp(db, { adminUserId: testAdmin.id, totpCode: "999999" }),
      (caught) => caught instanceof Error && caught.message.includes("올바르지"),
    );
    check(disableWithoutCodeRejected, "틀린 코드로는 끌 수 없다 — 세션 탈취자의 우회를 막는다");

    await disableTotp(db, {
      adminUserId: testAdmin.id,
      totpCode: totpCodeAtStep(material.secretBase32, loginStep + 1),
    });
    check(
      (await getTotpStatus(db, testAdmin.id)).totpEnabled === false,
      "올바른 코드로 꺼진다",
    );
    const backToPlain = await verifyAdminLogin(db, {
      loginId: testAdmin.loginId,
      password: PASSWORD,
    });
    check(backToPlain.adminUserId === testAdmin.id, "끈 뒤에는 비밀번호만으로 돌아간다");
  } finally {
    if (adminIds.length > 0) {
      await db.delete(adminUser).where(inArray(adminUser.id, adminIds));
    }
  }

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
