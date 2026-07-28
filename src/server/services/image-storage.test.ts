import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ImageNotFoundError,
  ImageTooLargeError,
  imageContentType,
  MAX_IMAGE_BYTES,
  resolveStoredImageFile,
  storeProductImage,
  UnsupportedImageTypeError,
} from "./image-storage.service";

/**
 * 업로드는 외부 입력이 파일시스템에 닿는 유일한 지점이다. 경로 이탈 하나면
 * 서버의 아무 파일이나 읽히므로, 방어를 테스트가 지킨다.
 */

describe("저장 경로 해석 — 경로 이탈 차단", () => {
  it("정상 경로는 업로드 루트 안을 가리킨다", () => {
    const resolved = resolveStoredImageFile("products/202607/abc.jpg");
    expect(resolved).toContain(`${path.sep}parasol-uploads${path.sep}`);
    expect(resolved.endsWith(`abc.jpg`)).toBe(true);
  });

  it("업로드 루트는 프로젝트 밖이다 — 재배포·clone에 업로드가 날아가면 안 된다", () => {
    const resolved = resolveStoredImageFile("products/202607/abc.jpg");
    expect(resolved.startsWith(process.cwd() + path.sep)).toBe(false);
  });

  it.each([
    "../.env",
    "../../etc/passwd",
    "products/../../.env",
    "products/202607/../../../package.json",
  ])("상위 경로로 빠져나가는 입력을 막는다: %s", (traversalPath) => {
    expect(() => resolveStoredImageFile(traversalPath)).toThrow(ImageNotFoundError);
  });

  it("루트 자체를 가리키는 입력도 막는다 — 파일이 아니라 디렉토리다", () => {
    expect(() => resolveStoredImageFile("")).toThrow(ImageNotFoundError);
    expect(() => resolveStoredImageFile(".")).toThrow(ImageNotFoundError);
  });

  it("절대경로 입력도 루트 밖이면 막는다", () => {
    // path.resolve는 절대경로를 만나면 앞을 통째로 버린다 — 그래서 접두 검사가 필요하다
    const absoluteOutside = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    expect(() => resolveStoredImageFile(absoluteOutside)).toThrow(ImageNotFoundError);
  });
});

describe("업로드 입력 검증", () => {
  const now = new Date("2026-07-28T00:00:00Z");

  it("허용하지 않는 형식은 저장하지 않는다", async () => {
    await expect(
      storeProductImage({ bytes: new ArrayBuffer(8), mimeType: "image/svg+xml", now }),
    ).rejects.toThrow(UnsupportedImageTypeError);
    // 실행 가능한 형식이 통과하면 업로드가 곧 코드 실행 경로가 된다
    await expect(
      storeProductImage({ bytes: new ArrayBuffer(8), mimeType: "text/html", now }),
    ).rejects.toThrow(UnsupportedImageTypeError);
  });

  it("크기 상한을 넘으면 저장하지 않는다", async () => {
    await expect(
      storeProductImage({
        bytes: new ArrayBuffer(MAX_IMAGE_BYTES + 1),
        mimeType: "image/jpeg",
        now,
      }),
    ).rejects.toThrow(ImageTooLargeError);
  });
});

describe("Content-Type 판정", () => {
  it("확장자를 따라간다", () => {
    expect(imageContentType("products/202607/a.png")).toBe("image/png");
    expect(imageContentType("products/202607/a.webp")).toBe("image/webp");
    expect(imageContentType("products/202607/a.avif")).toBe("image/avif");
    expect(imageContentType("products/202607/a.jpg")).toBe("image/jpeg");
  });
});
