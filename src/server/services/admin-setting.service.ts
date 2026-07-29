import "server-only";

import { sql } from "drizzle-orm";

import { siteSetting } from "@/db/schema";

import type { DatabaseClient } from "./db-client";
import { serializeActor, type TransitionActor } from "./order-status.service";
import {
  FALLBACK_BUSINESS_INFO,
  getSiteSetting,
  type BusinessInfo,
} from "./site-setting.service";

/**
 * 관리자 설정 — site_setting(key-value JSONB)을 화면이 다룰 수 있는 형태로 묶는다.
 *
 * **키를 화면이 정하게 두지 않는다.** site_setting은 아무 키나 쓸 수 있는 저장소라,
 * 관리자 화면이 임의 키를 쓰면 오타 하나로 "저장은 됐는데 아무 데도 안 읽히는 값"이 생긴다.
 * 여기 정의된 키 묶음만 읽고 쓴다.
 *
 * **PG 시크릿·API 키는 여기 없다.** 서버 env가 소유한다(RULE-11) — DB에 평문으로 두면
 * 관리자 화면 하나만 뚫려도 결제 키가 나간다. 측정 ID(GA·네이버)는 어차피 클라이언트
 * 번들에 실리는 공개 값이라 여기서 관리한다.
 */

/** 배송 정책 — 주문·클레임이 함께 읽는 값(shipping-policy.service가 소비) */
export type ShippingPolicySetting = {
  baseFee: number;
  freeThreshold: number;
  /** 도서·산간 추가 배송비 */
  remoteSurcharge: number;
};

/** 상품 상세·주문·푸터에 노출되는 정책 안내 문구 */
export type PolicyTextSetting = {
  shippingNotice: string;
  returnNotice: string;
  exchangeNotice: string;
};

/** 측정 ID — 공개 값만 둔다 */
export type AnalyticsSetting = {
  ga4MeasurementId: string;
  naverWcsId: string;
};

export type AdminSettingBundle = {
  businessInfo: BusinessInfo;
  shippingPolicy: ShippingPolicySetting;
  policyText: PolicyTextSetting;
  analytics: AnalyticsSetting;
  /** 화면이 "왜 여기 없는지" 답할 수 있게 */
  serverManagedKeys: { label: string; reason: string }[];
};

const DEFAULT_SHIPPING_POLICY: ShippingPolicySetting = {
  baseFee: 3000,
  freeThreshold: 30000,
  remoteSurcharge: 3000,
};

const DEFAULT_POLICY_TEXT: PolicyTextSetting = {
  shippingNotice: "",
  returnNotice: "",
  exchangeNotice: "",
};

const DEFAULT_ANALYTICS: AnalyticsSetting = { ga4MeasurementId: "", naverWcsId: "" };

/** 관리자 화면에 두면 안 되는 값 — 왜 없는지 밝혀야 운영자가 찾아 헤매지 않는다 */
export const SERVER_MANAGED_KEYS: { label: string; reason: string }[] = [
  {
    label: "토스페이먼츠 시크릿 키",
    reason: "서버 환경변수(TOSS_SECRET_KEY)가 소유합니다.",
  },
  {
    label: "소셜 로그인 시크릿",
    reason: "카카오·네이버·구글 시크릿은 서버 환경변수에만 둡니다.",
  },
  {
    label: "알림톡 API 키",
    reason: "솔라피 키는 서버 환경변수가 소유합니다.",
  },
];

/** 저장된 값에 기본값을 덮어 형태를 보장한다 — 키가 없거나 일부만 있어도 화면이 깨지지 않게 */
function mergeSetting<T extends object>(stored: unknown, fallback: T): T {
  if (!stored || typeof stored !== "object") return fallback;
  return { ...fallback, ...(stored as Partial<T>) };
}

export async function getAdminSettings(database: DatabaseClient): Promise<AdminSettingBundle> {
  const [businessRaw, shippingRaw, policyRaw, analyticsRaw] = [
    await getSiteSetting(database, "business_info"),
    await getSiteSetting(database, "shipping_policy"),
    await getSiteSetting(database, "policy_text"),
    await getSiteSetting(database, "analytics"),
  ];

  return {
    businessInfo: mergeSetting(businessRaw, FALLBACK_BUSINESS_INFO),
    shippingPolicy: mergeSetting(shippingRaw, DEFAULT_SHIPPING_POLICY),
    policyText: mergeSetting(policyRaw, DEFAULT_POLICY_TEXT),
    analytics: mergeSetting(analyticsRaw, DEFAULT_ANALYTICS),
    serverManagedKeys: SERVER_MANAGED_KEYS,
  };
}

/** 한 키를 통째로 덮어쓴다(부분 갱신이 아니라 화면이 보낸 전체가 진실) */
async function upsertSetting(
  database: DatabaseClient,
  settingKey: string,
  value: unknown,
  actorText: string,
): Promise<void> {
  await database
    .insert(siteSetting)
    .values({ key: settingKey, value, createdBy: actorText, updatedBy: actorText })
    .onConflictDoUpdate({
      target: siteSetting.key,
      set: { value, updatedBy: actorText, updatedAt: sql`now()` },
    });
}

export async function saveAdminBusinessInfo(
  database: DatabaseClient,
  input: { businessInfo: BusinessInfo; actor: TransitionActor },
): Promise<{ saved: true }> {
  await upsertSetting(database, "business_info", input.businessInfo, serializeActor(input.actor));
  return { saved: true };
}

export class ShippingPolicyInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShippingPolicyInvalidError";
  }
}

/**
 * 배송 정책 저장. **주문 금액과 클레임 배송비가 이 값에서 나온다** — 음수나
 * 뒤집힌 임계값이 들어가면 주문서 금액이 이상해지므로 저장 전에 거른다.
 */
export async function saveAdminShippingPolicy(
  database: DatabaseClient,
  input: { shippingPolicy: ShippingPolicySetting; actor: TransitionActor },
): Promise<{ saved: true }> {
  const { baseFee, freeThreshold, remoteSurcharge } = input.shippingPolicy;
  if (baseFee < 0 || freeThreshold < 0 || remoteSurcharge < 0) {
    throw new ShippingPolicyInvalidError("배송비와 무료배송 기준은 0원 이상이어야 합니다.");
  }
  // 무료 기준이 0이면 '항상 무료'라는 뜻이라 허용한다. 다만 배송비보다 작은 양수는 실수다
  if (freeThreshold > 0 && freeThreshold < baseFee) {
    throw new ShippingPolicyInvalidError(
      "무료배송 기준이 배송비보다 낮습니다. 기준 금액을 다시 확인해 주세요.",
    );
  }

  await upsertSetting(
    database,
    "shipping_policy",
    input.shippingPolicy,
    serializeActor(input.actor),
  );
  return { saved: true };
}

export async function saveAdminPolicyText(
  database: DatabaseClient,
  input: { policyText: PolicyTextSetting; actor: TransitionActor },
): Promise<{ saved: true }> {
  await upsertSetting(database, "policy_text", input.policyText, serializeActor(input.actor));
  return { saved: true };
}

export async function saveAdminAnalytics(
  database: DatabaseClient,
  input: { analytics: AnalyticsSetting; actor: TransitionActor },
): Promise<{ saved: true }> {
  await upsertSetting(database, "analytics", input.analytics, serializeActor(input.actor));
  return { saved: true };
}
