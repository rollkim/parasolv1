import "server-only";

import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { db as Database } from "@/db";
import { address, customer, customerAuth, loginLog, termsDocument, termsAgreement } from "@/db/schema";

/**
 * 회원 도메인 서비스 — 로컬(아이디/비밀번호) 가입·로그인 검증.
 * 세션 발급·쿠키 등 HTTP 관심사는 auth 라우터가 담당하고, 여기는 DB·규칙만 다룬다(RULE-14).
 * 소셜(kakao/naver/google)은 키 발급 대기 — customer_auth.provider 구조는 이미 수용한다.
 */

type DatabaseClient = typeof Database;
// 트랜잭션 안팎에서 같은 헬퍼(소유 검증)를 쓰기 위한 클라이언트 타입 — cart.service와 동일 규약
type TransactionClient = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type QueryClient = DatabaseClient | TransactionClient;

const BCRYPT_ROUNDS = 12;

/** 가입 필수 약관 코드 — 하나라도 빠지면 가입 불가 (시드 terms_document 기준) */
const REQUIRED_SIGNUP_TERMS_CODES = ["terms", "privacy", "age"] as const;

/**
 * 계정이 없어도 bcrypt 비교를 1회 수행해 응답 시간을 균등화하기 위한 더미 해시.
 * 실제 어떤 비밀번호와도 매칭시키지 않는다 — 비교 결과는 계정 존재 여부와 함께 무시된다.
 */
const TIMING_EQUALIZER_DUMMY_HASH =
  "$2b$12$6R8LJAx8BJj1NayDozvg/ea25LC1UoTGdUJruCggtTari1mltMHiS";

export type CustomerSessionProfile = {
  customerId: number;
  name: string;
};

// =============================================================
// 가입
// =============================================================

export type SignupLocalCustomerInput = {
  loginId: string;
  password: string;
  name: string;
  email: string;
  phone: string;
  /** 화면에서 체크된 약관 코드 — 필수 3종(terms/privacy/age) + 선택 marketing */
  agreedTermsCodes: string[];
  /** 동의 이력 증빙용 — 없어도 가입은 된다 */
  ip?: string | null;
};

/**
 * 로컬 회원가입 — customer + customer_auth + terms_agreement를 한 트랜잭션으로 만든다.
 * 비밀번호는 bcrypt 해시만 저장하고 평문은 어디에도 남기지 않는다.
 */
export async function signupLocalCustomer(
  database: DatabaseClient,
  input: SignupLocalCustomerInput,
): Promise<CustomerSessionProfile> {
  // 아이디 중복 — 유니크 인덱스(provider, provider_uid)가 최종 방어선이고 이건 UX용 사전 확인
  const [existingAuth] = await database
    .select({ customerAuthId: customerAuth.id })
    .from(customerAuth)
    .where(
      and(eq(customerAuth.provider, "local"), eq(customerAuth.providerUid, input.loginId)),
    )
    .limit(1);
  if (existingAuth) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.",
    });
  }

  const agreedCodes = [...new Set(input.agreedTermsCodes)];
  const missingRequiredCodes = REQUIRED_SIGNUP_TERMS_CODES.filter(
    (requiredCode) => !agreedCodes.includes(requiredCode),
  );
  if (missingRequiredCodes.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "필수 약관에 모두 동의해야 가입할 수 있습니다. 동의 항목을 확인해 주세요.",
    });
  }

  // 동의 이력은 "어느 버전에 동의했는가"가 핵심 — 코드별 최신 버전 문서 id로 기록한다
  const termsRows = await database
    .select({ termsDocumentId: termsDocument.id, termsCode: termsDocument.code })
    .from(termsDocument)
    .where(inArray(termsDocument.code, agreedCodes))
    .orderBy(desc(termsDocument.effectiveAt), desc(termsDocument.id));
  const latestDocIdByCode = new Map<string, number>();
  for (const row of termsRows) {
    if (!latestDocIdByCode.has(row.termsCode)) {
      latestDocIdByCode.set(row.termsCode, row.termsDocumentId);
    }
  }
  const codesWithoutDocument = agreedCodes.filter((code) => !latestDocIdByCode.has(code));
  if (codesWithoutDocument.length > 0) {
    // 문서 없이는 동의 이력을 남길 수 없다 — 시드 누락은 사용자 잘못이 아니므로 서버 오류로 낸다
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `약관 문서가 등록되어 있지 않습니다(${codesWithoutDocument.join(", ")}). 관리자에게 문의해 주세요.`,
    });
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const marketingAgreed = agreedCodes.includes("marketing");
  const agreedAt = new Date();

  return database.transaction(async (tx) => {
    const [createdCustomer] = await tx
      .insert(customer)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        marketingSmsAgreedAt: marketingAgreed ? agreedAt : null,
        marketingEmailAgreedAt: marketingAgreed ? agreedAt : null,
      })
      .returning({ id: customer.id, name: customer.name });

    await tx.insert(customerAuth).values({
      customerId: createdCustomer.id,
      provider: "local",
      providerUid: input.loginId,
      passwordHash,
    });

    await tx.insert(termsAgreement).values(
      [...latestDocIdByCode.values()].map((termsDocumentId) => ({
        customerId: createdCustomer.id,
        termsDocumentId,
        ip: input.ip ?? null,
      })),
    );

    return { customerId: createdCustomer.id, name: createdCustomer.name };
  });
}

