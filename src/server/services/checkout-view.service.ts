import "server-only";

import { createHmac } from "node:crypto";

import type { ShippingPolicy } from "@/domain/cart";

import type { CartView } from "./cart.service";
import { getCartWithItems } from "./cart.service";
import { listCheckoutCoupons, type CheckoutCouponOption } from "./coupon.service";
import { getPointBalance, getUsablePointBalance } from "./point.service";
import { loadPointPolicy } from "./point-policy.service";
import { loadShippingPolicy } from "./shipping-policy.service";
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
   * 적립금 — 회원만. **usableBalance가 결제에 쓸 수 있는 금액**이다(만료분 제외).
   * balance(보유)는 안내용 — 소멸 배치가 돌기 전 만료분이 섞여 있어 이 값으로 검증하면
   * "있다고 나오는데 안 된다"가 된다.
   * 사용 규칙(최소액·단위)도 함께 내린다 — 화면이 숫자를 따로 적으면 정책을 바꿀 때 갈라진다.
   */
  point: {
    balance: number;
    usableBalance: number;
    minUsePoint: number;
    useUnitPoint: number;
  } | null;
  /**
   * 이 주문에 쓸 수 있는 쿠폰 — 회원만. **할인액을 서버가 미리 계산해 내린다**:
   * 화면이 계산하면 주문 생성이 다시 계산한 값과 갈려 결제 금액이 달라진다.
   * 못 쓰는 쿠폰도 사유와 함께 온다 — 목록에서 지우면 "쿠폰이 있었는데 안 보인다"가 된다.
   */
  coupons: CheckoutCouponOption[];
  /**
   * 배송 정책 — 화면이 **도서·산간 추가비를 같은 도메인 함수로** 계산하기 위해 필요하다.
   * 주소는 화면에서 정해지므로 카트 요약(주소를 모르는 값)만으로는 결제액을 그릴 수 없다.
   * 계산식은 domain/cart의 calcShippingFeeForAddress 하나뿐이라 서버와 갈라지지 않는다.
   */
  shippingPolicy: ShippingPolicy;
  /**
   * 토스 클라이언트 키 — 브라우저로 나가도 되는 공개 키다.
   * 시크릿 키는 서버에만 둔다(RULE-11). 미발급이면 null이고 화면은 준비중을 표시한다.
   */
  tossClientKey: string | null;
  /**
   * 결제 UI 방식. 결제위젯은 별도 이용 신청이 필요해(운영 사이트 심사) 1차는 결제창으로 간다.
   * 위젯 키를 받으면 env 한 줄(NEXT_PUBLIC_TOSS_UI_MODE)만 바꿔 전환한다 —
   * 서버 승인·취소 경로는 두 방식이 완전히 동일하므로 바뀌는 것은 화면뿐이다.
   */
  tossPaymentUiMode: TossPaymentUiMode;
  /**
   * 토스 customerKey — 2~300자, 특수문자 1개 이상, **추측 불가**여야 한다(문서 규격).
   * 이메일·전화·회원 id를 그대로 쓰면 안 되므로 서버 시크릿으로 파생한다.
   * 비회원은 문서가 허용하는 ANONYMOUS.
   */
  tossCustomerKey: string;
  /** 결제창에 표시될 주문명 — "상품명 외 N건" */
  orderName: string;
};

/** 결제 UI 방식 — 위젯 키를 받으면 env로 전환한다 */
export type TossPaymentUiMode = "window" | "widget";

function resolvePaymentUiMode(): TossPaymentUiMode {
  return process.env.NEXT_PUBLIC_TOSS_UI_MODE === "widget" ? "widget" : "window";
}

/**
 * customerKey 파생 — 회원 id를 그대로 노출하지 않으면서 회원마다 안정적인 값을 만든다.
 * 서버 시크릿으로 HMAC을 걸어 추측을 막고, base64url이라 허용 문자(-, _)만 나온다.
 * 끝에 "-p"를 붙여 "특수문자 1개 이상" 규격을 항상 만족시킨다.
 */
function deriveTossCustomerKey(customerId: number | null): string {
  if (customerId === null) return "ANONYMOUS";
  const secret = process.env.AUTH_SECRET ?? "";
  const digest = createHmac("sha256", secret)
    .update(`toss-customer:${customerId}`)
    .digest("base64url");
  return `${digest.slice(0, 40)}-p`;
}

/** 결제창에 뜨는 주문명 — 너무 길면 PG가 자르므로 대표 품목 + 건수로 줄인다 */
function buildOrderName(cart: CartView): string {
  const orderableLines = cart.lines.filter((line) => !line.unavailable && !line.soldOut);
  const leadName = orderableLines[0]?.productName ?? "주문";
  return orderableLines.length > 1
    ? `${leadName} 외 ${orderableLines.length - 1}건`
    : leadName;
}

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
  const shippingPolicy = await loadShippingPolicy(database);

  if (input.customerId === null) {
    return {
      isMember: false,
      cart,
      ordererPrefill: toOrdererPrefill(null),
      addresses: [],
      // 비회원은 적립금을 쓸 수 없다 — 잔액이 귀속될 회원이 없다
      point: null,
      coupons: [],
      terms,
      shippingPolicy,
      tossClientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null,
      tossPaymentUiMode: resolvePaymentUiMode(),
      tossCustomerKey: deriveTossCustomerKey(null),
      orderName: buildOrderName(cart),
    };
  }

  const profile = await getMyProfile(database, input.customerId);
  const addresses = await listMyAddresses(database, input.customerId);
  const pointPolicy = await loadPointPolicy(database);
  const [pointBalance, usablePointBalance] = [
    await getPointBalance(database, input.customerId),
    await getUsablePointBalance(database, input.customerId),
  ];
  // 주문 가능한 라인만 기준으로 판정한다 — 품절 라인이 최소주문금액을 채우면 안 된다
  const coupons = await listCheckoutCoupons(database, {
    customerId: input.customerId,
    lines: cart.lines
      .filter((line) => !line.unavailable && !line.soldOut)
      .map((line) => ({ productId: line.productId, lineTotal: line.lineTotal })),
  });

  return {
    isMember: true,
    cart,
    ordererPrefill: toOrdererPrefill(profile),
    addresses,
    point: {
      balance: pointBalance,
      usableBalance: usablePointBalance,
      minUsePoint: pointPolicy.minUsePoint,
      useUnitPoint: pointPolicy.useUnitPoint,
    },
    coupons,
    terms,
    shippingPolicy,
    tossClientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? null,
    tossPaymentUiMode: resolvePaymentUiMode(),
    tossCustomerKey: deriveTossCustomerKey(input.customerId),
    orderName: buildOrderName(cart),
  };
}
