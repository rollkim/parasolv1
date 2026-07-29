import "server-only";

import type { ShippingPolicy } from "@/domain/cart";

import type { QueryClient } from "./db-client";
import { getSiteSetting } from "./site-setting.service";

/**
 * 배송 정책 조달 — site_setting이 원천이고, 없거나 형태가 깨지면 안전값을 쓴다.
 *
 * 주문 생성(배송비 계산)과 클레임(반품·교환 배송비 = 기본 배송비 × 배수)이 함께 쓴다.
 * 두 곳이 각자 읽으면 기본값이 갈리므로 한 모듈에 둔다(RULE-14).
 * 정책값을 코드에 복사하지 않는 것이 요점이다 — 배송비를 바꾸면 클레임 배송비도 따라간다.
 */

const DEFAULT_SHIPPING_POLICY: ShippingPolicy = {
  baseFee: 3000,
  freeThreshold: 30000,
  remoteSurcharge: 0,
};

export async function loadShippingPolicy(client: QueryClient): Promise<ShippingPolicy> {
  const stored = await getSiteSetting(client, "shipping_policy");
  if (stored && typeof stored === "object") {
    const candidate = stored as Partial<ShippingPolicy>;
    if (
      typeof candidate.baseFee === "number" &&
      typeof candidate.freeThreshold === "number"
    ) {
      return {
        baseFee: candidate.baseFee,
        freeThreshold: candidate.freeThreshold,
        // 설정에 없으면 0 — 값을 넣지 않은 몰에 갑자기 추가비가 붙으면 안 된다
        remoteSurcharge:
          typeof candidate.remoteSurcharge === "number" ? candidate.remoteSurcharge : 0,
      };
    }
  }
  return DEFAULT_SHIPPING_POLICY;
}
