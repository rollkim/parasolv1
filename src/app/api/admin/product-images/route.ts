import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAdminSessionUserId } from "@/server/auth/admin-session";
import { getAdminSessionProfile } from "@/server/services/admin-auth.service";
import {
  IMAGE_FOLDERS,
  ImageTooLargeError,
  MAX_IMAGE_BYTES,
  storeProductImage,
  UnsupportedImageTypeError,
  type ImageFolder,
} from "@/server/services/image-storage.service";

/**
 * 상품 이미지 업로드 — multipart라 tRPC가 아니라 라우트 핸들러다.
 *
 * tRPC는 JSON 직렬화가 전제라 파일을 실어 보낼 수 없다. 대신 tRPC가 하던 방어를
 * 여기서 직접 한다: **관리자 세션 검증 + DB 재확인**(쿠키만 있고 계정이 비활성화됐을 수 있다).
 *
 * 저장은 image-storage 서비스가 맡는다 — 확장자 allowlist·크기 제한·파일명 재생성·
 * 경로 이탈 방어가 전부 거기 있다. 이 라우트는 인증과 HTTP 번역만 한다.
 */

/** 한 번에 올릴 수 있는 장수 — 갤러리 + 상세 이미지를 감안한 상한 */
const MAX_FILES_PER_REQUEST = 10;

export async function POST(request: Request) {
  const adminUserId = await readAdminSessionUserId(request.headers.get("cookie"));
  if (adminUserId === null) {
    return NextResponse.json({ message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }
  // 쿠키가 유효해도 계정이 비활성화됐을 수 있다 — adminProcedure와 같은 재확인
  const adminProfile = await getAdminSessionProfile(db, adminUserId);
  if (!adminProfile) {
    return NextResponse.json({ message: "관리자 권한이 없습니다." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ message: "업로드 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ message: "올릴 이미지를 선택해 주세요." }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { message: `한 번에 ${MAX_FILES_PER_REQUEST}장까지 올릴 수 있습니다.` },
      { status: 400 },
    );
  }

  // 저장 전에 전량 크기를 본다 — 절반만 저장되고 실패하면 고아 파일이 남는다
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { message: "이미지 한 장은 5MB까지 올릴 수 있습니다." },
        { status: 400 },
      );
    }
  }

  // 폴더는 목록에 있는 값만 받는다 — 임의 문자열을 그대로 쓰면 경로 조작 입력이 된다
  const requestedFolder = formData.get("folder");
  const folder: ImageFolder = IMAGE_FOLDERS.includes(requestedFolder as ImageFolder)
    ? (requestedFolder as ImageFolder)
    : "products";

  const now = new Date();
  const storedPaths: string[] = [];
  try {
    for (const file of files) {
      storedPaths.push(
        await storeProductImage({
          bytes: await file.arrayBuffer(),
          mimeType: file.type,
          now,
          folder,
        }),
      );
    }
  } catch (error) {
    if (error instanceof UnsupportedImageTypeError || error instanceof ImageTooLargeError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  // 경로만 돌려준다 — DB 기록은 상품 저장 시 alt·순서와 함께 한 번에 한다
  return NextResponse.json({ storedPaths });
}
