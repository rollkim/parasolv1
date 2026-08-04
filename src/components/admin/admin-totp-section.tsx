"use client"

// 2단계 인증 설정 — 관리자 설정 > 보안.
//
// 흐름: 설정 시작(시크릿 발급, 저장 안 됨) → OTP 앱에 키 등록 → 앱 코드 입력 → 활성화.
// **코드가 맞아야만 저장한다** — 앱 등록을 끝내지 못한 채 켜지면 다음 로그인부터 잠긴다.
// QR 없이 '키 직접 입력'만 지원한다(구글 OTP·Authy 모두 지원) — QR 렌더링 하나 때문에
// 인증 경로에 외부 패키지를 들이지 않는다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { useTRPC } from "@/trpc/client"

export function AdminTotpSection() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const statusQuery = useQuery(trpc.adminAuth.totpStatus.queryOptions())
  const startMutation = useMutation(trpc.adminAuth.startTotpSetup.mutationOptions())
  const confirmMutation = useMutation(trpc.adminAuth.confirmTotpSetup.mutationOptions())
  const disableMutation = useMutation(trpc.adminAuth.disableTotp.mutationOptions())

  /** 발급받은 시크릿 — confirm 전까지 서버에 없다. 화면을 떠나면 사라진다(다시 시작하면 된다) */
  const [setupMaterial, setSetupMaterial] = React.useState<{
    secretBase32: string
    otpauthUri: string
  } | null>(null)
  const [confirmCode, setConfirmCode] = React.useState("")
  const [disableCode, setDisableCode] = React.useState("")

  function refresh() {
    void queryClient.invalidateQueries(trpc.adminAuth.pathFilter())
  }

  if (statusQuery.isPending) {
    return (
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <div className="flex min-h-20 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">2단계 인증 상태를 불러오는 중입니다</span>
        </div>
      </section>
    )
  }

  const totpEnabled = statusQuery.data?.totpEnabled ?? false

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">2단계 인증 (OTP)</h2>
        {/* 상태는 색이 아니라 글자로(KWCAG) */}
        <span
          className={
            totpEnabled
              ? "rounded-[5px] border border-primary px-2 py-0.5 text-[12px] font-bold text-primary"
              : "rounded-[5px] border border-border px-2 py-0.5 text-[12px] font-bold text-muted-foreground"
          }
        >
          {totpEnabled ? "사용 중" : "꺼짐"}
        </span>
      </div>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        로그인할 때 비밀번호에 더해 인증 앱(Google OTP·Authy 등)의 6자리 코드를 요구합니다.
        비밀번호가 새어나가도 계정이 지켜집니다.
      </p>

      {totpEnabled ? (
        /* ── 해제 — 현재 코드를 맞혀야 끈다(세션 탈취자가 2단계부터 끄는 것을 막는다) */
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (disableMutation.isPending) return
            disableMutation.mutate(
              { totpCode: disableCode.trim() },
              {
                onSuccess: () => {
                  showToast("2단계 인증을 껐어요.", { toastVariant: "info" })
                  setDisableCode("")
                  refresh()
                },
                onError: (disableError) =>
                  showToast(disableError.message, { toastVariant: "error" }),
              },
            )
          }}
        >
          <div className="flex w-[180px] flex-col gap-1.5">
            <Label htmlFor="totp-disable-code">현재 인증 코드</Label>
            <Input
              id="totp-disable-code"
              size="admin"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={disableCode}
              onChange={(event) =>
                setDisableCode(event.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </div>
          <Button
            type="submit"
            variant="destructive-outline"
            size="admin-40"
            disabled={disableMutation.isPending || disableCode.length !== 6}
          >
            {disableMutation.isPending ? "끄는 중…" : "2단계 인증 끄기"}
          </Button>
        </form>
      ) : setupMaterial === null ? (
        <Button
          type="button"
          variant="primary"
          size="admin-40"
          className="mt-3"
          disabled={startMutation.isPending}
          onClick={() =>
            startMutation.mutate(undefined, {
              onSuccess: (material) => setSetupMaterial(material),
              onError: (startError) =>
                showToast(startError.message, { toastVariant: "error" }),
            })
          }
        >
          {startMutation.isPending ? "준비 중…" : "설정 시작"}
        </Button>
      ) : (
        /* ── 설정 진행 — 키 표시 + 코드 확인 */
        <div className="mt-3 flex flex-col gap-3">
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
            <li>휴대폰에 인증 앱(Google OTP 등)을 엽니다.</li>
            <li>
              &lsquo;설정 키 입력&rsquo;을 고르고 아래 키를 입력합니다.
              <code className="mt-1 block rounded-[calc(var(--radius)-4px)] bg-muted px-3 py-2 font-mono text-[13px] tracking-[0.15em] select-all">
                {setupMaterial.secretBase32}
              </code>
            </li>
            <li>앱에 표시된 6자리 코드를 아래에 입력하면 활성화됩니다.</li>
          </ol>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (confirmMutation.isPending) return
              confirmMutation.mutate(
                { secretBase32: setupMaterial.secretBase32, totpCode: confirmCode.trim() },
                {
                  onSuccess: () => {
                    showToast("2단계 인증을 켰어요. 다음 로그인부터 코드가 필요합니다.", {
                      toastVariant: "info",
                    })
                    setSetupMaterial(null)
                    setConfirmCode("")
                    refresh()
                  },
                  onError: (confirmError) =>
                    showToast(confirmError.message, { toastVariant: "error" }),
                },
              )
            }}
          >
            <div className="flex w-[180px] flex-col gap-1.5">
              <Label htmlFor="totp-confirm-code" required>
                앱의 6자리 코드
              </Label>
              <Input
                id="totp-confirm-code"
                size="admin"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={confirmCode}
                onChange={(event) =>
                  setConfirmCode(event.target.value.replace(/[^0-9]/g, ""))
                }
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="admin-40"
              disabled={confirmMutation.isPending || confirmCode.length !== 6}
            >
              {confirmMutation.isPending ? "확인 중…" : "코드 확인하고 켜기"}
            </Button>
            <Button
              type="button"
              variant="neutral-solid"
              size="admin-40"
              onClick={() => {
                setSetupMaterial(null)
                setConfirmCode("")
              }}
            >
              취소
            </Button>
          </form>
          <p className="m-0 text-[12px] text-muted-foreground">
            코드가 확인되기 전에는 아무것도 저장되지 않아요 — 등록을 끝내지 못해도 로그인이
            잠기지 않습니다.
          </p>
        </div>
      )}
    </section>
  )
}
