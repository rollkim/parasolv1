"use client"

// 핸드오프 규격: 관리자 로그인.dc.html — 브랜드 마크 + 아이디/비밀번호 + 로그인 버튼 +
// "모든 관리자 접속·행위는 기록됩니다" 각주.
// [탭 순서](목업 L?): 1 아이디 → 2 비밀번호 → 3 표시 토글 → 4 로그인유지 → 5 로그인
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **2단계 인증(TOTP)**: 비밀번호가 통과한 계정에 켜져 있으면 코드 입력 단계가 나타난다.
//    설정은 관리자 설정 > 보안에서(코드 확인 후에만 활성화 — 잠금 사고 방지).
//  - '이 기기 신뢰(30일)'·'로그인 유지' 미구현: 관리자 세션을 8시간으로 짧게 두는 결정과
//    상충한다. 권한이 큰 계정의 세션을 늘리는 옵션은 2FA와 함께 다루는 것이 맞다.
//  - 실패 사유를 구분하지 않는다(아이디 없음/비밀번호 틀림 동일 문구) — 서버도 같은 이유로
//    한 문구만 던진다. 구분하면 유효한 관리자 아이디를 열거할 수 있다.

import * as React from "react"

import { useRouter, useSearchParams } from "next/navigation"

import { useMutation } from "@tanstack/react-query"

import { AdminBrandMark } from "@/components/admin/admin-brand-mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTRPC } from "@/trpc/client"

export function AdminLoginView({ siteName }: { siteName: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const searchParams = useSearchParams()

  const loginMutation = useMutation(trpc.adminAuth.login.mutationOptions())

  const [loginId, setLoginId] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [passwordVisible, setPasswordVisible] = React.useState(false)
  const [failureMessage, setFailureMessage] = React.useState<string | null>(null)
  /** 2단계 진입 — 비밀번호가 맞았고 앱 코드만 남은 상태 */
  const [totpRequired, setTotpRequired] = React.useState(false)
  const [totpCode, setTotpCode] = React.useState("")
  const totpRef = React.useRef<HTMLInputElement>(null)

  const loginIdRef = React.useRef<HTMLInputElement>(null)
  const passwordRef = React.useRef<HTMLInputElement>(null)

  /** 복귀 경로 — 오픈 리다이렉트를 막기 위해 /admin 하위만 허용한다 */
  function resolveNextPath(): string {
    const requested = searchParams.get("next")
    if (!requested) return "/admin"
    if (!requested.startsWith("/admin") || requested.startsWith("//")) return "/admin"
    return requested
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loginMutation.isPending) return

    if (!loginId.trim()) {
      setFailureMessage("아이디를 입력해 주세요.")
      loginIdRef.current?.focus()
      return
    }
    if (!password) {
      setFailureMessage("비밀번호를 입력해 주세요.")
      passwordRef.current?.focus()
      return
    }

    if (totpRequired && !totpCode.trim()) {
      setFailureMessage("앱에 표시된 6자리 인증 코드를 입력해 주세요.")
      totpRef.current?.focus()
      return
    }

    setFailureMessage(null)
    loginMutation.mutate(
      {
        loginId: loginId.trim(),
        password,
        totpCode: totpRequired ? totpCode.trim() : undefined,
      },
      {
        onSuccess: (loginResult) => {
          // 비밀번호 통과 + TOTP 계정 → 코드 입력 단계로. 세션은 아직 없다
          if (loginResult.requiresTotp) {
            setTotpRequired(true)
            window.setTimeout(() => totpRef.current?.focus(), 0)
            return
          }
          // 서버 컴포넌트(레이아웃)가 세션을 다시 읽어야 셸이 붙는다
          router.replace(resolveNextPath())
          router.refresh()
        },
        onError: (loginError) => {
          setFailureMessage(loginError.message)
          if (totpRequired) {
            // 코드만 틀렸다 — 비밀번호를 지우면 처음부터 다시 치게 된다
            setTotpCode("")
            totpRef.current?.focus()
          } else {
            setPassword("")
            passwordRef.current?.focus()
          }
        },
      },
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="flex justify-center">
          <AdminBrandMark siteName={siteName} />
        </div>

        <h1 className="mt-6 text-center font-heading text-xl font-extrabold">관리자 로그인</h1>

        <form className="mt-6 flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div>
            <Label htmlFor="admin-login-id" required>
              관리자 아이디
            </Label>
            <Input
              id="admin-login-id"
              ref={loginIdRef}
              className="mt-1.5"
              autoComplete="username"
              placeholder="admin"
              value={loginId}
              aria-invalid={failureMessage ? true : undefined}
              onChange={(event) => setLoginId(event.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="admin-password" required>
              비밀번호
            </Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="admin-password"
                ref={passwordRef}
                type={passwordVisible ? "text" : "password"}
                autoComplete="current-password"
                placeholder="비밀번호"
                value={password}
                aria-invalid={failureMessage ? true : undefined}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm-46"
                aria-label="비밀번호 표시 전환"
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((previous) => !previous)}
              >
                {passwordVisible ? "숨김" : "표시"}
              </Button>
            </div>
          </div>

          {/* 2단계 — 비밀번호가 통과해야만 나타난다. 처음부터 보여주면
              TOTP를 안 켠 관리자가 "나도 코드가 필요한가" 헤맨다 */}
          {totpRequired ? (
            <div>
              <Label htmlFor="admin-totp" required>
                인증 코드
              </Label>
              <Input
                id="admin-totp"
                ref={totpRef}
                className="mt-1.5 tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={totpCode}
                aria-describedby="admin-totp-hint"
                onChange={(event) =>
                  setTotpCode(event.target.value.replace(/[^0-9]/g, ""))
                }
              />
              <p id="admin-totp-hint" className="m-0 mt-1.5 text-xs text-muted-foreground">
                인증 앱(Google OTP 등)에 표시된 6자리를 입력하세요. 30초마다 바뀝니다.
              </p>
            </div>
          ) : null}

          {/* 실패는 원인을 구분하지 않는다 — 아이디 열거 방지 */}
          {failureMessage ? (
            <p
              role="alert"
              className="m-0 rounded-[calc(var(--radius)-2px)] border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-[13px] text-destructive"
            >
              {failureMessage}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg-52" className="mt-1 w-full">
            {loginMutation.isPending
              ? "확인 중…"
              : totpRequired
                ? "인증하고 로그인"
                : "로그인"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          모든 관리자 접속·행위는 기록됩니다.
        </p>
      </div>
    </main>
  )
}
