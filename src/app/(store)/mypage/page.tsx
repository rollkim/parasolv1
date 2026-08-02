import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MypageView } from "@/components/store/mypage-view";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getCustomerSessionProfile } from "@/server/services/customer.service";

/**
 * 마이페이지 — 핸드오프 'PaRaSOL 마이페이지.dc.html'.
 * 회원 전용이라 서버에서 세션을 가드한다(위시리스트와 동일 기준).
 * 프로필·배송지 조회와 수정은 클라이언트 컴포넌트(MypageView)가 tRPC로 수행한다.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - 목업의 축약 헤더(로고행)는 렌더하지 않는다 — 공통 셸(StoreHeader)이 (store) 레이아웃에서 부착된다.
 *  - 목업은 섹션별 h1을 쓰지만 문서 h1은 하나여야 한다 — 페이지가 sr-only h1을 소유하고 섹션은 h2.
 */
export const metadata: Metadata = { title: "마이페이지" };

export default async function MypagePage() {
  // 쿠키가 유효해도 탈퇴·비활성 계정이면 비로그인으로 취급한다 — 셸 유틸바(레이아웃)와 동일 기준
  const sessionCustomerId = await readSessionCustomerId();
  const sessionProfile =
    sessionCustomerId !== null
      ? await getCustomerSessionProfile(db, sessionCustomerId)
      : null;
  if (!sessionProfile) redirect("/login?next=/mypage");

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-14 md:px-10">
      <h1 className="sr-only">마이페이지</h1>
      <MypageView />
    </div>
  );
}
