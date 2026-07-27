import "server-only";

import type { CartView } from "./cart.service";
import { getCartWithItems } from "./cart.service";
import {
  listMyAddresses,
  getMyProfile,
  type CustomerAddress,
  type MyProfile,
} from "./customer.service";
import type { DatabaseClient } from "./db-client";
import { getTermsDocuments, type TermsDocumentSummary } from "./terms.service";

/**
 * 체크아웃 진입 데이터 — 한 번에 내린다.
 *
 * 카트 요약·주문자 프리필·배송지 목록·약관 목록이 서로 다른 라우터에 흩어져 있어
 * 화면이 4번 왕복하고, 회원 전용 프로시저는 비회원에게 401을 던져 조건부 호출이 필요했다.
 * 진입 데이터는 한 화면의 관심사이므로 조립을 서버가 맡는다(RULE-14).
 */

export type CheckoutOrderer = {
  name: string;
  phone: string;
  email: string;
};

export type CheckoutView = {
  /** 로그인 상태 — 화면의 회원/비회원 세그먼트 초기값 */
  isMember: boolean;
  cart: CartView;
  /** 회원이면 프로필에서 채운 값, 비회원이면 빈 문자열 */
  ordererPrefill: CheckoutOrderer;
  /** 회원 배송지 — 기본 배송지가 맨 위. 비회원이거나 저장분이 없으면 빈 배열 */
  addresses: CustomerAddress[];
  /** 동의 대상 약관 — isRequired가 필수 여부의 진실원(화면이 정하지 않는다) */
  terms: TermsDocumentSummary[];
  /**
   * 토스 결제위젯 클라이언트 키 — 브라우저로 나가도 되는 공개 키다.
   * 시크릿 키는 서버에만 둔다(RULE-11). 미발급이면 null이고 화면은 준비중을 표시한다.
   */
  tossClientKey: string | null;
};

function toOrdererPrefill(profile: MyProfile | null): CheckoutOrderer {
  return {
    name: profile?.name ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
  };
}

/**
 * 마케팅 수신 동의 — 필수가 아니지만 주문 시 받는 유일한 선택 동의다.
 * terms_document에는 "어느 맥락에서 동의받는 문서인가"를 구분하는 값이 없어,
 * 배송·교환·반품 안내 같은 열람용 문서까지 동의 체크박스로 나오는 문제가 있다.
 * 구분 컬럼(consent_scope) 추가 제안은 미결 체크리스트 참조 — 그전까지는 이 규칙을 쓴다.
 */
const OPTIONAL_CHECKOUT_CONSENT_CODES = ["marketing"];

/** 주문 시 동의받을 문서 = 필수 전부 + 위 선택 동의. 안내 문서는 제외한다 */
function isCheckoutConsent(termsDoc: TermsDocumentSummary): boolean {
  return termsDoc.isRequired || OPTIONAL_CHECKOUT_CONSENT_CODES.includes(termsDoc.termsCode);
}

export async function getCheckoutView(
  database: DatabaseClient,
  input: { cartToken: string | null; customerId: number | null },
): Promise<CheckoutView> {
  const cart = await getCartWithItems(database, input.cartToken);
  const terms = (await getTermsDocuments(database)).filter(isCheckoutConsent);

  if (input.customerId === null) {
    return {
      isMember: false,
      cart,
      ordererPrefill: toOrdererPrefill(null),
      addresses: [],
      terms,
      tossClientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null,
    };
  }

  const profile = await getMyProfile(database, input.customerId);
  const addresses = await listMyAddresses(database, input.customerId);

  return {
    isMember: true,
    cart,
    ordererPrefill: toOrdererPrefill(profile),
    addresses,
    terms,
    tossClientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null,
  };
}
