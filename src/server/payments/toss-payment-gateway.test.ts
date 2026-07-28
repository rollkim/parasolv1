import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentGatewayError, PaymentRejectedError } from "./payment-gateway";
import {
  buildAuthorizationHeader,
  createTossPaymentGateway,
  DEFINITIVE_REJECT_CODES,
} from "./toss-payment-gateway";

/**
 * 어댑터의 **판단**을 고정한다 — 네트워크는 가짜로 두고, 응답을 어떻게 해석하는지만 본다.
 * 실 API 왕복은 키가 있는 환경에서 수동 실측으로 확인한다(단위 테스트가 외부에 의존하면 안 된다).
 *
 * 특히 실패 분류(확정 거절 vs 모호)는 돈이 걸린 판단이다 — 잘못 분류하면
 * 캡처된 돈의 표식이 지워지고 이중 청구가 열린다.
 */

const SECRET = "test_sk_example";

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  body: unknown;
}) {
  const fetchMock = vi.fn(async () =>
    ({
      ok: response.ok,
      status: response.status,
      json: async () => response.body,
    }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("인증 헤더", () => {
  it("시크릿 뒤에 콜론 1개를 붙여 base64 — 문서가 '가장 흔한 실수'로 지목한 지점", () => {
    const header = buildAuthorizationHeader("test_sk_abc");
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("test_sk_abc:");
  });

  it("BOM이 섞이지 않는다(77u/ 로 시작하지 않는다)", () => {
    expect(buildAuthorizationHeader("test_sk_abc")).not.toContain("77u/");
  });
});

describe("승인 — 성공", () => {
  it("승인 응답을 GatewayApproval로 옮긴다", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: { status: "DONE", method: "카드", approvedAt: "2026-07-28T12:00:00+09:00" },
    });
    const gateway = createTossPaymentGateway(SECRET);
    const approval = await gateway.confirm({
      paymentKey: "pk_1",
      orderNo: "20260728-0001",
      amount: 15000,
    });
    expect(approval.paymentMethodLabel).toBe("카드");
    expect(approval.approvedAt).toBeInstanceOf(Date);
  });

  it("요청에 인증·멱등키 헤더와 서버 금액이 실린다", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, body: { status: "DONE" } });
    const gateway = createTossPaymentGateway(SECRET);
    await gateway.confirm({ paymentKey: "pk_1", orderNo: "20260728-0001", amount: 15000 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/payments/confirm");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(buildAuthorizationHeader(SECRET));
    // 같은 결제의 재승인은 같은 키여야 멱등이 성립한다 — 무작위 UUID면 매번 달라진다
    expect(headers["Idempotency-Key"]).toBe("confirm-pk_1");
    expect(JSON.parse(init.body as string)).toEqual({
      paymentKey: "pk_1",
      orderId: "20260728-0001",
      amount: 15000,
    });
  });
});

describe("승인 — 실패 분류(돈이 걸린 판단)", () => {
  it("확정 거절 코드는 PaymentRejectedError — 캡처 안 됨이 확실하므로 재시도를 연다", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { code: "REJECT_CARD_COMPANY", message: "카드사 승인 거절" },
    });
    const gateway = createTossPaymentGateway(SECRET);
    await expect(
      gateway.confirm({ paymentKey: "pk_1", orderNo: "20260728-0001", amount: 100 }),
    ).rejects.toBeInstanceOf(PaymentRejectedError);
  });

  it("모르는 코드는 모호 실패 — 판단이 서지 않으면 표식을 지키는 쪽", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { code: "SOME_UNKNOWN_CODE", message: "알 수 없음" },
    });
    const gateway = createTossPaymentGateway(SECRET);
    const thrown = await gateway
      .confirm({ paymentKey: "pk_1", orderNo: "20260728-0001", amount: 100 })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(PaymentGatewayError);
    expect(thrown).not.toBeInstanceOf(PaymentRejectedError);
  });

  it("5xx는 코드와 무관하게 모호 — 서버 문제라 캡처 여부를 알 수 없다", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      // 확정 거절 목록에 있는 코드여도 5xx면 모호로 둔다
      body: { code: "REJECT_CARD_COMPANY", message: "서버 오류" },
    });
    const gateway = createTossPaymentGateway(SECRET);
    const thrown = await gateway
      .confirm({ paymentKey: "pk_1", orderNo: "20260728-0001", amount: 100 })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(PaymentGatewayError);
    expect(thrown).not.toBeInstanceOf(PaymentRejectedError);
  });

  it("네트워크 오류·타임아웃은 모호 — 응답을 못 받았으니 캡처됐을 수 있다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    const gateway = createTossPaymentGateway(SECRET);
    const thrown = await gateway
      .confirm({ paymentKey: "pk_1", orderNo: "20260728-0001", amount: 100 })
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(PaymentGatewayError);
    expect(thrown).not.toBeInstanceOf(PaymentRejectedError);
  });
});

