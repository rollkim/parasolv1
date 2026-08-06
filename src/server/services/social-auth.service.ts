import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { customer, customerAuth, termsAgreement, termsDocument } from "@/db/schema";
import { isMobilePhone, normalizePhone } from "@/domain/phone";
import type { SocialProfile, SocialProviderKey } from "@/server/auth/social-provider";

import type { DatabaseClient } from "./db-client";
import { earnSignupBonus } from "./point-earn.service";

/**
 * 소셜 로그인 계정 처리 — 찾기 / 연결 / 만들기.
 *
 * 세 갈래뿐이다:
 *   ① (provider, uid)가 이미 있다        → 그 회원으로 로그인
 *   ② 없는데 **검증된 이메일**이 기존 회원과 일치 → 그 회원에 연결(auth 행 추가)
 *   ③ 그 외                              → 새 회원 생성
 *
 * ②에서 **검증 여부를 반드시 본다.** 미검증 이메일로 연결하면 공격자가 피해자 이메일로
 * 소셜 계정을 만들어 피해자의 쇼핑몰 계정(주문·배송지·적립금)을 통째로 가져간다.
 * 카카오는 사용자가 이메일 제공을 거부할 수 있어 null도 정상이다 — 그때는 ③으로 간다.
 */

/** 필수 약관 — 로컬 가입과 같은 집합. 소셜 첫 가입도 법적으로 동의 이력이 남아야 한다 */
const REQUIRED_TERMS_CODES = ["terms", "privacy", "age"] as const;

export class SocialTermsMissingError extends Error {
  constructor(readonly missingCodes: string[]) {
    super(
      `약관 문서가 등록되어 있지 않습니다(${missingCodes.join(", ")}). 관리자에게 문의해 주세요.`,
    );
    this.name = "SocialTermsMissingError";
  }
}

export type SocialLoginOutcome = {
  customerId: number;
  name: string;
  /** 이번 요청에서 새 회원이 만들어졌는가 — 화면 문구를 "가입 환영"으로 바꾼다 */
  isNewCustomer: boolean;
  /** 기존 회원에 소셜 수단이 새로 붙었는가 — "카카오 계정을 연결했어요" 안내용 */
  isNewlyLinked: boolean;
};

/** 이름이 없을 수도 있다(닉네임 미동의). customer.name은 notNull이라 대체값이 필요하다 */
const PROVIDER_FALLBACK_NAMES: Record<SocialProviderKey, string> = {
  kakao: "카카오 회원",
  naver: "네이버 회원",
  google: "구글 회원",
};

export async function loginOrSignupWithSocial(
  database: DatabaseClient,
  input: {
    providerKey: SocialProviderKey;
    profile: SocialProfile;
    /** 약관 동의 증빙용 — 로컬 가입과 같은 기준 */
    ip: string | null;
  },
): Promise<SocialLoginOutcome> {
  const { providerKey, profile } = input;

  // ── ① 이미 연결된 소셜 계정인가
  const [existingAuth] = await database
    .select({ customerId: customerAuth.customerId, name: customer.name })
    .from(customerAuth)
    .innerJoin(customer, eq(customerAuth.customerId, customer.id))
    .where(
      and(
        eq(customerAuth.provider, providerKey),
        eq(customerAuth.providerUid, profile.providerUid),
        // 탈퇴한 회원의 소셜 수단은 재사용하지 않는다 — 새로 가입시킨다
        isNull(customer.deletedAt),
      ),
    )
    .limit(1);

  if (existingAuth) {
    return {
      customerId: existingAuth.customerId,
      name: existingAuth.name,
      isNewCustomer: false,
      isNewlyLinked: false,
    };
  }

  // ── ② 검증된 이메일로 기존 회원 찾기 (연결)
  if (profile.email && profile.emailVerified) {
    const [emailOwner] = await database
      .select({ customerId: customer.id, name: customer.name })
      .from(customer)
      .where(and(eq(customer.email, profile.email), isNull(customer.deletedAt)))
      // 같은 이메일이 여럿이면(과거 데이터) 가장 먼저 만든 계정으로 붙인다 — 임의 선택보다 예측 가능하다
      .orderBy(customer.id)
      .limit(1);

    if (emailOwner) {
      await database.insert(customerAuth).values({
        customerId: emailOwner.customerId,
        provider: providerKey,
        providerUid: profile.providerUid,
        // 소셜에는 비밀번호가 없다 — 이 행으로는 아이디 로그인이 되지 않는다
        passwordHash: null,
      });
      return {
        customerId: emailOwner.customerId,
        name: emailOwner.name,
        isNewCustomer: false,
        isNewlyLinked: true,
      };
    }
  }

  // ── ③ 새 회원
  const agreedCodes = [...REQUIRED_TERMS_CODES];
  const termsRows = await database
    .select({ termsCode: termsDocument.code, termsDocumentId: termsDocument.id })
    .from(termsDocument)
    .where(inArray(termsDocument.code, agreedCodes))
    .orderBy(desc(termsDocument.effectiveAt), desc(termsDocument.id));

  const latestDocIdByCode = new Map<string, number>();
  for (const row of termsRows) {
    if (!latestDocIdByCode.has(row.termsCode)) {
      latestDocIdByCode.set(row.termsCode, row.termsDocumentId);
    }
  }
  const missingCodes = agreedCodes.filter((code) => !latestDocIdByCode.has(code));
  if (missingCodes.length > 0) throw new SocialTermsMissingError(missingCodes);

  // 네이버만 연락처를 준다. 형식이 우리 규칙과 맞을 때만 저장한다 —
  // 어긋난 값을 넣으면 주문 조회가 영구히 안 되는 데이터가 생긴다(교훈 16)
  const normalizedPhone = profile.mobilePhone ? normalizePhone(profile.mobilePhone) : null;
  const storablePhone =
    normalizedPhone && isMobilePhone(normalizedPhone) ? normalizedPhone : null;

  return database.transaction(async (tx) => {
    const [createdCustomer] = await tx
      .insert(customer)
      .values({
        name: profile.displayName ?? PROVIDER_FALLBACK_NAMES[providerKey],
        email: profile.email,
        phone: storablePhone,
        // 마케팅 수신은 **선택**이라 소셜 가입에서 자동 동의시키지 않는다.
        // 필요하면 마이페이지에서 켠다 — 안 물어보고 켜면 그게 위법이다
        marketingSmsAgreedAt: null,
        marketingEmailAgreedAt: null,
      })
      .returning({ id: customer.id, name: customer.name });

    await tx.insert(customerAuth).values({
      customerId: createdCustomer.id,
      provider: providerKey,
      providerUid: profile.providerUid,
      passwordHash: null,
    });

    await tx.insert(termsAgreement).values(
      [...latestDocIdByCode.values()].map((termsDocumentId) => ({
        customerId: createdCustomer.id,
        termsDocumentId,
        ip: input.ip ?? null,
      })),
    );

    // 가입 축하 적립 — 로컬 가입과 같은 대우. 같은 트랜잭션이라 실패하면 가입도 되돌아간다
    await earnSignupBonus(tx, createdCustomer.id);

    return {
      customerId: createdCustomer.id,
      name: createdCustomer.name,
      isNewCustomer: true,
      isNewlyLinked: false,
    };
  });
}
