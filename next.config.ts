import type { NextConfig } from "next";

/**
 * 배포는 **빌드 산출물만** 나간다(standalone).
 *
 * `.next/standalone/`에 최소 server.js와 실제로 쓰이는 의존성만 추적되어 담긴다.
 * 서버에 `src/`·git 히스토리·검증 스크립트·문서가 가지 않고, node_modules도 통째로
 * 옮기지 않는다(수백 MB → 수십 MB).
 *
 * **이 파일에서 path.join·fs 같은 파일시스템 호출을 하지 않는다.** 하면 Turbopack의
 * 추적기가 "프로젝트 전체가 필요하다"고 판단해 src/·.env까지 standalone에 담는다
 * (빌드가 "Encountered unexpected file in NFT list" 경고로 알려준다).
 * outputFileTracingRoot 기본값이 이 프로젝트 폴더라 지정할 필요도 없다.
 *
 * **빌드는 배포 대상과 같은 OS에서 한다.** Next는 플랫폼별 네이티브 SWC를 쓰므로
 * Windows에서 빌드해 리눅스로 올리면 바이너리가 어긋난다 — WSL2(Ubuntu)에서 빌드한다.
 * (앱 의존성에는 네이티브 컴파일이 없다: bcryptjs·pg 모두 순수 JS)
 */
const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
