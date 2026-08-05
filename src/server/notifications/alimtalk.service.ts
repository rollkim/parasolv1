import "server-only";

import { formatKrw } from "@/lib/format";
import { formatPhone } from "@/domain/phone";

/**
 * 알림톡(솔라피) 발송 자리 — **아직 실제 발송은 하지 않는다.**
 *
 * 업체 계약 → 발신프로필 등록 → 템플릿 심사가 끝나야 발송이 가능하다. 그 전까지는
 * 발송 지점(결제 완료·배송 시작)에 이 모듈을 미리 꽂아 두고 **로그만 남긴다** —
 * 계약이 끝나면 이 파일 안의 게이트웨이 구현만 채우면 되고, 도메인 코드는 손대지 않는다.
 *
 * 규칙:
 * - **발송 실패가 주문 흐름을 깨뜨리지 않는다.** 알림은 부가 기능이다 — 결제가 됐는데
 *   알림톡 오류로 500이 나면 주객전도다. 그래서 이 모듈의 공개 함수는 절대 throw하지 않는다.
 * - **트랜잭션 안에서 부르지 않는다.** 커밋 전에 보내면 "결제 완료" 알림이 갔는데
 *   트랜잭션이 롤백되는 거짓 알림이 생긴다. 호출부는 반드시 커밋 뒤에 부른다.
 * - 메시지 종류는 유니온으로 고정한다 — 템플릿 심사제라 아무 문구나 보낼 수 없고,
 *   종류가 열려 있으면 심사받지 않은 메시지가 섞여 들어온다.
 */

export type AlimtalkMessage =
  | {
      messageKind: "payment_completed";
      /** 수신 번호 — 저장 형태(숫자만)로 받는다 */
      toPhone: string;
      orderNo: string;
      ordererName: string;
      grandTotal: number;
    }
  | {
      messageKind: "shipping_started";
      toPhone: string;
      orderNo: string;
      recipientName: string;
      carrierCode: string;
      trackingNo: string;
    };

/** 로그에 사람이 읽을 요약을 남긴다 — 나중에 "그때 알림이 나갔어야 했나"를 확인하는 근거 */
function describeMessage(message: AlimtalkMessage): string {
  switch (message.messageKind) {
    case "payment_completed":
      return `[결제완료] ${message.orderNo} · ${message.ordererName}님 · ${formatKrw(message.grandTotal)}`;
    case "shipping_started":
      return `[배송시작] ${message.orderNo} · ${message.recipientName}님 · ${message.carrierCode} ${message.trackingNo}`;
  }
}

/**
 * 알림톡 발송 — 지금은 대기 로그만 남긴다.
 *
 * 반환도 오류도 없다: 호출부가 결과에 따라 분기할 일이 없어야 "부가 기능"으로 남는다.
 */
export async function sendAlimtalkSafely(message: AlimtalkMessage): Promise<void> {
  try {
    const solapiApiKey = process.env.SOLAPI_API_KEY;

    if (!solapiApiKey) {
      // 계약 전 정상 상태 — 어떤 알림이 나갔어야 하는지만 기록한다
      console.log(
        `[알림톡 대기] ${describeMessage(message)} → ${formatPhone(message.toPhone)} (SOLAPI 미설정)`,
      );
      return;
    }

    // TODO(계약 후): 솔라피 발송 연결 —
    //   ① 템플릿 코드 매핑(messageKind → 승인된 templateId)
    //   ② SOLAPI_API_KEY·SOLAPI_API_SECRET·발신프로필 키로 API 호출
    //   ③ 실패 시 재시도 없이 로그만 (부가 기능 원칙 유지)
    console.warn(
      `[알림톡] 키는 설정됐지만 발송 구현이 아직 연결되지 않았습니다 — ${describeMessage(message)}`,
    );
  } catch (notifyError) {
    // 알림 실패는 삼킨다 — 주문·배송 흐름은 이미 끝났고 되돌릴 이유가 없다
    console.error("[알림톡] 발송 처리 중 오류(주문 흐름에는 영향 없음)", notifyError);
  }
}
