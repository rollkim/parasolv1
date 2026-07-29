import { TRPCError } from "@trpc/server";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { readSessionCustomerId } from "@/server/auth/session";
import { assertReviewUploadAllowed } from "@/server/security/rate-limit";
import { getCustomerSessionProfile } from "@/server/services/customer.service";
import {
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
  storeProductImage,
  UnsupportedImageTypeError,
} from "@/server/services/image-storage.service";

/**
 * 리뷰 사진 업로드 — 회원 전용.
 *
 * 관리자 업로드와 라우트를 나눈 이유: 권한이 다르다. 관리자 라우트를 회원에게 열면
 * 상품·배너 폴더에도 올릴 수 있게 되고, 관리자 인증 하나만 느슨해져도 표면이 커진다.
 * 여기는 **reviews 폴더로만** 저장하고, 회원 단위 한도를 건다 —
 * 로그인만 확인하면 한 계정이 디스크를 채울 수 있다.
 */

/** 리뷰 한 건의 사진 상한과 같다 — 더 받아도 저장 시 버려진다 */
const MAX_FILES_PER_REQUEST = 5;

export async function POST(request: Request) {
  const customerId = await readSessionCustomerId();
  if (customerId === null) {
    return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  }
  // 쿠키가 유효해도 탈퇴·정지 계정이면 막는다
  const profile = await getCustomerSessionProfile(db, customerId);
  if (!profile) {
    return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  }

  try {
    assertReviewUploadAllowed(customerId);
  } catch (error) {
    const message =
      error instanceof TRPCError ? error.message : "잠시 후 다시 시도해 주세요.";
    return NextResponse.json({ message }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ message: "업로드 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ message: "올릴 사진을 선택해 주세요." }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { message: `사진은 한 번에 ${MAX_FILES_PER_REQUEST}장까지 올릴 수 있습니다.` },
      { status: 400 },
    );
  }
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { message: "사진 한 장은 5MB까지 올릴 수 있습니다." },
        { status: 400 },
      );
    }
  }

  const now = new Date();
  const storedPaths: string[] = [];
  try {
    for (const file of files) {
      storedPaths.push(
        await storeProductImage({
          bytes: await file.arrayBuffer(),
          mimeType: file.type,
          now,
          // 폴더를 고정한다 — 회원이 상품·배너 폴더에 쓸 수 있으면 안 된다
          folder: "reviews",
        }),
      );
    }
  } catch (error) {
    if (error instanceof UnsupportedImageTypeError || error instanceof ImageTooLargeError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  return NextResponse.json({ storedPaths });
}