// =============================================================
// 로그인 검증
// =============================================================

export type VerifyLocalLoginInput = {
  loginId: string;
  password: string;
  /** login_log 기록용 — 없어도 검증은 된다 */
  ip?: string | null;
  userAgent?: string | null;
};

async function recordLoginAttempt(
  database: DatabaseClient,
  attempt: {
    subjectId: number | null;
    success: boolean;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<void> {
  await database.insert(loginLog).values({
    subjectType: "customer",
    subjectId: attempt.subjectId,
    provider: "local",
    success: attempt.success,
    ip: attempt.ip ?? null,
    userAgent: attempt.userAgent ?? null,
  });
}

/**
 * 로컬 로그인 검증 — 실패 사유(계정 없음/비밀번호 틀림/탈퇴·비활성)를 구분하지 않는다.
 * 구분 메시지는 계정 존재 여부를 노출하는 열거(enumeration) 공격 통로가 되기 때문.
 * 계정이 없어도 더미 해시로 bcrypt 비교를 수행해 응답 시간 차이도 없앤다.
 */
export async function verifyLocalLogin(
  database: DatabaseClient,
  input: VerifyLocalLoginInput,
): Promise<CustomerSessionProfile> {
  const [authRow] = await database
    .select({
      customerId: customer.id,
      customerName: customer.name,
      passwordHash: customerAuth.passwordHash,
      isActive: customer.isActive,
      deletedAt: customer.deletedAt,
    })
    .from(customerAuth)
    .innerJoin(customer, eq(customerAuth.customerId, customer.id))
    .where(
      and(eq(customerAuth.provider, "local"), eq(customerAuth.providerUid, input.loginId)),
    )
    .limit(1);

  // 계정 유무와 무관하게 항상 1회 비교 — passwordHash가 null인 이상 데이터도 더미로 흡수
  const passwordMatches = await bcrypt.compare(
    input.password,
    authRow?.passwordHash ?? TIMING_EQUALIZER_DUMMY_HASH,
  );

  const loginAllowed =
    authRow !== undefined &&
    authRow.passwordHash !== null &&
    passwordMatches &&
    authRow.isActive &&
    authRow.deletedAt === null;

  await recordLoginAttempt(database, {
    subjectId: authRow?.customerId ?? null,
    success: loginAllowed,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  if (!loginAllowed || authRow === undefined) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "아이디 또는 비밀번호가 올바르지 않습니다.",
    });
  }

  return { customerId: authRow.customerId, name: authRow.customerName };
}

// =============================================================
// 세션 프로필
// =============================================================

/**
 * 헤더·마이페이지가 쓰는 최소 프로필 — 세션 JWT가 유효해도
 * 그 사이 탈퇴·비활성 처리됐을 수 있으므로 DB 상태로 재확인한다.
 */
export async function getCustomerSessionProfile(
  database: DatabaseClient,
  customerId: number,
): Promise<CustomerSessionProfile | null> {
  const [customerRow] = await database
    .select({ customerId: customer.id, customerName: customer.name })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.isActive, true),
        isNull(customer.deletedAt),
      ),
    )
    .limit(1);

  if (!customerRow) return null;
  return { customerId: customerRow.customerId, name: customerRow.customerName };
}

