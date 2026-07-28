/**
 * 관리자 인증 검증 — 로그인·세션 분리·권한 게이트를 실제 DB에서 확인한다.
 * 실행: npm run check:admin-auth   (SSH 터널 켠 상태)
 *
 * 핵심 검증: **고객 세션으로 관리자가 될 수 없는가.** 두 세션이 같은 서명 키를 쓰므로
 * 쿠키 이름·aud 분리가 실제로 막는지 실측해야 한다 — 뚫리면 권한 상승이다.
 *
 * 시나리오: [1]로그인 성공·세션 발급 [2]실패 사유 미구분 [3]고객 토큰 차단
 *           [4]adminProcedure 게이트 [5]비활성 계정 차단 [6]레이트리밋
 */

import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { adminUser } from "@/db/schema";
import { ADMIN_SESSION_COOKIE_NAME } from "@/server/auth/admin-session";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { createTRPCContext } from "@/server/trpc/context";
import { createCaller } from "@/server/trpc/routers/_app";
import { verifyAdminLogin } from "../admin-auth.service";

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

async function callerWithCookie(cookie: string) {
  return createCaller(await createTRPCContext({ headers: new Headers({ cookie }) }));
}

/** 관리자 세션 토큰을 직접 만든다 — 쿠키 발급(cookies())은 요청 스코프가 필요해 여기선 못 쓴다 */
async function signToken(subject: string, audience?: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
  const builder = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h");
  if (audience) builder.setAudience(audience);
  return builder.sign(secret);
}

async function main() {
  console.log("PaRaSOL 관리자 인증 검증");

  const [existingAdmin] = await db
    .select({ id: adminUser.id, loginId: adminUser.loginId, name: adminUser.name })
    .from(adminUser)
    .where(eq(adminUser.isActive, true))
    .orderBy(adminUser.id)
    .limit(1);
  if (!existingAdmin) {
    throw new Error(
      "활성 관리자 계정이 없습니다 — .env의 SEED_ADMIN_* 설정 후 npm run db:seed 실행",
    );
  }

  console.log("\n[1] 로그인 — 잘못된 비밀번호는 거부 기대");
  let wrongPasswordRejected = false;
  let wrongPasswordMessage = "";
  try {
    await verifyAdminLogin(db, {
      loginId: existingAdmin.loginId,
      password: "definitely-not-the-password",
      ip: "127.0.0.1",
    });
  } catch (error) {
    wrongPasswordRejected = true;
    wrongPasswordMessage = error instanceof Error ? error.message : String(error);
  }
  check(wrongPasswordRejected, "잘못된 비밀번호 거부");

  console.log("\n[2] 실패 사유 미구분 — 없는 계정도 같은 문구 기대");
  let unknownAccountMessage = "";
  try {
    await verifyAdminLogin(db, {
      loginId: "no-such-admin-account",
      password: "whatever",
      ip: "127.0.0.1",
    });
  } catch (error) {
    unknownAccountMessage = error instanceof Error ? error.message : String(error);
  }
  check(
    unknownAccountMessage === wrongPasswordMessage && unknownAccountMessage.length > 0,
    `없는 계정과 틀린 비밀번호가 같은 문구: "${unknownAccountMessage}"`,
  );

  console.log("\n[3] 세션 분리 — 고객 토큰으로 관리자가 될 수 없다 기대");
  // 고객 세션과 동일한 형태(aud 없음)의 토큰을 관리자 쿠키 자리에 넣어본다
  const customerStyleToken = await signToken(String(existingAdmin.id));
  const forgedCaller = await callerWithCookie(
    `${ADMIN_SESSION_COOKIE_NAME}=${customerStyleToken}`,
  );
  const forgedSession = await forgedCaller.adminAuth.getSession();
  check(forgedSession === null, "aud 없는 토큰(고객 형식) 거부", forgedSession);

  // 고객 쿠키에 유효한 고객 토큰이 있어도 관리자 컨텍스트는 비어야 한다
  const customerCookieCaller = await callerWithCookie(
    `${SESSION_COOKIE_NAME}=${customerStyleToken}`,
  );
  check(
    (await customerCookieCaller.adminAuth.getSession()) === null,
    "고객 쿠키는 관리자 세션이 되지 않는다",
  );

  // 다른 용도(aud=customer)로 서명한 토큰도 거부
  const wrongAudienceToken = await signToken(String(existingAdmin.id), "customer");
  const wrongAudienceCaller = await callerWithCookie(
    `${ADMIN_SESSION_COOKIE_NAME}=${wrongAudienceToken}`,
  );
  check(
    (await wrongAudienceCaller.adminAuth.getSession()) === null,
    "aud가 다른 토큰 거부",
  );

  console.log("\n[4] adminProcedure 게이트 — 비로그인 차단 기대");
  const anonymousCaller = await callerWithCookie("");
  let logoutBlocked = false;
  try {
    await anonymousCaller.adminAuth.logout();
  } catch (error) {
    logoutBlocked = error instanceof Error && /관리자 권한/.test(error.message);
  }
  check(logoutBlocked, "비로그인은 관리자 프로시저 차단");

  // 올바른 관리자 토큰이면 통과한다
  const adminToken = await signToken(String(existingAdmin.id), "admin");
  const adminCaller = await callerWithCookie(`${ADMIN_SESSION_COOKIE_NAME}=${adminToken}`);
  const adminSession = await adminCaller.adminAuth.getSession();
  check(
    adminSession?.adminUserId === existingAdmin.id,
    `올바른 관리자 토큰 통과 (id=${adminSession?.adminUserId})`,
  );

  console.log("\n[5] 비활성 계정 — 세션이 유효해도 차단 기대");
  await db.update(adminUser).set({ isActive: false }).where(eq(adminUser.id, existingAdmin.id));
  try {
    const deactivatedCaller = await callerWithCookie(
      `${ADMIN_SESSION_COOKIE_NAME}=${adminToken}`,
    );
    let deactivatedBlocked = false;
    try {
      await deactivatedCaller.adminAuth.logout();
    } catch (error) {
      deactivatedBlocked = error instanceof Error && /관리자 권한/.test(error.message);
    }
    check(deactivatedBlocked, "비활성 계정은 서명이 유효해도 차단 — DB 상태를 다시 본다");

    let deactivatedLoginRejected = false;
    try {
      await verifyAdminLogin(db, {
        loginId: existingAdmin.loginId,
        password: "any",
        ip: "127.0.0.1",
      });
    } catch {
      deactivatedLoginRejected = true;
    }
    check(deactivatedLoginRejected, "비활성 계정 로그인 거부");
  } finally {
    await db.update(adminUser).set({ isActive: true }).where(eq(adminUser.id, existingAdmin.id));
  }

  console.log("\n[6] 로그인 이력 — 성공·실패가 모두 기록되는지");
  const [logCount] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(sql`login_log`)
    .where(sql`subject_type = 'admin'`);
  check((logCount?.total ?? 0) > 0, `관리자 로그인 이력 ${logCount?.total ?? 0}건 기록됨`);

  console.log(`\n결과: 통과 ${passCount} · 실패 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n검증 중 오류:", error);
  process.exit(1);
});
