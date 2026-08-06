import "server-only";

/**
 * 소셜 로그인 3사 설정 — 카카오·네이버·구글.
 *
 * 각 사의 차이(엔드포인트·스코프·응답 모양)를 **여기서만** 흡수하고, 나머지 코드는
 * 정규화된 `SocialProfile` 하나만 다룬다. 새 제공자가 늘어도 이 파일만 는다.
 *
 * 왜 서버에서만 도는가: 토큰 교환에 client_secret이 필요하다. 브라우저에서 하면
 * 시크릿이 번들에 박히고, 그 순간 누구나 우리 앱을 사칭할 수 있다.
 */

export const SOCIAL_PROVIDERS = ["kakao", "naver", "google"] as const;
export type SocialProviderKey = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProviderKey(value: string): value is SocialProviderKey {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** 제공자가 뭘 주든 우리는 이 모양만 본다 */
export type SocialProfile = {
  /** 제공자 내부 고유 ID — customer_auth.provider_uid가 된다. 이메일이 바뀌어도 불변 */
  providerUid: string;
  email: string | null;
  /**
   * **제공자가 이메일 소유를 검증했는가.**
   * 이 값이 참일 때만 기존 계정에 연결한다 — 미검증 이메일로 연결하면
   * 남의 이메일로 소셜 계정을 만들어 그 사람 쇼핑몰 계정을 가져갈 수 있다.
   */
  emailVerified: boolean;
  /** 표시 이름 — customer.name이 notNull이라 없으면 대체값을 쓴다 */
  displayName: string | null;
  /** 네이버만 준다. 있으면 채워 두면 체크아웃에서 다시 안 물어도 된다 */
  mobilePhone: string | null;
};

export class SocialProviderNotConfiguredError extends Error {
  constructor(readonly providerKey: SocialProviderKey) {
    super("이 소셜 로그인은 아직 사용할 수 없습니다. 아이디 로그인을 이용해 주세요.");
    this.name = "SocialProviderNotConfiguredError";
  }
}

export class SocialProfileFetchError extends Error {
  constructor(readonly providerKey: SocialProviderKey, readonly detail: string) {
    super("소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "SocialProfileFetchError";
  }
}

type ProviderConfig = {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** 각 사 프로필 응답 → 우리 모양 */
  toProfile: (raw: unknown) => SocialProfile;
};

/** 응답 파싱 — 타입 단언 대신 좁히기로 읽는다(응답 규격이 바뀌면 조용히 undefined가 되는 걸 막는다) */
function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function buildProviderConfig(providerKey: SocialProviderKey): ProviderConfig {
  switch (providerKey) {
    case "kakao":
      return {
        authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
        tokenUrl: "https://kauth.kakao.com/oauth/token",
        profileUrl: "https://kapi.kakao.com/v2/user/me",
        /**
         * scope를 **보내지 않는다** — 콘솔의 [동의항목] 설정을 그대로 따른다.
         *
         * 카카오는 콘솔에 켜지지 않은 항목을 scope로 요청하면 동의 화면 대신 오류를 낸다.
         * 특히 이메일은 비즈앱 심사가 필요해 앱마다 켜짐 여부가 달라서, 코드에 박아 두면
         * 심사 전 앱에서 로그인 자체가 막힌다. 이메일이 없어도 가입은 되게 설계했으므로
         * (그때는 새 계정 생성) 콘솔 설정에 맡기는 쪽이 어느 앱에서나 뜬다.
         */
        scope: "",
        clientId: process.env.KAKAO_CLIENT_ID,
        clientSecret: process.env.KAKAO_CLIENT_SECRET,
        toProfile: (raw) => {
          const root = readRecord(raw);
          const account = readRecord(root.kakao_account);
          const profile = readRecord(account.profile);
          return {
            // id는 숫자로 온다 — 문자열로 굳혀 저장 형태를 통일한다
            providerUid: String(root.id ?? ""),
            email: readString(account.email),
            emailVerified: account.is_email_verified === true,
            displayName: readString(profile.nickname),
            mobilePhone: null,
          };
        },
      };

    case "naver":
      return {
        authorizeUrl: "https://nid.naver.com/oauth2.0/authorize",
        tokenUrl: "https://nid.naver.com/oauth2.0/token",
        profileUrl: "https://openapi.naver.com/v1/nid/me",
        scope: "",
        clientId: process.env.NAVER_CLIENT_ID,
        clientSecret: process.env.NAVER_CLIENT_SECRET,
        toProfile: (raw) => {
          const account = readRecord(readRecord(raw).response);
          return {
            providerUid: String(account.id ?? ""),
            email: readString(account.email),
            // 네이버는 검증된 이메일만 내려준다(검증 플래그를 따로 주지 않는다)
            emailVerified: readString(account.email) !== null,
            displayName: readString(account.name) ?? readString(account.nickname),
            // "010-1234-5678" 형태로 온다 — 정규화는 저장 직전에 한다
            mobilePhone: readString(account.mobile),
          };
        },
      };

    case "google":
      return {
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        profileUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
        scope: "openid email profile",
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        toProfile: (raw) => {
          const account = readRecord(raw);
          return {
            providerUid: String(account.sub ?? ""),
            email: readString(account.email),
            emailVerified: account.email_verified === true,
            displayName: readString(account.name),
            mobilePhone: null,
          };
        },
      };
  }
}

/**
 * 각 사 응답 → 우리 모양. 네트워크와 분리해 두어 테스트가 가능하다.
 *
 * 응답이 어떻게 오든(동의 거부·비즈앱 미신청으로 이메일 없음 등) 여기서 흡수해야
 * 아래 로직이 흔들리지 않는다 — 그 경우가 실제로 흔하다.
 */
export function normalizeSocialProfile(
  providerKey: SocialProviderKey,
  rawProfile: unknown,
): SocialProfile {
  return buildProviderConfig(providerKey).toProfile(rawProfile);
}

/** 키가 없으면 "준비 중"으로 취급한다 — 셋 중 발급된 것만 켜진다 */
export function isSocialProviderConfigured(providerKey: SocialProviderKey): boolean {
  const config = buildProviderConfig(providerKey);
  return Boolean(config.clientId && config.clientSecret);
}

export function listConfiguredSocialProviders(): SocialProviderKey[] {
  return SOCIAL_PROVIDERS.filter(isSocialProviderConfigured);
}

function requireConfig(providerKey: SocialProviderKey): ProviderConfig & {
  clientId: string;
  clientSecret: string;
} {
  const config = buildProviderConfig(providerKey);
  if (!config.clientId || !config.clientSecret) {
    throw new SocialProviderNotConfiguredError(providerKey);
  }
  return { ...config, clientId: config.clientId, clientSecret: config.clientSecret };
}

/** 콜백 주소 — 각 사 콘솔에 **똑같이** 등록해야 한다(한 글자만 달라도 거절된다) */
export function buildSocialRedirectUri(
  publicOrigin: string,
  providerKey: SocialProviderKey,
): string {
  return `${publicOrigin}/api/auth/social/${providerKey}/callback`;
}

/** 사용자를 보낼 제공자 로그인 주소 */
export function buildAuthorizeUrl(input: {
  providerKey: SocialProviderKey;
  redirectUri: string;
  state: string;
}): string {
  const config = requireConfig(input.providerKey);
  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", input.redirectUri);
  // state = CSRF 방어. 콜백에서 쿠키와 대조한다
  authorizeUrl.searchParams.set("state", input.state);
  if (config.scope) authorizeUrl.searchParams.set("scope", config.scope);
  return authorizeUrl.toString();
}

/**
 * 인가 코드 → 액세스 토큰 → 프로필.
 *
 * 토큰은 저장하지 않는다. 우리가 필요한 건 "누구인가" 한 번뿐이고,
 * 보관하면 유출 시 그 사람의 카카오·네이버 계정까지 위험해진다.
 */
export async function fetchSocialProfile(input: {
  providerKey: SocialProviderKey;
  code: string;
  redirectUri: string;
  state: string;
}): Promise<SocialProfile> {
  const config = requireConfig(input.providerKey);

  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
      // 네이버는 토큰 교환에도 state를 요구한다(다른 두 곳은 무시한다)
      state: input.state,
    }),
  });
  if (!tokenResponse.ok) {
    throw new SocialProfileFetchError(
      input.providerKey,
      `token ${tokenResponse.status}: ${await tokenResponse.text()}`,
    );
  }

  const accessToken = readString(readRecord(await tokenResponse.json()).access_token);
  if (!accessToken) {
    throw new SocialProfileFetchError(input.providerKey, "access_token 없음");
  }

  const profileResponse = await fetch(config.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileResponse.ok) {
    throw new SocialProfileFetchError(
      input.providerKey,
      `profile ${profileResponse.status}: ${await profileResponse.text()}`,
    );
  }

  const profile = config.toProfile(await profileResponse.json());
  if (!profile.providerUid) {
    throw new SocialProfileFetchError(input.providerKey, "제공자 사용자 ID 없음");
  }
  return profile;
}
