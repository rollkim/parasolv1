import type { Metadata } from "next";

import { AdminCouponView } from "@/components/admin/admin-coupon-view";

/** 쿠폰 관리 — 발급 현황·등록·수정·사용 중지. 그동안 죽은 메뉴였다 */
export const metadata: Metadata = { title: "쿠폰" };
export const dynamic = "force-dynamic";

export default function AdminCouponsPage() {
  return <AdminCouponView />;
}
