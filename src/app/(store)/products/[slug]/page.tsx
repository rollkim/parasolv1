import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, cache } from "react";

import { ProductDetailTabs } from "@/components/store/product-detail-tabs";
import { ProductPurchasePanel } from "@/components/store/product-purchase-panel";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
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
      {/* 브레드크럼 — 홈 › 대분류 › 중분류 › 상품명.
          목업(L147~151)은 카테고리 한 단계만 보여주지만 상위까지 펴서 넣는다 —
          한 단계만 있으면 그게 대분류인지 중분류인지 알 수 없어 되짚어 올라갈 수가 없다.
          카테고리가 없는 상품은 '전체 상품'으로 대신한다(빈 칸을 남기지 않는다) */}
      <nav
        aria-label="위치"
        className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link href="/" className="hover:text-primary">
          홈
        </Link>
        {productDetail.categoryPath.length === 0 ? (
          <>
            <span aria-hidden="true">›</span>
            <Link href="/products" className="hover:text-primary">
              전체 상품
            </Link>
          </>
        ) : (
          productDetail.categoryPath.map((categoryStep) => (
            <Fragment key={categoryStep.slug}>
              <span aria-hidden="true">›</span>
              <Link
                href={`/products?category=${categoryStep.slug}`}
                className="hover:text-primary"
              >
                {categoryStep.name}
              </Link>
            </Fragment>
          ))
        )}
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="font-semibold text-foreground">
          {productDetail.name}
        </span>
      </nav>

      {/* 탭 영역은 2단 그리드와 모바일 구매바 '사이'에 놓여야 해서 슬롯으로 주입한다 */}
      <ProductPurchasePanel productDetail={productDetail}>
        <ProductDetailTabs
          productSummary={productDetail.summary}
          descriptionText={productDetail.descriptionText}
          detailImages={productDetail.detailImages}
          productId={productDetail.productId}
          // 비회원 문의는 이름·연락처·비밀번호가 더 필요하다 — 로그인 여부는 서버가 판단한다
          isMember={(await readSessionCustomerId()) !== null}
        />
      </ProductPurchasePanel>
    </div>
  );
}
