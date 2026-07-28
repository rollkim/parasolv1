import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClaimRequestView } from "@/components/store/claim-request-view";
import { claimTypeLabel, type ClaimType } from "@/domain/claim";

/**
 * 클레임 신청 — 핸드오프 '주문상세.dc.html'의 교환/반품 모드 및 취소 모달.
 *
 * 목업은 주문상세 화면 안에서 모드를 전환하지만 별도 경로로 둔다 — URL이 상태를 담아
 * 뒤로가기·새로고침·공유가 자연스럽고, 취소·교환·반품이 한 컴포넌트로 모인다.
 */
const CLAIM_TYPES = ["cancel", "exchange", "return"] as const;

function parseClaimType(raw: string | undefined): ClaimType | null {
  return CLAIM_TYPES.find((claimType) => claimType === raw) ?? null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}): Promise<Metadata> {
  const claimType = parseClaimType((await searchParams).type);
  return { title: claimType ? `${claimTypeLabel(claimType)} 신청` : "클레임 신청" };
}

export default async function ClaimRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderNo: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { orderNo } = await params;
  const claimType = parseClaimType((await searchParams).type);
  if (!/^\d{8}-\d{4,}$/.test(orderNo) || claimType === null) notFound();

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-[18px] pb-10 md:px-10">
      <h1 className="m-0 font-heading text-[clamp(20px,2.6vw,24px)] font-extrabold">
        {claimTypeLabel(claimType)} 신청
      </h1>
      <p className="m-0 mt-1 text-[13px] text-muted-foreground">주문번호 {orderNo}</p>

      <ClaimRequestView orderNo={orderNo} claimType={claimType} />
    </div>
  );
}
