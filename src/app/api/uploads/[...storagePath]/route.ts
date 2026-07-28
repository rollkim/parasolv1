import { NextResponse } from "next/server";

import {
  ImageNotFoundError,
  imageContentType,
  readStoredImage,
} from "@/server/services/image-storage.service";

/**
 * 업로드 이미지 서빙 — 업로드 루트가 `public/` 밖이라 라우트가 읽어서 내보낸다.
 *
 * 상품 이미지는 **비로그인도 봐야 한다**(스토어프론트 상품 카드) — 인증을 걸지 않는다.
 * 대신 경로 이탈은 image-storage가 막는다: 정규화한 절대경로가 루트 밖을 가리키면
 * ImageNotFoundError다. 여기서 직접 경로를 조립하지 않는 것이 핵심이다.
 */

/** 파일명에 랜덤이 박혀 있어 내용이 바뀌면 경로도 바뀐다 — 영구 캐시가 안전하다 */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storagePath: string[] }> },
) {
  const { storagePath } = await params;
  const relativePath = storagePath.join("/");

  try {
    const fileBytes = await readStoredImage(relativePath);
    return new NextResponse(new Uint8Array(fileBytes), {
      headers: {
        "Content-Type": imageContentType(relativePath),
        "Cache-Control": IMMUTABLE_CACHE,
        // 이미지로만 해석되게 고정 — 업로드물이 HTML로 실행되는 경로를 막는다
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    if (error instanceof ImageNotFoundError) {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
