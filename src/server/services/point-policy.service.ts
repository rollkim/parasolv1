import "server-only";

import type { PointPolicy } from "@/domain/point";

import type { QueryClient } from "./db-client";
import { getSiteSetting } from "./site-setting.service";

/**
 * 적립금 정책 조달 — site_setting이 원천이고, 없거나 형태가 깨지면 안전값을 쓴다.
 *
 * 적립(구매확정·리뷰·가입)·사용(체크아웃)·복원(클레임)·소멸(배치)이 전부 이 값을 본다.
 * 각자 읽으면 기본값이 갈리므로 한 모듈에 둔다 — 배송 정책과 같은 규약(RULE-14).
 *
 * 저장 키는 `earnRate`인데 도메인은 `earnRatePerMille`로 받는다. 10이 1%라는 사실이
 * 이름에 드러나야 계산식을 읽을 때 1000으로 나누는 이유가 보인다.
 */

/**
 * 안전값 — **적립·보너스는 전부 0**이다.
 *
 * 설정이 깨졌을 때 임의의 적립률로 돈을 뿌리면 회수할 수 없다. 반대로 0이면 적립이
 * 안 되는 게 눈에 띄어 바로 고쳐진다. 사용 규칙만 실제 값을 둬 이미 쌓인 적립금은 계속 쓸 수 있다.
 */
const SAFE_POINT_POLICY: PointPolicy = {
  earnRatePerMille: 0,
  expiryDays: 365,
  useUnitPoint: 10,
  minUsePoint: 1000,
  signupBonusPoint: 0,
  reviewBonusPoint: 0,
  photoReviewBonusPoint: 0,
};

/** 설정에 없거나 숫자가 아니면 안전값 — 음수는 받지 않는다(적립이 잔액을 깎으면 안 된다) */
function readNonNegative(candidateValue: unknown, fallback: number): number {
  return typeof candidateValue === "number" &&
    Number.isFinite(candidateValue) &&
    candidateValue >= 0
    ? Math.floor(candidateValue)
    : fallback;
}

export async function loadPointPolicy(client: QueryClient): Promise<PointPolicy> {
  const stored = await getSiteSetting(client, "point_policy");
  if (!stored || typeof stored !== "object") return SAFE_POINT_POLICY;

  const candidate = stored as Record<string, unknown>;
  // 사용 단위 0은 나눗셈을 깨뜨린다 — 1 미만이면 안전값으로 되돌린다
  const useUnitPoint = Math.max(
    1,
    readNonNegative(candidate.useUnitPoint, SAFE_POINT_POLICY.useUnitPoint),
  );

  return {
    earnRatePerMille: readNonNegative(candidate.earnRate, SAFE_POINT_POLICY.earnRatePerMille),
    expiryDays: Math.max(1, readNonNegative(candidate.expiryDays, SAFE_POINT_POLICY.expiryDays)),
    useUnitPoint,
    minUsePoint: readNonNegative(candidate.minUsePoint, SAFE_POINT_POLICY.minUsePoint),
    signupBonusPoint: readNonNegative(
      candidate.signupBonusPoint,
      SAFE_POINT_POLICY.signupBonusPoint,
    ),
    reviewBonusPoint: readNonNegative(
      candidate.reviewBonusPoint,
      SAFE_POINT_POLICY.reviewBonusPoint,
    ),
    photoReviewBonusPoint: readNonNegative(
      candidate.photoReviewBonusPoint,
      SAFE_POINT_POLICY.photoReviewBonusPoint,
    ),
  };
}
