// 핸드오프 규격: PaRaSOL 단체구매문의.dc.html — 인트로 + 문의 폼(최대폭 720px)

import type { Metadata } from "next";

import { BulkInquiryForm } from "@/components/store/bulk-inquiry-form";

export const metadata: Metadata = {
  title: "단체구매 문의",
  description: "명절 선물세트·기업 답례품·단체 구매 견적을 문의하실 수 있습니다.",
};

export default function BulkInquiryPage() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-[26px] pb-14 md:px-10">
      <h1 className="m-0 mb-2 font-heading text-[clamp(22px,3.2vw,28px)] font-extrabold tracking-[-0.01em]">
        단체구매 문의
      </h1>
      <p className="m-0 mb-7 text-[15px] leading-[1.7] text-pretty text-muted-foreground">
        명절 선물세트, 기업 답례품, 단체 구매를 준비하고 계신가요? 수량과 예산을 알려주시면
        담당자가 구성과 견적을 제안해 드립니다.
      </p>

      <BulkInquiryForm />
    </div>
  );
}
