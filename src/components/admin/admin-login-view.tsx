"use client"

// 핸드오프 규격: 관리자 로그인.dc.html — 브랜드 마크 + 아이디/비밀번호 + 로그인 버튼 +
// "모든 관리자 접속·행위는 기록됩니다" 각주.
// [탭 순서](목업 L?): 1 아이디 → 2 비밀번호 → 3 표시 토글 → 4 로그인유지 → 5 로그인
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **2단계 인증(OTP) 단계 제외**: 스펙서 §10이 '관리자 2FA'를 2차로 명시한다.
//    admin_user.totp_secret 컬럼은 이미 있어 2차에 단계만 끼우면 된다.
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

    setFailureMessage(null)
    loginMutation.mutate(
      { loginId: loginId.trim(), password },
      {
        onSuccess: () => {
          // 서버 컴포넌트(레이아웃)가 세션을 다시 읽어야 셸이 붙는다
          router.replace(resolveNextPath())
          router.refresh()
        },
        onError: (loginError) => {
          setFailureMessage(loginError.message)
          setPassword("")
          passwordRef.current?.focus()
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
            {loginMutation.isPending ? "로그인 중…" : "로그인"}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
          모든 관리자 접속·행위는 기록됩니다.
        </p>
      </div>
    </main>
  )
}
