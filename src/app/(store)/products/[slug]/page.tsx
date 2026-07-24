import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ProductDetailTabs } from "@/components/store/product-detail-tabs";
import { ProductPurchasePanel } from "@/components/store/product-purchase-panel";
import { db } from "@/db";
import { getProductDetail } from "@/server/services/product.service";

/**
 * 상품 상세 페이지 — 핸드오프 '상품상세.dc.html'.
 * 데이터는 이 서버 컴포넌트가 서비스에서 조회해 클라이언트 패널·탭에 주입한다(RULE-14 레이어 경계).
 *
 * generateMetadata와 본문이 같은 조회를 쓰므로 React cache로 요청 내 중복 쿼리를 제거한다 —
 * 서비스 파일은 읽기 전용이라 호출부에서 감싼다.
 */
const getProductDetailOncePerRequest = cache(getProductDetail);

type ProductDetailPageProps = {
  // Next 16: params는 Promise — 반드시 await 후 사용
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: ProductDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const productDetail = await getProductDetailOncePerRequest(db, slug);
  // 미존재 slug는 본문에서 notFound() 처리 — 메타데이터는 기본값에 맡긴다
  if (!productDetail) return {};
  return { title: productDetail.name };
}

export default async function ProductDetailPage({
  params,
}: ProductDetailPageProps) {
  const { slug } = await params;
  const productDetail = await getProductDetailOncePerRequest(db, slug);
  if (!productDetail) notFound();

  return (
    // 목업 #pmstore: width min(1280px,100%) · main[data-r=pad] 좌우 16px→40px(≥768)
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-[18px] md:px-10">
      {/* 브레드크럼 — ProductDetail에 카테고리 정보가 없어(서비스 읽기 전용)
          '홈 › 전체 상품 › 상품명'으로 구성. 카테고리 필드 추가 시 중간 단계를 교체한다 */}
      <nav
        aria-label="위치"
        className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link href="/" className="hover:text-primary">
          홈
        </Link>
        <span aria-hidden="true">›</span>
        <Link href="/products" className="hover:text-primary">
          전체 상품
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="font-semibold text-foreground">
          {productDetail.name}
        </span>
      </nav>

      {/* 탭 영역은 2단 그리드와 모바일 구매바 '사이'에 놓여야 해서 슬롯으로 주입한다 */}
      <ProductPurchasePanel productDetail={productDetail}>
        <ProductDetailTabs
          productSummary={productDetail.summary}
          descriptionHtml={productDetail.descriptionHtml}
          detailImages={productDetail.detailImages}
        />
      </ProductPurchasePanel>
    </div>
  );
}
