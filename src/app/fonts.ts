import localFont from "next/font/local";
import { Gothic_A1, Black_Han_Sans } from "next/font/google";

// 본문 서체 — 고정 (핸드오프 tokens-reference.css --font-body)
// Pretendard는 구글 폰트가 아니라 별도 배포 웹폰트라 next/font/local로 직접 로드한다.
export const fontBody = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-body",
  weight: "45 920", // 패키지 원본 CSS의 font-weight 범위와 일치 (가변 폰트)
  display: "swap",
  // 핸드오프 --font-body의 폴백 스택 유지 (로드 전·실패 시 한글 대체 서체)
  fallback: [
    "Pretendard",
    "-apple-system",
    "BlinkMacSystemFont",
    "system-ui",
    "Apple SD Gothic Neo",
    "Malgun Gothic",
    "sans-serif",
  ],
});

// 디스플레이 서체 — 기본 프리셋(솔 그린·코랄)
export const fontDisplay = Gothic_A1({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-display-gothic",
  display: "swap",
});

// 디스플레이 서체 — 그레이프 프리셋 전용 교체 서체
export const fontDisplayGrape = Black_Han_Sans({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display-black-han",
  display: "swap",
});
