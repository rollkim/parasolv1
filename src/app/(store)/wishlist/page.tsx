import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WishlistView } from "@/components/store/wishlist-view";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getCustomerSessionProfile } from "@/server/services/customer.service";

/**
 * 찜 목록 페이지 — 핸드오프 'PaRaSOL 위시리스트.dc.html'.
 * 찜은 회원 전용이라 서버에서 세션을 가드한다 — 클라이언트 가드만으로는
 * 비로그인 상태에서 protectedProcedure 오류 화면이 먼저 노출된다.
 * 목록 조회·해제·선택 삭제는 클라이언트 컴포넌트(WishlistView)가 tRPC로 수행한다.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - 목업의 축약 헤더(로고행)는 렌더하지 않는다 — 공통 셸(StoreHeader)이 (store) 레이아웃에서 부착된다(장바구니 선례).
 */
export const metadata: Metadata = { title: "찜한 상품" };

export default async function WishlistPage() {
  // 쿠키가 유효해도 탈퇴·비활성 계정이면 비로그인으로 취급한다 — 셸 유틸바(레이아웃)와 동일 기준
  const sessionCustomerId = await readSessionCustomerId();
  const sessionProfile =
    sessionCustomerId !== null
      ? await getCustomerSessionProfile(db, sessionCustomerId)
      : null;
  if (!sessionProfile) redirect("/login?next=/wishlist");

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-10 md:px-10">
      <WishlistView />
    </div>
  );
}
