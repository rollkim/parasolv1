import { describe, expect, it } from "vitest";

import {
  calcShippingFee,
  calcShippingFeeForAddress,
  isRemoteAreaZipcode,
  type ShippingPolicy,
} from "./cart";

/**
 * 배송비는 고객이 실제로 내는 돈이라 규칙이 어긋나면 바로 손실이거나 항의다.
 * 특히 도서·산간 추가비는 **화면과 서버가 같은 함수를 쓴다**는 전제 위에 서 있다 —
 * 이 함수가 흔들리면 체크아웃에 보인 금액과 결제액이 갈린다.
 */

const POLICY: ShippingPolicy = { baseFee: 3000, freeThreshold: 30000, remoteSurcharge: 3000 };

describe("기본 배송비", () => {
  it("무료배송 기준을 채우면 0", () => {
    expect(calcShippingFee(30000, POLICY)).toBe(0);
    expect(calcShippingFee(29999, POLICY)).toBe(3000);
  });
});

describe("도서·산간 판정", () => {
  it("제주 전역을 잡는다", () => {
    expect(isRemoteAreaZipcode("63000")).toBe(true);
    expect(isRemoteAreaZipcode("63322")).toBe(true);
    expect(isRemoteAreaZipcode("63644")).toBe(true);
  });

  it("울릉도를 잡는다", () => {
    expect(isRemoteAreaZipcode("40200")).toBe(true);
    expect(isRemoteAreaZipcode("40240")).toBe(true);
  });

  it("경계 밖은 육지로 본다 — 한 칸 차이로 요금이 갈린다", () => {
    expect(isRemoteAreaZipcode("62999")).toBe(false);
    expect(isRemoteAreaZipcode("63645")).toBe(false);
    expect(isRemoteAreaZipcode("40199")).toBe(false);
    expect(isRemoteAreaZipcode("40241")).toBe(false);
  });

  it("일반 지역은 아니다", () => {
    expect(isRemoteAreaZipcode("04168")).toBe(false); // 서울 마포
    expect(isRemoteAreaZipcode("48058")).toBe(false); // 부산 해운대
  });

  it("형식이 아니면 판정하지 않는다 — 빈 값에 추가비를 붙이면 안 된다", () => {
    expect(isRemoteAreaZipcode(null)).toBe(false);
    expect(isRemoteAreaZipcode(undefined)).toBe(false);
    expect(isRemoteAreaZipcode("")).toBe(false);
    expect(isRemoteAreaZipcode("631")).toBe(false);
    expect(isRemoteAreaZipcode("우편번호")).toBe(false);
  });

  it("하이픈이 섞여도 숫자만 보고 판정한다", () => {
    expect(isRemoteAreaZipcode("63-322")).toBe(true);
  });
});

describe("주소 반영 배송비", () => {
  it("육지는 기본 배송비만", () => {
    expect(calcShippingFeeForAddress(10000, POLICY, "04168")).toBe(3000);
  });

  it("도서·산간은 추가비가 붙는다", () => {
    expect(calcShippingFeeForAddress(10000, POLICY, "63322")).toBe(6000);
  });

  it("**무료배송이어도 추가비는 붙는다** — 택배사가 실제로 청구하므로 묻어 보내면 손실이다", () => {
    expect(calcShippingFeeForAddress(50000, POLICY, "63322")).toBe(3000);
    expect(calcShippingFeeForAddress(50000, POLICY, "04168")).toBe(0);
  });

  it("추가비가 설정되지 않은 몰에는 갑자기 붙지 않는다", () => {
    const noSurcharge: ShippingPolicy = { baseFee: 3000, freeThreshold: 30000 };
    expect(calcShippingFeeForAddress(10000, noSurcharge, "63322")).toBe(3000);
  });

  it("주소가 없으면 추가비 없음 — 주소 입력 전 화면이 과하게 부르지 않는다", () => {
    expect(calcShippingFeeForAddress(10000, POLICY, null)).toBe(3000);
  });
});
