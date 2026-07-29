/**
 * 업로드 전 이미지 축소 — 브라우저 canvas로 처리한다.
 *
 * 서버에서 줄이지 않는 이유:
 *  - 원본 20MB를 그대로 올리면 느린 회선에서 업로드가 몇 분씩 걸리고 중간에 끊긴다.
 *    여기서 줄이면 보통 수백 KB가 되어 한 번에 올라간다.
 *  - 서버 리사이즈는 sharp(네이티브 바이너리) 의존이 붙는다. 설치·배포·보안 패치가 따라오고,
 *    이 앱은 그만한 이미지 처리를 하지 않는다.
 *
 * 출력은 PNG(투명 유지) 또는 JPEG로 고정한다. 원본이 WebP·AVIF여도 결과는 둘 중 하나다 —
 * canvas 인코딩 지원이 브라우저마다 갈려서, 되는 곳만 되는 형식을 쓰면 일부 관리자만 실패한다.
 */

export type ResizeTarget = {
  maxWidth: number;
  maxHeight: number;
};

/**
 * 용도별 최대 크기. 화면에서 실제로 쓰이는 최대 표시 크기의 2배쯤(고해상도 화면 대비)이다.
 * 더 크게 저장해봐야 대역폭만 먹고 화면에서 구분되지 않는다.
 */
export const IMAGE_RESIZE_TARGETS = {
  /** 상품 썸네일·갤러리·상세 세로 이미지 */
  product: { maxWidth: 1600, maxHeight: 1600 },
  /** 히어로·띠배너 — 가로로 길게 쓰인다 */
  banner: { maxWidth: 1920, maxHeight: 1080 },
  /** 이야기 본문 삽입 이미지 */
  article: { maxWidth: 1400, maxHeight: 1400 },
  /** 리뷰 사진 — 고객이 올리는 것이라 더 작게 */
  review: { maxWidth: 1200, maxHeight: 1200 },
} satisfies Record<string, ResizeTarget>;

export type ImageResizePurpose = keyof typeof IMAGE_RESIZE_TARGETS;

/** JPEG 품질 — 0.85면 눈으로 차이를 못 느끼면서 용량이 크게 준다 */
const JPEG_QUALITY = 0.85;

export type ResizedImage = {
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
};

/** 원본보다 크게 늘리지 않는다 — 작은 이미지를 키우면 흐려지기만 한다 */
function fitWithin(
  width: number,
  height: number,
  target: ResizeTarget,
): { width: number; height: number } {
  if (width <= target.maxWidth && height <= target.maxHeight) {
    return { width, height };
  }
  const ratio = Math.min(target.maxWidth / width, target.maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * 이미지 한 장을 목표 크기 안으로 줄인다.
 *
 * `imageOrientation: "from-image"`가 핵심이다 — 없으면 휴대폰으로 찍은 세로 사진이
 * EXIF 회전 정보를 잃고 눕는다.
 */
export async function resizeImageFile(
  file: File,
  purpose: ImageResizePurpose,
): Promise<ResizedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(
    bitmap.width,
    bitmap.height,
    IMAGE_RESIZE_TARGETS[purpose],
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("이미지를 처리할 수 없습니다. 다른 브라우저에서 시도해 주세요.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // PNG는 투명도가 있을 수 있어 그대로 둔다. JPEG로 바꾸면 투명한 자리가 검게 채워진다
  const keepPng = file.type === "image/png";
  const outputType = keepPng ? "image/png" : "image/jpeg";

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, outputType, keepPng ? undefined : JPEG_QUALITY);
  });
  if (!blob) throw new Error("이미지를 변환하지 못했습니다. 다시 시도해 주세요.");

  // 확장자를 결과 형식에 맞춘다 — .webp인데 내용은 JPEG인 파일이 생기지 않게
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return {
    blob,
    fileName: `${baseName}.${keepPng ? "png" : "jpg"}`,
    width,
    height,
  };
}
