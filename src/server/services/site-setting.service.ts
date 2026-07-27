import "server-only";

import { eq } from "drizzle-orm";

import { siteSetting } from "@/db/schema";

import type { QueryClient } from "./db-client";

/**
 * 사이트 설정 도메인 모듈.
 *
 * site_setting은 key-value(JSONB) 저장소다. 값의 형태는 key마다 다르므로
 * (business_info·hero·shipping_policy…) 조회 지점마다 캐스팅이 흩어지지 않도록
 * 여기서 타입을 입혀 꺼낸다. 푸터(서버 컴포넌트)·관리자 설정 화면·tRPC가 공유한다.
 *
 * 재판매 리스킨 전제(RULE-11): 상호·사업자 표기는 코드가 아니라 이 테이블에서 온다.
 */

/**
 * 익명(public) tRPC로 노출해도 안전한 설정 키 화이트리스트.
 * siteSetting.get은 publicProcedure라, 이 목록에 없는 키(point_policy·claim_policy·
 * ga4·naver_wcs 등 내부 정책·측정값)를 임의로 읽히면 정보 노출이다.
 * 서버 컴포넌트·서비스는 getSiteSetting/getBusinessInfo로 직접 읽으므로 이 제한과 무관하다.
 */
export const PUBLIC_SITE_SETTING_KEYS = ["business_info", "shipping_policy"] as const;
export type PublicSiteSettingKey = (typeof PUBLIC_SITE_SETTING_KEYS)[number];

/**
 * 전 스토어프론트 푸터에 들어가는 업체 정보.
 * 경계: "업체가 바뀌면 달라지는 푸터 내용" 전부 — 법정 표기(전자상거래 표시 의무) +
 * 고객센터 연락처 + 브랜드 문구. 반면 링크 구성(공지·약관 등)은 라우트라 코드가 소유한다.
 */
export type BusinessInfo = {
  /**
   * 로고·워드마크에 쓰는 브랜드명(예: "PaRaSOL").
   * 법인명(companyName)과 다르다 — 목업은 로고에 "PaRaSOL",
   * 법정 표기에 "상호: 파라솔 협동조합"을 각각 쓴다.
   */
  brandName: string;
  /** 법정 표기 — 전자상거래법상 필수 */
  companyName: string;
  ceoName: string;
  businessNo: string;
  mailOrderNo: string;
  address: string;
  privacyOfficer: string;
  hostingProvider: string;
  /** 고객센터 */
  csPhone: string;
  csHours: string[];
  csEmail?: string;
  /** 브랜드 문구 */
  brandTagline: string;
  copyrightNotice: string;
};

/**
 * 시드가 없어도 푸터가 법정 표기 자리를 잃지 않도록 하는 안전값.
 * 실제 값은 site_setting에서 오며(재판매 리스킨), 이 값은 개발 초기·설정 누락 시에만 쓰인다.
 */
export const FALLBACK_BUSINESS_INFO: BusinessInfo = {
  brandName: "(브랜드명 미설정)",
  companyName: "(사업자 정보 미설정)",
  ceoName: "-",
  businessNo: "-",
  mailOrderNo: "-",
  address: "-",
  privacyOfficer: "-",
  hostingProvider: "-",
  csPhone: "-",
  csHours: ["고객센터 운영시간 미설정"],
  brandTagline: "",
  copyrightNotice: "",
};

type SiteSettingValueByKey = {
  business_info: BusinessInfo;
};

/**
 * key로 설정값 1건을 꺼낸다. 없으면 null.
 * 제네릭 K로 알려진 key는 반환 타입이 좁혀지고, 그 외 key는 unknown이다.
 */
export async function getSiteSetting<K extends keyof SiteSettingValueByKey>(
  database: QueryClient,
  settingKey: K,
): Promise<SiteSettingValueByKey[K] | null>;
export async function getSiteSetting(
  database: QueryClient,
  settingKey: string,
): Promise<unknown>;
export async function getSiteSetting(
  database: QueryClient,
  settingKey: string,
): Promise<unknown> {
  const [row] = await database
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, settingKey))
    .limit(1);

  return row?.value ?? null;
}

/**
 * 푸터 전용 조회 — 설정이 없거나 비어 있어도 렌더가 깨지지 않도록 기본값으로 메운다.
 * 푸터는 전 화면 필수(RULE-11)라 "값이 없으면 안 그린다"는 선택지가 없다.
 */
export async function getBusinessInfo(
  database: QueryClient,
): Promise<BusinessInfo> {
  const stored = await getSiteSetting(database, "business_info");
  if (!stored || typeof stored !== "object") return FALLBACK_BUSINESS_INFO;

  return { ...FALLBACK_BUSINESS_INFO, ...(stored as Partial<BusinessInfo>) };
}
