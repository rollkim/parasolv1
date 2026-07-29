import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MyReviewView } from "@/components/store/my-review-view";
import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { getCustomerSessionProfile } from "@/server/services/customer.service";

/**
 * 내 리뷰 — 리뷰 쓸 상품 목록 + 작성 폼 + 내가 쓴 리뷰.
 * 리뷰는 계정에 귀속되는 발언이라 회원 전용이다(마이페이지와 같은 가드).
 */
export const metadata: Metadata = { title: "내 리뷰" };

export default async function MyReviewsPage() {
  const sessionCustomerId = await readSessionCustomerId();
  const sessionProfile =
    sessionCustomerId !== null
      ? await getCustomerSessionProfile(db, sessionCustomerId)
      : null;
  if (!sessionProfile) redirect("/login");

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pt-4 pb-14 md:px-10">
      <h1 className="m-0 mb-5 font-heading text-xl font-extrabold">내 리뷰</h1>
      <MyReviewView />
    </div>
  );
}
