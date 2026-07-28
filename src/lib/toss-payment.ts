/**
 * 토스 결제 실행 — 결제창·위젯을 한 진입점으로 감싼다.
 *
 * 두 방식은 UI만 다르고 서버 승인·취소 경로는 완전히 동일하다. 그래서 화면은
 * `launchTossPayment` 하나만 알고, 방식 전환은 서버가 내려주는 uiMode로 끝난다.
 * (결제위젯은 별도 이용 신청이 필요해 1차는 결제창으로 간다 — 위젯 키를 받으면
 *  NEXT_PUBLIC_TOSS_UI_MODE=widget 한 줄로 바뀐다.)
 *
 * 이 파일은 클라이언트 전용이다 — 시크릿 키는 절대 여기 오지 않는다(RULE-11).
 */

const TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";

/** 결제창에서 고객이 고를 수 있는 수단 — 위젯 모드에서는 SDK가 직접 그린다 */
export type TossPaymentMethod =
  | "CARD"
  | "TRANSFER"
  | "VIRTUAL_ACCOUNT"
  | "MOBILE_PHONE";

export type TossPaymentUiMode = "window" | "widget";

export type LaunchTossPaymentInput = {
  uiMode: TossPaymentUiMode;
  clientKey: string;
  customerKey: string;
  /** 우리 주문번호가 곧 토스 orderId다(6~64자 규격 안에 든다) */
  orderNo: string;
  orderName: string;
  /** 서버가 확정한 결제 금액 — 화면 계산값이 아니다 */
  amount: number;
  /** 결제창 모드에서만 쓰인다 */
  method?: TossPaymentMethod;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
  /** 위젯 모드에서 결제수단·약관 UI를 붙일 컨테이너 선택자 */
  widgetSelectors?: { paymentMethods: string; agreement: string };
};

type TossPaymentsSdk = (clientKey: string) => {
  payment: (options: { customerKey: string }) => {
    requestPayment: (options: Record<string, unknown>) => Promise<void>;
  };
  widgets: (options: { customerKey: string }) => {
    setAmount: (amount: { value: number; currency: string }) => Promise<void>;
    renderPaymentMethods: (options: { selector: string }) => Promise<void>;
    renderAgreement: (options: { selector: string }) => Promise<void>;
    requestPayment: (options: Record<string, unknown>) => Promise<void>;
  };
};

declare global {
  interface Window {
    TossPayments?: TossPaymentsSdk;
  }
}

let sdkLoadPromise: Promise<TossPaymentsSdk> | null = null;

/** SDK 스크립트를 한 번만 싣는다 — 결제 버튼을 여러 번 눌러도 중복 로드하지 않는다 */
function loadTossSdk(): Promise<TossPaymentsSdk> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  sdkLoadPromise ??= new Promise<TossPaymentsSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TOSS_SDK_URL;
    script.async = true;
    script.onload = () => {
      if (window.TossPayments) resolve(window.TossPayments);
      else reject(new Error("토스 결제 모듈을 불러오지 못했습니다."));
    };
    script.onerror = () => {
      // 실패한 약속을 캐시에 남기면 재시도가 영원히 막힌다
      sdkLoadPromise = null;
      reject(new Error("토스 결제 모듈을 불러오지 못했습니다. 네트워크를 확인해 주세요."));
    };
    document.head.appendChild(script);
  });
  return sdkLoadPromise;
}

/** 위젯 모드는 결제 요청 전에 금액·UI 렌더가 선행되어야 한다 */
export async function prepareTossWidgets(input: {
  clientKey: string;
  customerKey: string;
  amount: number;
  selectors: { paymentMethods: string; agreement: string };
}) {
  const TossPayments = await loadTossSdk();
  const widgets = TossPayments(input.clientKey).widgets({ customerKey: input.customerKey });
  // V2는 setAmount(객체)다 — V1의 updateAmount(숫자)는 제거됐다
  await widgets.setAmount({ value: input.amount, currency: "KRW" });
  await widgets.renderPaymentMethods({ selector: input.selectors.paymentMethods });
  await widgets.renderAgreement({ selector: input.selectors.agreement });
  return widgets;
}

/**
 * 결제 실행. 성공하면 토스가 successUrl로 리다이렉트하므로 이 함수는 보통 반환하지 않는다.
 * 사용자가 결제창을 닫으면 SDK가 오류를 던진다 — 호출부가 안내 문구로 옮긴다.
 */
export async function launchTossPayment(input: LaunchTossPaymentInput): Promise<void> {
  const TossPayments = await loadTossSdk();
  const tossPayments = TossPayments(input.clientKey);

  const commonOptions = {
    orderId: input.orderNo,
    orderName: input.orderName,
    successUrl: input.successUrl,
    failUrl: input.failUrl,
    ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
    ...(input.customerName ? { customerName: input.customerName } : {}),
  };

  if (input.uiMode === "widget") {
    if (!input.widgetSelectors) {
      throw new Error("위젯 모드에는 컨테이너 선택자가 필요합니다.");
    }
    const widgets = await prepareTossWidgets({
      clientKey: input.clientKey,
      customerKey: input.customerKey,
      amount: input.amount,
      selectors: input.widgetSelectors,
    });
    // 위젯은 금액을 setAmount로 이미 받았으므로 requestPayment에 amount를 넣지 않는다
    await widgets.requestPayment(commonOptions);
    return;
  }

  // 결제창 — 수단은 우리가 그린 UI에서 고른 값이다. V2는 amount가 객체다
  await tossPayments.payment({ customerKey: input.customerKey }).requestPayment({
    method: input.method ?? "CARD",
    amount: { value: input.amount, currency: "KRW" },
    ...commonOptions,
  });
}
