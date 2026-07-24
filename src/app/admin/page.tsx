import { EmptyState } from "@/components/ui/empty-state";

/**
 * 관리자 대시보드 — 자리표시자.
 * 실제 KPI·차트는 5주차에 구현한다. 지금은 관리자 셸이 붙는지 확인하는 자리다.
 */
export default function AdminDashboardPage() {
  return (
    <EmptyState
      size="section"
      stateTone="brand"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" strokeLinecap="round" />
        </svg>
      }
      title="대시보드 준비 중"
      description="주문·매출 지표와 차트는 5주차에 구현합니다. 지금은 관리자 셸(사이드바·상단바)이 정상 동작하는지 확인하는 자리입니다."
      headingLevel={2}
    />
  );
}
