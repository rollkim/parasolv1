import "server-only";

import { TRPCError } from "@trpc/server";

/**
 * 인메모리 슬라이딩 윈도우 레이트리밋 — 무차별 대입·크리덴셜 스터핑·스팸 억제.
 *
 * 저트래픽·단일 프로세스(PM2 1개) 전제라 프로세스 메모리로 충분하다.
 * 다중 인스턴스로 확장하거나 재시작 간 유지가 필요해지면 DB/Redis 백엔드로 교체한다
 * — 그때도 이 모듈의 공개 함수 시그니처(assert/record/reset)는 유지한다.
 *
 * 보안 감사 1차 권고(2026-07-27) 반영.
 */

type AttemptBucket = number[]; // 윈도우 내 시도 타임스탬프(ms)

const buckets = new Map<string, AttemptBucket>();

// 버킷 무한 증식 방지 — 주기적으로 만료된 키를 통째로 청소한다
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweepAt = 0;

function sweepExpired(now: number, windowMs: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, timestamps] of buckets) {
    const alive = timestamps.filter((t) => now - t < windowMs);
    if (alive.length === 0) buckets.delete(key);
    else buckets.set(key, alive);
  }
}

function liveHits(key: string, now: number, windowMs: number): AttemptBucket {
  return (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
}

export type RateLimitRule = {
  /** 윈도우 내 허용 횟수 */
  limit: number;
  /** 윈도우 길이(ms) */
  windowMs: number;
};

export type RateLimitState = { allowed: boolean; retryAfterSeconds: number };

/** 기록하지 않고 현재 상태만 본다(읽기 전용 게이트) */
export function peekRateLimit(key: string, rule: RateLimitRule): RateLimitState {
  const now = Date.now();
  const hits = liveHits(key, now, rule.windowMs);
  if (hits.length >= rule.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + rule.windowMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** 시도 1건을 기록한다. 이미 한도 초과면 기록만 갱신하고 초과 상태를 알린다 */
export function recordAttempt(key: string, rule: RateLimitRule): RateLimitState {
  const now = Date.now();
  sweepExpired(now, rule.windowMs);
  const hits = liveHits(key, now, rule.windowMs);
  hits.push(now);
  buckets.set(key, hits);
  if (hits.length > rule.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + rule.windowMs - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** 성공 시 카운터를 비운다 — 실패 기반 락아웃이 정상 사용자를 막지 않게 한다 */
export function resetAttempts(key: string): void {
  buckets.delete(key);
}

function throwTooMany(retryAfterSeconds: number): never {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `시도가 너무 많습니다. 약 ${minutes}분 후 다시 시도해 주세요.`,
  });
}

// ── 규칙 (감사 권고 기반 · 저트래픽 기준 넉넉하게) ──
const LOGIN_BY_ACCOUNT: RateLimitRule = { limit: 5, windowMs: 10 * 60 * 1000 };
const LOGIN_BY_IP: RateLimitRule = { limit: 20, windowMs: 10 * 60 * 1000 };
const SIGNUP_BY_IP: RateLimitRule = { limit: 5, windowMs: 60 * 60 * 1000 };
const QNA_BY_IP: RateLimitRule = { limit: 10, windowMs: 60 * 60 * 1000 };
// 비회원 주문조회 — 주문번호가 "날짜-연번"이라 추측 가능하므로 무차별 탐색을 막는다.
// 정상 사용자는 오타 몇 번이면 충분하다.
const GUEST_LOOKUP_BY_IP: RateLimitRule = { limit: 10, windowMs: 10 * 60 * 1000 };

/**
 * 로그인 시도 전 게이트 — 계정별·IP별 실패 누적이 한도를 넘으면 차단.
 * 기록은 실패했을 때만(recordLoginFailure) 하므로, 여기서는 읽기만 한다.
 * IP가 없으면(프록시 헤더 부재) IP 기준은 건너뛴다 — 계정 기준이 계정을 보호한다.
 */
export function assertLoginAllowed(loginId: string, clientIp: string | null): void {
  const byAccount = peekRateLimit(`login:id:${loginId}`, LOGIN_BY_ACCOUNT);
  if (!byAccount.allowed) throwTooMany(byAccount.retryAfterSeconds);
  if (clientIp) {
    const byIp = peekRateLimit(`login:ip:${clientIp}`, LOGIN_BY_IP);
    if (!byIp.allowed) throwTooMany(byIp.retryAfterSeconds);
  }
}

/** 로그인 실패 기록 — 다음 시도의 게이트에 반영된다 */
export function recordLoginFailure(loginId: string, clientIp: string | null): void {
  recordAttempt(`login:id:${loginId}`, LOGIN_BY_ACCOUNT);
  if (clientIp) recordAttempt(`login:ip:${clientIp}`, LOGIN_BY_IP);
}

/** 로그인 성공 — 계정·IP 카운터를 비운다 */
export function clearLoginAttempts(loginId: string, clientIp: string | null): void {
  resetAttempts(`login:id:${loginId}`);
  if (clientIp) resetAttempts(`login:ip:${clientIp}`);
}

/** 가입 스팸 게이트 — 모든 시도를 카운트(성공/실패 무관) */
export function assertSignupAllowed(clientIp: string | null): void {
  if (!clientIp) return; // IP 없으면 이 계층은 건너뜀(형식·중복 검증이 방어)
  const state = recordAttempt(`signup:ip:${clientIp}`, SIGNUP_BY_IP);
  if (!state.allowed) throwTooMany(state.retryAfterSeconds);
}

/** 문의 스팸 게이트 */
export function assertQnaAllowed(clientIp: string | null): void {
  if (!clientIp) return;
  const state = recordAttempt(`qna:ip:${clientIp}`, QNA_BY_IP);
  if (!state.allowed) throwTooMany(state.retryAfterSeconds);
}

/**
 * 비회원 주문조회 게이트 — 성공·실패 모두 카운트한다.
 * 실패만 세면 공격자가 유효 조합을 찾은 뒤 마음껏 긁어갈 수 있다.
 */
export function assertGuestLookupAllowed(clientIp: string | null): void {
  if (!clientIp) return;
  const state = recordAttempt(`guest_lookup:ip:${clientIp}`, GUEST_LOOKUP_BY_IP);
  if (!state.allowed) throwTooMany(state.retryAfterSeconds);
}
