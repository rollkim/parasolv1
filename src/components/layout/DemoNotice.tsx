import { isDemoDeployment } from "@/lib/deployment-mode";

/**
 * 데모 인스턴스임을 모든 화면 맨 위에 알린다.
 *
 * 데모는 진짜와 겉모습이 같아서, 표시가 없으면 테스트 주문을 진짜로 착각하거나
 * 반대로 실제 결제인 줄 모르고 카드번호를 넣는다. 그래서 **닫을 수 없게** 두고
 * 문서 흐름 맨 위에 놓는다(고정 배치로 띄우면 스토어 헤더를 가린다).
 *
 * 운영 배포에서는 아무것도 렌더링하지 않는다.
 */
export function DemoNotice() {
  if (!isDemoDeployment()) return null;

  return (
    // role="status": 화면 낭독기가 페이지 진입 시 이 문구를 읽도록 한다.
    // 색만으로 알리지 않고 문구로 명시한다(KWCAG AA).
    // 색 쌍은 본문 대비쌍(foreground/background)을 뒤집어 쓴다 — 전용 배너 토큰을
    // 새로 만들지 않으면서 대비를 확실히 확보하는 유일한 조합이다.
    <div
      role="status"
      className="bg-foreground text-background px-4 py-2 text-center text-sm font-medium"
    >
      데모 사이트입니다 — 실제 주문·결제가 이루어지지 않으며, 등록된 정보는 예고 없이
      초기화될 수 있습니다.
    </div>
  );
}
