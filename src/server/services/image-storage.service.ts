import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 상품 이미지 저장 — 로컬 디스크.
 *
 * `public/` 밖에 둔다. public에 쓰면 배포 산출물과 사용자 업로드가 섞여
 * 재배포 때 사라지거나 빌드 캐시에 갇힌다. 대신 서빙 라우트가 읽어서 내보낸다.
 * 저장소를 S3로 바꿀 때 갈아끼우는 지점이 이 모듈 하나다(RULE-14).
 *
 * 저장 경로: {UPLOAD_DIR}/products/{yyyymm}/{랜덤}.{ext}
 * 월 단위로 쪼개는 이유 — 한 디렉토리에 수만 개가 쌓이면 파일시스템 조회가 느려진다.
 */

/** 확장자 allowlist. 클라이언트가 보낸 파일명·MIME은 믿지 않고 여기서 다시 정한다 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/** 원본 사진 한 장 기준. 넘으면 업로드 단계에서 거른다 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class UnsupportedImageTypeError extends Error {
  constructor(readonly mimeType: string) {
    super("JPG · PNG · WebP · AVIF 이미지만 올릴 수 있습니다.");
    this.name = "UnsupportedImageTypeError";
  }
}

export class ImageTooLargeError extends Error {
  constructor(readonly byteSize: number) {
    super("이미지 한 장은 5MB까지 올릴 수 있습니다. 크기를 줄여 다시 시도해 주세요.");
    this.name = "ImageTooLargeError";
  }
}

export class ImageNotFoundError extends Error {
  constructor(readonly storagePath: string) {
    super(`이미지를 찾을 수 없습니다: ${storagePath}`);
    this.name = "ImageNotFoundError";
  }
}

/**
 * 업로드 루트 — **항상 프로젝트 밖**이다.
 *
 * 기본값을 프로젝트 안에 두면 재배포·빌드 정리·저장소 clone 한 번에 업로드가 날아간다.
 * env가 없어도 안전하도록 기본값 자체를 상위 폴더로 잡는다:
 *   개발(Windows) C:\_Hope\PaRaSOL\parasolv1 → C:\_Hope\PaRaSOL\parasol-uploads
 *   운영(Linux)   /home/parasol/app          → /home/parasol/parasol-uploads
 * 다른 볼륨에 두려면 PARASOL_UPLOAD_DIR에 절대경로를 준다.
 */
function getUploadRootDir(): string {
  const configuredDir = process.env.PARASOL_UPLOAD_DIR;
  if (configuredDir) return path.resolve(configuredDir);
  return path.resolve(process.cwd(), "..", "parasol-uploads");
}

/** "products/202607/ab12cd34.jpg" 형태 — DB(product_image.path 등)에 이 상대경로만 저장한다 */
export type StoredImagePath = string;

/**
 * 업로드 용도별 최상위 폴더. 열린 문자열이 아니라 목록으로 고정한다 —
 * 클라이언트가 폴더명을 정하게 두면 그 자체가 경로 조작 입력이 된다.
 */
export const IMAGE_FOLDERS = ["products", "banners"] as const;
export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

/** DB·zod가 공유하는 저장 경로 형식 */
export const STORED_IMAGE_PATH_PATTERN = /^(products|banners)\/\d{6}\/[a-f0-9]+\.(jpg|png|webp|avif)$/;

/**
 * 저장 상대경로를 실제 파일 경로로 바꾼다.
 *
 * **경로 이탈 방어의 유일한 지점**이다. "../../.env" 같은 입력이 오면 루트 밖을 가리키게
 * 되므로, 정규화한 절대경로가 루트 안에 남아 있는지 반드시 확인한다.
 */
export function resolveStoredImageFile(storagePath: string): string {
  const rootDir = getUploadRootDir();
  const resolved = path.resolve(rootDir, storagePath);
  const rootWithSep = rootDir.endsWith(path.sep) ? rootDir : rootDir + path.sep;
  if (!resolved.startsWith(rootWithSep)) {
    throw new ImageNotFoundError(storagePath);
  }
  return resolved;
}

/** 확장자별 Content-Type — 서빙 라우트가 쓴다 */
export function imageContentType(storagePath: string): string {
  const extension = path.extname(storagePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".avif") return "image/avif";
  return "image/jpeg";
}

/**
 * 이미지 한 장을 저장하고 상대경로를 돌려준다.
 *
 * 파일명은 **클라이언트 이름을 쓰지 않고 새로 만든다** — 경로 이탈("../")과
 * 덮어쓰기(같은 이름 재업로드)를 이름 단계에서 원천 차단한다.
 */
export async function storeProductImage(input: {
  bytes: ArrayBuffer;
  mimeType: string;
  /** 파일명이 시간순이 되도록 하는 접두 — 월 폴더 계산에도 쓴다 */
  now: Date;
  /** 용도별 폴더. 목록에 없는 값은 들어올 수 없다(타입으로 막는다) */
  folder?: ImageFolder;
}): Promise<StoredImagePath> {
  const extension = ALLOWED_IMAGE_TYPES[input.mimeType];
  if (!extension) throw new UnsupportedImageTypeError(input.mimeType);
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageTooLargeError(input.bytes.byteLength);
  }

  const yearMonth = `${input.now.getFullYear()}${String(input.now.getMonth() + 1).padStart(2, "0")}`;
  const fileName = `${randomBytes(12).toString("hex")}.${extension}`;
  const relativePath = `${input.folder ?? "products"}/${yearMonth}/${fileName}`;

  const absolutePath = resolveStoredImageFile(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(input.bytes));

  return relativePath;
}

/** 서빙 라우트용 — 없으면 ImageNotFoundError(404로 번역된다) */
export async function readStoredImage(storagePath: string): Promise<Buffer> {
  const absolutePath = resolveStoredImageFile(storagePath);
  try {
    return await readFile(absolutePath);
  } catch {
    throw new ImageNotFoundError(storagePath);
  }
}
