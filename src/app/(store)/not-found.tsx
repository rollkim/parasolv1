import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { getBusinessInfo } from "@/server/services/site-setting.service";

/**
 * 스토어프론트 404 — 핸드오프 규격: 오류빈상태.dc.html 404 케이스(L192~195).
 * ERROR 404 코드 + 물음표 원형 아이콘(secondary 배경·primary 전경 = stateTone brand) +
 * '메인으로'(primary) / '고객센터'(ghost) 액션 + 고객센터 안내 각주.
 *
 * 목업과 의도적으로 다르게 간 부분(사유):
 *  - 각주의 고객센터 번호는 목업 하드코딩(1544-0000) 대신 site_setting(business_info)에서
 *    가져온다 — 업체 표기 하드코딩 금지(RULE-11 리스킨). 그래서 async 서버 컴포넌트다.
 */
export default async function StoreNotFound() {
  const businessInfo = await getBusinessInfo(db);

  return (
    <EmptyState
      size="page"
      stateTone="brand"
      errorCode="ERROR 404"
      iconSize={64}
      icon={
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
          <path d="M9 9.5a3 3 0 0 1 5.5 1.6c0 1.6-2.3 2-2.4 3.4" />
          <path d="M12 17.5v.3" />
        </svg>
      }
      title="페이지를 찾을 수 없어요"
      description="주소가 바뀌었거나 삭제된 페이지일 수 있어요. 입력하신 주소가 정확한지 확인해 주세요."
      actions={[
        { label: "메인으로", actionVariant: "primary", href: "/" },
        // TODO(라우트 미구현): /support 고객센터 페이지는 아직 없다 — 헤더 유틸바와 동일 목적지
        { label: "고객센터", actionVariant: "ghost", href: "/support" },
      ]}
      footnote={`문제가 계속되면 고객센터 ${businessInfo.csPhone}으로 알려주세요.`}
    />
  );
}