describe("승인 — 이미 처리된 결제(멱등 + 상태 검증)", () => {
  it("조회 결과가 DONE이면 성공으로 매핑한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "DONE", method: "카드" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = createTossPaymentGateway(SECRET);
    const approval = await gateway.confirm({
      paymentKey: "pk_1",
      orderNo: "20260728-0001",
      amount: 100,
    });
    expect(approval.paymentMethodLabel).toBe("카드");
    // 두 번째 호출은 조회(GET)여야 한다
    expect(fetchMock.mock.calls[1][0]).toContain("/payments/pk_1");
  });

  it("조회 결과가 CANCELED면 성공으로 둔갑시키지 않는다 — 취소된 결제를 승인으로 만들면 안 된다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ code: "ALREADY_PROCESSED_PAYMENT", message: "이미 처리" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "CANCELED" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const gateway = createTossPaymentGateway(SECRET);
    await expect(
      gateway.confirm({ paymentKey: "pk_1", orderNo: "20260728-0001", amount: 100 }),
    ).rejects.toBeInstanceOf(PaymentGatewayError);
  });
});

describe("취소", () => {
  it("부분 취소는 cancelAmount를 싣고, 전액은 생략한다(토스 규약)", async () => {
    const partialFetch = mockFetchOnce({ ok: true, status: 200, body: {} });
    const gateway = createTossPaymentGateway(SECRET);
    await gateway.cancel({ paymentKey: "pk_1", cancelReason: "반품", cancelAmount: 5000 });
    expect(JSON.parse((partialFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      cancelReason: "반품",
      cancelAmount: 5000,
    });

    const fullFetch = mockFetchOnce({ ok: true, status: 200, body: {} });
    await gateway.cancel({ paymentKey: "pk_1", cancelReason: "전체 취소" });
    expect(JSON.parse((fullFetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      cancelReason: "전체 취소",
    });
  });

  it("부분 취소 멱등키는 금액을 포함한다 — 같은 결제의 다른 취소가 같은 키면 두 번째가 삼켜진다", async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, body: {} });
    const gateway = createTossPaymentGateway(SECRET);
    await gateway.cancel({ paymentKey: "pk_1", cancelReason: "부분", cancelAmount: 5000 });
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("cancel-pk_1-5000");
  });

  it("이미 취소된 결제의 재취소는 성공 — cancel은 멱등이어야 한다(계약)", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { code: "ALREADY_CANCELED_PAYMENT", message: "이미 취소됨" },
    });
    const gateway = createTossPaymentGateway(SECRET);
    await expect(
      gateway.cancel({ paymentKey: "pk_1", cancelReason: "중복 보상" }),
    ).resolves.toBeTruthy();
  });
});

describe("확정 거절 목록", () => {
  it("문서에 근거한 코드만 담는다 — 판단이 서지 않는 코드는 넣지 않는다(모호가 안전)", () => {
    expect(DEFINITIVE_REJECT_CODES.has("REJECT_CARD_COMPANY")).toBe(true);
    // 타임아웃·네트워크 계열은 절대 확정 거절이 아니다
    expect(DEFINITIVE_REJECT_CODES.has("NETWORK_ERROR")).toBe(false);
    expect(DEFINITIVE_REJECT_CODES.has("TIMEOUT")).toBe(false);
  });
});
