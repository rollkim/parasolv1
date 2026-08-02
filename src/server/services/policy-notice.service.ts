import "server-only";

import { formatKrw } from "@/lib/format";

import type { DatabaseClient } from "./db-client";
import { loadShippingPolicy } from "./shipping-policy.service";
import { getSiteSetting } from "./site-setting.service";

/**
 * 스토어에 노출되는 정책 안내 문구 — 상품 상세 '배송·교환/반품' 탭이 소비한다.
 *
 * **금액을 화면에 적지 않기 위해 존재한다.** 배송비·무료 기준은 site_setting이 진실원인데
 * 화면이 "3,000원 (3만원 이상 무료)"라고 적어 두면 관리자가 정책을 바꿔도 안내만 옛날 값으로
 * 남는다 — 고객은 안내를 믿고 주문하는데 결제창 금액이 다르다(RULE-11 리스킨 전제).
 *
 * 관리자가 문구를 직접 쓰면 그 문구가 이긴다. 비워 두면 정책 숫자로 문장을 조립한다 —
 * 새 몰이 문구를 아직 안 채웠어도 빈 칸이 보이지 않는다.
 */

export type StorePolicyNotice = {
  shippingNotice: string;
  returnNotice: string;
  exchangeNotice: string;
};

const DEFAULT_RETURN_NOTICE =
  "상품 수령 후 7일 이내에 교환·반품을 신청하실 수 있습니다. 단순 변심의 경우 왕복 배송비가 부과되며, 상품 하자·오배송은 판매자가 부담합니다.";

const DEFAULT_EXCHANGE_NOTICE =
  "포장을 개봉해 상품 가치가 훼손된 경우, 시간이 지나 재판매가 어려운 경우에는 교환·반품이 제한될 수 있습니다. 자세한 사항은 고객센터로 문의해 주세요.";

/** 저장된 문구가 공백뿐이면 '없는 것'으로 본다 — 관리자가 지웠을 때 빈 문단이 남지 않게 */
function pickText(stored: unknown, key: keyof StorePolicyNotice): string {
  if (!stored || typeof stored !== "object") return "";
  const value = (stored as Partial<Record<keyof StorePolicyNotice, unknown>>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function loadStorePolicyNotice(
  database: DatabaseClient,
): Promise<StorePolicyNotice> {
  const [storedText, shippingPolicy] = [
    await getSiteSetting(database, "policy_text"),
    await loadShippingPolicy(database),
  ];

  const writtenShipping = pickText(storedText, "shippingNotice");
  const composedShipping =
    shippingPolicy.freeThreshold === 0
      ? "택배로 배송됩니다. 전 상품 무료배송입니다."
      : shippingPolicy.baseFee === 0
        ? "택배로 배송됩니다. 배송비는 무료입니다."
        : `택배로 배송됩니다. 기본 배송비 ${formatKrw(shippingPolicy.baseFee)}이며, ${formatKrw(shippingPolicy.freeThreshold)} 이상 구매 시 무료입니다.`;

  return {
    shippingNotice: writtenShipping || composedShipping,
    returnNotice: pickText(storedText, "returnNotice") || DEFAULT_RETURN_NOTICE,
    exchangeNotice: pickText(storedText, "exchangeNotice") || DEFAULT_EXCHANGE_NOTICE,
  };
}
