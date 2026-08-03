import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MypageView } from "@/components/store/mypage-view";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getCustomerSessionProfile } from "@/server/services/customer.service";

/**
 * 보유 쿠폰 — 헤더·모바일 드로어의 '쿠폰' 링크가 여기로 온다(그동안 404였다).
 *
 * 마이페이지와 같은 화면을 쿠폰 섹션이 열린 상태로 그린다. 별도 화면으로 만들지 않는 이유:
 * 쿠폰만 보러 온 사람도 곧 적립금·주문을 보므로, 섹션 내비가 있는 편이 오가기 쉽다.
 * URL을 따로 둔 것은 링크를 공유·북마크할 수 있어야 하기 때문이다.
 */
export const metadata: Metadata = { title: "쿠폰" };

export default async function MypageCouponsPage() {
  // 쿠키가 유효해도 탈퇴·비활성 계정이면 비로그인으로 취급한다 — 마이페이지와 동일 기준
  const sessionCustomerId = await readSessionCustomerId();
  const sessionProfile =
    sessionCustomerId !== null
      ? await getCustomerSessionProfile(db, sessionCustomerId)
      : null;
  if (!sessionProfile) redirect("/login?next=/mypage/coupons");

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 pb-14 md:px-10">
      <h1 className="sr-only">보유 쿠폰</h1>
      <MypageView initialSection="coupons" />
    </div>
  );
}
