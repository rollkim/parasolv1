"use client";

import { notFound } from "next/navigation";
import { useState } from "react";

// 개발 전용 토큰·컴포넌트 견본 페이지 — 운영 빌드에서는 404 (RULE-13)
// 리스킨 테스트(핸드오프 완료 기준 1번)와 이후 코어 컴포넌트 상태 확인에 계속 사용한다.

const THEME_PRESETS = [
  { themeValue: "", label: "솔 그린 (기본)" },
  { themeValue: "coral", label: "감귤 코랄" },
  { themeValue: "grape", label: "자두 그레이프" },
] as const;

const RADIUS_PRESETS = ["8px", "12px", "20px"] as const;

const COLOR_PAIRS = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["accent", "accent-foreground"],
  ["destructive", "destructive-foreground"],
] as const;

const SINGLE_TOKENS = ["border", "input", "ring", "success", "info"] as const;

const NAV_TOKENS = ["nav-bg", "nav-panel", "nav-fg", "nav-muted", "nav-line", "pos"] as const;

export default function TokensPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const [activeTheme, setActiveTheme] = useState("");
  const [activeRadius, setActiveRadius] = useState("12px");

  const applyTheme = (themeValue: string) => {
    setActiveTheme(themeValue);
    const rootEl = document.documentElement;
    if (themeValue) rootEl.dataset.theme = themeValue;
    else delete rootEl.dataset.theme;
  };

  const applyRadius = (radiusValue: string) => {
    setActiveRadius(radiusValue);
    document.documentElement.style.setProperty("--radius", radiusValue);
  };

  return (
    <main className="mx-auto max-w-4xl space-y-10 p-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-extrabold">디자인 토큰 견본 (dev 전용)</h1>
        <p className="text-sm text-muted-foreground">
          아래 스위치로 리스킨 프리셋을 전환하면 이 페이지 전체 색·서체가 즉시 바뀌어야 합니다.
        </p>
      </header>

      {/* 리스킨 스위처 */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-bold">리스킨 프리셋</h2>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.themeValue}
              onClick={() => applyTheme(preset.themeValue)}
              className={`rounded-md border px-4 py-2 text-sm font-semibold ${
                activeTheme === preset.themeValue
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">라운드(--radius):</span>
          {RADIUS_PRESETS.map((radiusValue) => (
            <button
              key={radiusValue}
              onClick={() => applyRadius(radiusValue)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                activeRadius === radiusValue
                  ? "border-primary bg-secondary text-secondary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {radiusValue}
            </button>
          ))}
        </div>
      </section>

      {/* 색 토큰 스와치 */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-bold">색 토큰 (배경/전경 쌍)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {COLOR_PAIRS.map(([bgToken, fgToken]) => (
            <div
              key={bgToken}
              className="rounded-lg border border-border p-4"
              style={{ background: `var(--${bgToken})`, color: `var(--${fgToken})` }}
            >
              <div className="text-sm font-bold">--{bgToken}</div>
              <div className="text-xs opacity-80">--{fgToken}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {SINGLE_TOKENS.map((tokenName) => (
            <div key={tokenName} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block size-6 rounded-full border border-border"
                style={{ background: `var(--${tokenName})` }}
              />
              --{tokenName}
            </div>
          ))}
        </div>
      </section>

      {/* 버튼·입력 샘플 — Tailwind 클래스 매핑 검증 */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-bold">컴포넌트 미리보기 (토큰만 사용)</h2>
        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            결제하기
          </button>
          <button className="rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted">
            장바구니 담기
          </button>
          <button className="rounded-md bg-destructive px-5 py-2.5 text-sm font-semibold text-destructive-foreground hover:opacity-90">
            삭제
          </button>
          <button
            disabled
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground opacity-50"
          >
            품절
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-56 rounded-sm border border-input bg-card px-3 py-2 text-sm placeholder:text-muted-foreground"
            placeholder="포커스 링 확인용 입력"
          />
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
            판매중
          </span>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            품절 (색+텍스트 병기)
          </span>
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: "color-mix(in oklch, var(--success) 12%, white)", color: "var(--success)" }}
          >
            배송완료
          </span>
        </div>
      </section>

      {/* 모션 토큰 — 오버레이 애니메이션이 실제로 생성되는지 확인 */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-bold">모션 토큰</h2>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="animate-pop-in rounded-lg border border-border bg-card px-4 py-3">animate-pop-in</div>
          <div className="animate-fade-in rounded-lg border border-border bg-card px-4 py-3">animate-fade-in</div>
          <div className="animate-sheet-in rounded-lg border border-border bg-card px-4 py-3">animate-sheet-in</div>
          <div className="animate-shimmer rounded-lg border border-border bg-muted px-4 py-3">animate-shimmer</div>
          <div className="animate-spin-slow size-8 rounded-full border-[3px] border-muted border-t-primary" />
        </div>
      </section>

      {/* 타이포그래피 */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-bold">타이포그래피</h2>
        <p className="font-heading text-[clamp(24px,5vw,44px)] font-extrabold leading-tight">
          만든 사람의 이야기가
          <br />
          담긴 좋은 먹거리
        </p>
        <p className="max-w-prose text-[15px] leading-relaxed">
          본문은 Pretendard Variable입니다. 디스플레이(위 제목)는 기본·코랄 테마에서 Gothic A1,
          그레이프 테마에서 Black Han Sans로 바뀝니다 — 서체까지 토큰이라는 뜻입니다.
        </p>
        <p className="text-sm text-muted-foreground">보조 텍스트 — muted-foreground 색.</p>
      </section>

      {/* 관리자 다크 셸 토큰 */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-bold">관리자 셸 토큰 (--nav-*)</h2>
        <div className="flex items-center gap-4 rounded-lg p-4" style={{ background: "var(--nav-bg)" }}>
          {NAV_TOKENS.map((tokenName) => (
            <div key={tokenName} className="flex flex-col items-center gap-1">
              <span
                className="inline-block size-8 rounded-md border"
                style={{ background: `var(--${tokenName})`, borderColor: "var(--nav-line)" }}
              />
              <span className="text-[10px]" style={{ color: "var(--nav-muted)" }}>
                {tokenName}
              </span>
            </div>
          ))}
          <span className="ml-auto text-sm font-semibold" style={{ color: "var(--pos)" }}>
            ▲ 12.4% (상승 지표)
          </span>
        </div>
      </section>
    </main>
  );
}