// =============================================================
// 마이페이지 프로필
// =============================================================

export type MyProfile = {
  customerId: number;
  /** 로컬 로그인 아이디 — 소셜 전용 계정은 null */
  loginId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

/** 회원정보 화면용 프로필 — 세션이 유효해도 그 사이 탈퇴·비활성됐을 수 있어 DB 상태로 거른다 */
export async function getMyProfile(
  database: DatabaseClient,
  customerId: number,
): Promise<MyProfile> {
  const [profileRow] = await database
    .select({
      customerId: customer.id,
      loginId: customerAuth.providerUid,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    })
    .from(customer)
    .leftJoin(
      customerAuth,
      and(eq(customerAuth.customerId, customer.id), eq(customerAuth.provider, "local")),
    )
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.isActive, true),
        isNull(customer.deletedAt),
      ),
    )
    .limit(1);

  if (!profileRow) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "회원 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
    });
  }
  return profileRow;
}

export type UpdateMyProfileInput = {
  customerId: number;
  name: string;
  email: string;
  phone: string;
};

/** 회원정보 수정 — 이메일 형식 등 입력 검증은 라우터(zod)가 끝낸 뒤 들어온다 */
export async function updateMyProfile(
  database: DatabaseClient,
  input: UpdateMyProfileInput,
): Promise<MyProfile> {
  const updatedRows = await database
    .update(customer)
    .set({ name: input.name, email: input.email, phone: input.phone })
    .where(
      and(
        eq(customer.id, input.customerId),
        eq(customer.isActive, true),
        isNull(customer.deletedAt),
      ),
    )
    .returning({ customerId: customer.id });
  if (updatedRows.length === 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "회원 정보를 확인할 수 없습니다. 다시 로그인해 주세요.",
    });
  }

  // loginId까지 포함한 최신 프로필로 응답 — 화면이 그대로 갱신에 쓴다
  return getMyProfile(database, input.customerId);
}

// =============================================================
// 배송지
// =============================================================

export type CustomerAddress = {
  addressId: number;
  label: string | null;
  recipient: string;
  phone: string;
  zipcode: string;
  addr1: string;
  addr2: string | null;
  isDefault: boolean;
};

const customerAddressSelection = {
  addressId: address.id,
  label: address.label,
  recipient: address.recipient,
  phone: address.phone,
  zipcode: address.zipcode,
  addr1: address.addr1,
  addr2: address.addr2,
  isDefault: address.isDefault,
};

/** 배송지 목록 — 기본 배송지가 항상 맨 위, 나머지는 최근 등록순 */
export async function listMyAddresses(
  database: DatabaseClient,
  customerId: number,
): Promise<CustomerAddress[]> {
  return database
    .select(customerAddressSelection)
    .from(address)
    .where(eq(address.customerId, customerId))
    .orderBy(desc(address.isDefault), desc(address.id));
}

/**
 * 배송지 소유 검증 — 남의 addressId를 보내는 IDOR을 막는다.
 * 존재하지 않으면 NOT_FOUND, 남의 것이면 FORBIDDEN으로 구분한다.
 */
async function assertOwnedAddress(
  client: QueryClient,
  customerId: number,
  addressId: number,
): Promise<void> {
  const [addressRow] = await client
    .select({ ownerCustomerId: address.customerId })
    .from(address)
    .where(eq(address.id, addressId))
    .limit(1);
  if (!addressRow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "배송지를 찾을 수 없습니다. 목록을 새로고침해 주세요.",
    });
  }
  if (addressRow.ownerCustomerId !== customerId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "본인의 배송지만 관리할 수 있습니다.",
    });
  }
}

