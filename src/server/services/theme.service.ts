import "server-only";

import type { QueryClient } from "./db-client";
import { getSiteSetting } from "./site-setting.service";

/**
 * 테마(색상 프리셋) 조달 — 스토어와 관리자를 따로 정한다.
 *
 * 토큰은 globals.css의 `[data-theme=...]`에 있고, 여기서는 **어느 프리셋을 쓸지**만 정한다.
 * 색상값을 DB에 넣지 않는 이유(RULE-11): 색을 저장하면 대비·명도 조합이 깨져 접근성이
 * 무너지고, 새 컴포넌트가 나올 때마다 저장된 색 목록을 늘려야 한다.
 * 프리셋 이름만 저장하면 CSS 한 곳만 고쳐도 전 화면이 따라온다.
 *
 * 스토어와 관리자를 나눈 이유: 관리자는 오래 보는 업무 화면이고 스토어는 브랜드 화면이다.
 * 브랜드 색이 강할수록 업무 화면에서는 눈이 피로해질 수 있어 따로 고를 수 있게 한다.
 */

/** globals.css가 실제로 정의한 프리셋. 여기 없는 값은 화면에서 아무 효과가 없다 */
export const THEME_PRESETS = ["sol", "coral", "grape"] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const THEME_PRESET_LABELS: Record<ThemePreset, string> = {
  sol: "솔 그린",
  coral: "감귤 코랄",
  grape: "자두 그레이프",
};

export type ThemeSetting = {
  storefront: ThemePreset;
  admin: ThemePreset;
};

/** 기본은 솔 그린 — :root가 그 값이라 data-theme 없이도 같은 화면이 된다 */
const DEFAULT_THEME: ThemeSetting = { storefront: "sol", admin: "sol" };

function toPreset(value: unknown, fallback: ThemePreset): ThemePreset {
  return THEME_PRESETS.includes(value as ThemePreset) ? (value as ThemePreset) : fallback;
}

export async function loadThemeSetting(client: QueryClient): Promise<ThemeSetting> {
  const stored = await getSiteSetting(client, "theme");
  if (!stored || typeof stored !== "object") return DEFAULT_THEME;
  const candidate = stored as Record<string, unknown>;
  return {
    storefront: toPreset(candidate.storefront, DEFAULT_THEME.storefront),
    admin: toPreset(candidate.admin, DEFAULT_THEME.admin),
  };
}
