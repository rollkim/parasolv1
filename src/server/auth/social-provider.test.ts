import { describe, expect, it } from "vitest";

import { normalizeSocialProfile } from "./social-provider";

/**
 * 제공자 응답 정규화.
 *
 * 특히 **이메일이 없는 경우**를 지킨다 — 카카오는 비즈앱 심사 전이거나 사용자가
 * 선택 동의를 거부하면 이메일을 주지 않는다(데모가 그 상태다). 그때 emailVerified가
 * 참으로 새면 "이메일 null인데 기존 계정에 연결" 같은 사고가 난다.
 */
describe("normalizeSocialProfile — kakao", () => {
  it("이메일 동의를 안 받은 응답(비즈앱 미신청)도 정상 처리한다", () => {
    const profile = normalizeSocialProfile("kakao", {
      id: 1234567890,
      kakao_account: { profile: { nickname: "김명운" } },
    });
    expect(profile).toEqual({
      // 숫자 id를 문자열로 굳힌다 — provider_uid는 text 컬럼이다
      providerUid: "1234567890",
      email: null,
      emailVerified: false,
      displayName: "김명운",
      mobilePhone: null,
    });
  });

  it("이메일이 있어도 미검증이면 emailVerified는 거짓 — 계정 연결에 쓰이면 안 된다", () => {
    const profile = normalizeSocialProfile("kakao", {
      id: 1,
      kakao_account: { email: "a@b.com", is_email_verified: false, profile: {} },
    });
    expect(profile.email).toBe("a@b.com");
    expect(profile.emailVerified).toBe(false);
    expect(profile.displayName).toBeNull();
  });

  it("검증된 이메일만 참으로 표시한다", () => {
    const profile = normalizeSocialProfile("kakao", {
      id: 2,
      kakao_account: { email: "a@b.com", is_email_verified: true, profile: {} },
    });
    expect(profile.emailVerified).toBe(true);
  });
});

describe("normalizeSocialProfile — naver·google", () => {
  it("네이버는 response 안에 담겨 오고 연락처도 준다", () => {
    const profile = normalizeSocialProfile("naver", {
      response: {
        id: "naver-uid",
        email: "a@b.com",
        name: "김명운",
        mobile: "010-5054-4269",
      },
    });
    expect(profile.providerUid).toBe("naver-uid");
    // 네이버는 검증된 이메일만 내려준다 — 있으면 검증된 것으로 본다
    expect(profile.emailVerified).toBe(true);
    expect(profile.mobilePhone).toBe("010-5054-4269");
  });

  it("구글은 sub가 고유 ID이고 email_verified를 그대로 따른다", () => {
    const profile = normalizeSocialProfile("google", {
      sub: "google-sub",
      email: "a@b.com",
      email_verified: true,
      name: "Myoungwoon Kim",
    });
    expect(profile.providerUid).toBe("google-sub");
    expect(profile.emailVerified).toBe(true);
    expect(profile.mobilePhone).toBeNull();
  });

  it("응답이 비어 있어도 터지지 않는다 — 빈 uid는 호출부가 오류로 처리한다", () => {
    expect(normalizeSocialProfile("google", {}).providerUid).toBe("");
    expect(normalizeSocialProfile("naver", null).providerUid).toBe("");
  });
});
