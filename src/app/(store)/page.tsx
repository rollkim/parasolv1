import { EmptyState } from "@/components/ui/empty-state";

/**
 * 스토어프론트 홈 — 자리표시자.
 * 실제 메인(히어로 배너·진열 섹션·띠배너)은 2주차에 구현한다.
 * 지금은 공통 셸(헤더·푸터)이 붙는지 확인하는 용도다.
 */
export default function StoreHomePage() {
  return (
    <EmptyState
      size="page"
      stateTone="brand"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M4 8 12 4l8 4v8l-8 4-8-4Z" strokeLinejoin="round" />
          <path d="M12 12v8" />
          <path d="m4 8 8 4 8-4" strokeLinejoin="round" />
        </svg>
      }
      title="메인 화면 준비 중"
      description="히어로 배너와 진열 섹션은 2주차에 구현합니다. 지금은 공통 헤더·푸터가 붙는지 확인하는 자리입니다."
    />
  );
}