export type SaveAddressFields = {
  label?: string | null;
  recipient: string;
  phone: string;
  zipcode: string;
  addr1: string;
  addr2?: string | null;
  isDefault?: boolean;
};

/**
 * 배송지 등록 — 기본 배송지는 단일 보장: 기본 지정 시 기존 기본을 같은 트랜잭션에서 해제한다.
 * 첫 배송지는 자동으로 기본이 된다 — 체크아웃에서 "기본 배송지 없음" 상태를 만들지 않기 위해.
 */
export async function createAddress(
  database: DatabaseClient,
  input: { customerId: number } & SaveAddressFields,
): Promise<CustomerAddress> {
  return database.transaction(async (tx) => {
    const [existingAddressRow] = await tx
      .select({ addressId: address.id })
      .from(address)
      .where(eq(address.customerId, input.customerId))
      .limit(1);
    const shouldBeDefault = input.isDefault === true || existingAddressRow === undefined;

    if (shouldBeDefault) {
      await tx
        .update(address)
        .set({ isDefault: false })
        .where(
          and(eq(address.customerId, input.customerId), eq(address.isDefault, true)),
        );
    }

    const [createdAddressRow] = await tx
      .insert(address)
      .values({
        customerId: input.customerId,
        // 빈 문자열 별칭·상세주소는 null로 통일 — "" 와 null이 섞이지 않게
        label: input.label || null,
        recipient: input.recipient,
        phone: input.phone,
        zipcode: input.zipcode,
        addr1: input.addr1,
        addr2: input.addr2 || null,
        isDefault: shouldBeDefault,
      })
      .returning(customerAddressSelection);
    return createdAddressRow;
  });
}

/** 배송지 수정 — isDefault를 보내지 않으면 기본 여부는 건드리지 않는다 */
export async function updateAddress(
  database: DatabaseClient,
  input: { customerId: number; addressId: number } & SaveAddressFields,
): Promise<CustomerAddress> {
  return database.transaction(async (tx) => {
    await assertOwnedAddress(tx, input.customerId, input.addressId);

    // 기본 지정이면 기존 기본을 먼저 해제 — 단일 보장
    if (input.isDefault === true) {
      await tx
        .update(address)
        .set({ isDefault: false })
        .where(
          and(eq(address.customerId, input.customerId), eq(address.isDefault, true)),
        );
    }

    const [updatedAddressRow] = await tx
      .update(address)
      .set({
        label: input.label || null,
        recipient: input.recipient,
        phone: input.phone,
        zipcode: input.zipcode,
        addr1: input.addr1,
        addr2: input.addr2 || null,
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      })
      .where(eq(address.id, input.addressId))
      .returning(customerAddressSelection);
    return updatedAddressRow;
  });
}

/** 배송지 삭제 — 기본 배송지를 지우면 새 기본은 사용자가 직접 지정한다 */
export async function deleteAddress(
  database: DatabaseClient,
  input: { customerId: number; addressId: number },
): Promise<void> {
  await assertOwnedAddress(database, input.customerId, input.addressId);
  await database.delete(address).where(eq(address.id, input.addressId));
}

/** 기본 배송지 지정 — 전체 해제 후 대상만 지정. 같은 트랜잭션이라 중간 상태가 노출되지 않는다 */
export async function setDefaultAddress(
  database: DatabaseClient,
  input: { customerId: number; addressId: number },
): Promise<void> {
  await database.transaction(async (tx) => {
    await assertOwnedAddress(tx, input.customerId, input.addressId);
    await tx
      .update(address)
      .set({ isDefault: false })
      .where(and(eq(address.customerId, input.customerId), eq(address.isDefault, true)));
    await tx
      .update(address)
      .set({ isDefault: true })
      .where(eq(address.id, input.addressId));
  });
}
