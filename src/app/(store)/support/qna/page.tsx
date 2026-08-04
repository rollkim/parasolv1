// 핸드오프 규격: PaRaSOL 1대1문의.dc.html — h1 "1:1 문의" · 본문 최대폭 720px.
// 폼 실측 규격·검증·제출은 클라이언트 컴포넌트(qna-form.tsx)가 소유한다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - '문의하기/문의 내역' 탭 — 내역은 회원(세션)·비회원(연락처+비밀번호) 모두 지원.
//
// 서버 셸의 역할: 회원/비회원 판별 + qna_type 목록 주입.
// 판별 기준은 auth.sessionInfo와 동일 — 쿠키 해석에 그치지 않고 프로필까지 확인해
// 탈퇴·비활성 계정(쿠키는 유효)을 비회원으로 취급한다((store) 레이아웃 선례).

import type { Metadata } from "next";

import { QnaView } from "@/components/store/qna-view";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getActiveCommonCodes } from "@/server/services/common-code.service";
import { getCustomerSessionProfile } from "@/server/services/customer.service";

export const metadata: Metadata = { title: "1:1 문의" };

export default async function QnaPage() {
  const sessionCustomerId = await readSessionCustomerId();

  const [sessionProfile, qnaTypeOptions] = await Promise.all([
    sessionCustomerId !== null
      ? getCustomerSessionProfile(db, sessionCustomerId)
      : null,
    getActiveCommonCodes(db, "qna_type"),
  ]);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-14 md:px-10">
      <h1 className="m-0 mb-[18px] font-heading text-[22px] font-extrabold">
        1:1 문의
      </h1>
      <QnaView
        qnaTypeOptions={qnaTypeOptions}
        memberName={sessionProfile?.name ?? null}
      />
    </div>
  );
}
