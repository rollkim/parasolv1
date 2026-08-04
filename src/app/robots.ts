import type { MetadataRoute } from "next";

import { isDemoDeployment } from "@/lib/deployment-mode";

/**
 * 데모 인스턴스는 검색엔진에서 통째로 뺀다.
 *
 * 데모에는 시연용 상품·가짜 후기가 들어 있다. 색인되면 브랜드명 검색에 그 페이지가
 * 뜨고, 나중에 서버를 내려도 검색 결과에는 한동안 남는다.
 *
 * 운영에서는 관리자·인증·결제 영역만 막는다 — 로그인 뒤 화면이라 크롤러가 얻을 것도
 * 없고, 검색 결과에 노출될 이유도 없다.
 */
/**
 * 요청마다 계산한다.
 *
 * 기본값이면 빌드 때 robots.txt를 파일로 구워 버려서, 배포 환경변수로 데모를 켜도
 * **빌드 시점 값이 그대로 나간다** — 데모 사이트가 색인 허용으로 열린 채 돌게 된다.
 * (실제로 그렇게 나오는 것을 확인하고 넣은 설정이다)
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (isDemoDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/mypage", "/checkout", "/cart", "/login"],
    },
  };
}
