import "server-only";

import { eq } from "drizzle-orm";

import type { db as Database } from "@/db";
import { siteSetting } from "@/db/schema";

/**
 * 사이트 설정 도메인 모듈.
 *
 * site_setting은 key-value(JSONB) 저장소다. 값의 형태는 key마다 다르므로
 * (business_info·hero·shipping_policy…) 조회 지점마다 캐스팅이 흩어지지 않도록
 * 여기서 타입을 입혀 꺼낸다. 푸터(서버 컴포넌트)·관리자 설정 화면·tRPC가 공유한다.
 *
 * 재판매 리스킨 전제(RULE-11): 상호·사업자 표기는 코드가 아니라 이 테이블에서 온다.
 */

/** 전 스토어프론트 푸터에 들어가는 사업자 표기 (전자상거래 표시 의무) */
export type BusinessInfo = {
  companyName: string;
  ceoName: string;
  businessNo: string;
  mailOrderNo: string;
  address: string;
  csPhone: string;
  csEmail: string;
};

type SiteSettingValueByKey = {
  business_info: BusinessInfo;
};

/**
 * key로 설정값 1건을 꺼낸다. 없으면 null.
 * 제네릭 K로 알려진 key는 반환 타입이 좁혀지고, 그 외 key는 unknown이다.
 */
export async function getSiteSetting<K extends keyof SiteSettingValueByKey>(
  database: typeof Database,
  settingKey: K,
): Promise<SiteSettingValueByKey[K] | null>;
export async function getSiteSetting(
  database: typeof Database,
  settingKey: string,
): Promise<unknown>;
export async function getSiteSetting(
  database: typeof Database,
  settingKey: string,
): Promise<unknown> {
  const [row] = await database
    .select({ value: siteSetting.value })
    .from(siteSetting)
    .where(eq(siteSetting.key, settingKey))
    .limit(1);

  return row?.value ?? null;
}
