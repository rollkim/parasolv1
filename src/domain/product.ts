/**
 * 상품 도메인 규칙 — DB·화면에 무관한 순수 계산.
 * 스토어프론트·관리자·배치가 같은 규칙을 공유한다(RULE-14).
 */

/** 할인율(%) — 정가가 없거나 판매가보다 낮으면 null(표시 안 함) */
export function discountRate(
  sellingPrice: number,
  compareAtPrice: number | null,
): number | null {
  if (!compareAtPrice || compareAtPrice <= sellingPrice) return null;
  return Math.round((1 - sellingPrice / compareAtPrice) * 100);
}

/** 리뷰 평균 별점 — 집계 캐시(ratingSum/reviewCount)에서 소수 1자리 */
export function ratingAverage(ratingSum: number, reviewCount: number): number | null {
  if (reviewCount <= 0) return null;
  return Math.round((ratingSum / reviewCount) * 10) / 10;
}

export type VariantOptionMatch = {
  variantId: number;
  optionValueIds: number[];
};

/**
 * 선택한 옵션값 조합으로 variant를 확정한다 — 상품상세의 핵심 규칙.
 * 조합이 완성되지 않았거나 일치하는 variant가 없으면 null.
 */
export function findVariantByOptionValues<T extends VariantOptionMatch>(
  variants: T[],
  selectedOptionValueIds: number[],
): T | null {
  if (selectedOptionValueIds.length === 0) return null;
  const selectedSet = new Set(selectedOptionValueIds);

  return (
    variants.find(
      (variant) =>
        variant.optionValueIds.length === selectedSet.size &&
        variant.optionValueIds.every((valueId) => selectedSet.has(valueId)),
    ) ?? null
  );
}
