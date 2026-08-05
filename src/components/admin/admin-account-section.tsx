"use client"

// 관리자 계정 관리 — 관리자 설정 > 계정.
//
// QA에서 실제로 겪은 구멍을 메운다: 관리자 비밀번호 하나 바꾸는 데 개발자가 SQL을
// 돌려야 했다. 여기서 업체 담당자가 직접 한다 — ① 내 비밀번호 변경(누구나)
// ② 계정 목록·추가·권한·활성·비밀번호/OTP 재발급(owner만).
//
// owner 전용 UI는 role로 숨기지만 **진짜 차단은 서비스가 한다** — 화면 검증은 방어가 아니다.
// 재발급된 임시 비밀번호 평문은 응답 한 번뿐이다(저장은 해시) — 닫으면 다시 볼 수 없다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatDateDot } from "@/lib/format-date"
import { useTRPC } from "@/trpc/client"

const ROLE_LABELS: Record<string, string> = {
  owner: "최고관리자",
  manager: "운영자",
}

export function AdminAccountSection() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const myAccountQuery = useQuery(trpc.adminAccount.myAccount.queryOptions())
  const isOwner = myAccountQuery.data?.role === "owner"

  function refresh() {
    void queryClient.invalidateQueries(trpc.adminAccount.pathFilter())
  }

  return (
    <div className="flex flex-col gap-4">
      <MyPasswordCard />
      {/* owner가 아니면 목록 요청 자체를 보내지 않는다(서버도 거절하지만 오류 화면을 만들 이유가 없다) */}
      {isOwner ? <AccountListCard onChanged={refresh} /> : null}
      {isOwner ? <CreateAccountCard onCreated={refresh} /> : null}
    </div>
  )
}

/** ── 내 비밀번호 변경 — 모든 관리자 공통 ── */
function MyPasswordCard() {
  const trpc = useTRPC()
  const { showToast } = useToast()
  const changeMutation = useMutation(trpc.adminAccount.changeMyPassword.mutationOptions())

  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [newPasswordAgain, setNewPasswordAgain] = React.useState("")

  function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    if (newPassword !== newPasswordAgain) {
      showToast("새 비밀번호가 서로 다릅니다. 다시 확인해 주세요.", { toastVariant: "error" })
      return
    }
    changeMutation.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          showToast("비밀번호를 바꿨어요. 다음 로그인부터 적용됩니다.", { toastVariant: "success" })
          setCurrentPassword("")
          setNewPassword("")
          setNewPasswordAgain("")
        },
        onError: (changeError) => showToast(changeError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">내 비밀번호 변경</h2>
      <form onSubmit={submit} className="mt-3 flex max-w-sm flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-current-password">현재 비밀번호</Label>
          <Input
            id="account-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(inputEvent) => setCurrentPassword(inputEvent.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-new-password">새 비밀번호 (8자 이상)</Label>
          <Input
            id="account-new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={newPassword}
            onChange={(inputEvent) => setNewPassword(inputEvent.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-new-password-again">새 비밀번호 확인</Label>
          <Input
            id="account-new-password-again"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={newPasswordAgain}
            onChange={(inputEvent) => setNewPasswordAgain(inputEvent.target.value)}
            required
          />
        </div>
        <div>
          <Button type="submit" disabled={changeMutation.isPending}>
            {changeMutation.isPending ? "변경 중…" : "비밀번호 변경"}
          </Button>
        </div>
      </form>
    </section>
  )
}

/** ── 계정 목록 — owner 전용 ── */
function AccountListCard({ onChanged }: { onChanged: () => void }) {
  const trpc = useTRPC()
  const { showToast } = useToast()

  const listQuery = useQuery(trpc.adminAccount.list.queryOptions())
  const myAccountQuery = useQuery(trpc.adminAccount.myAccount.queryOptions())
  const changeRoleMutation = useMutation(trpc.adminAccount.changeRole.mutationOptions())
  const changeActiveMutation = useMutation(trpc.adminAccount.changeActive.mutationOptions())
  const resetPasswordMutation = useMutation(trpc.adminAccount.resetPassword.mutationOptions())
  const resetTotpMutation = useMutation(trpc.adminAccount.resetTotp.mutationOptions())

  /** 재발급 평문 — 이 화면에서만 한 번 보인다 */
  const [tempPasswordResult, setTempPasswordResult] = React.useState<{
    loginId: string
    tempPassword: string
  } | null>(null)

  const myAdminId = myAccountQuery.data?.adminUserId

  if (listQuery.isPending) {
    return (
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <div className="flex min-h-20 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">관리자 목록을 불러오는 중입니다</span>
        </div>
      </section>
    )
  }

  const accounts = listQuery.data ?? []

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">관리자 계정</h2>

      {tempPasswordResult ? (
        <div
          role="alert"
          className="mt-3 rounded-[calc(var(--radius)-2px)] border border-primary bg-secondary px-3.5 py-3"
        >
          <b className="block text-[13px] font-extrabold text-secondary-foreground">
            임시 비밀번호: <code className="select-all">{tempPasswordResult.tempPassword}</code>
          </b>
          <p className="m-0 mt-1 text-[12px] text-secondary-foreground/80">
            아이디 <b>{tempPasswordResult.loginId}</b> · 본인에게 직접 전달하세요. 이 화면을
            벗어나면 다시 볼 수 없습니다.
          </p>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-semibold">아이디</th>
              <th className="py-2 pr-3 font-semibold">이름</th>
              <th className="py-2 pr-3 font-semibold">권한</th>
              <th className="py-2 pr-3 font-semibold">2FA</th>
              <th className="py-2 pr-3 font-semibold">상태</th>
              <th className="py-2 pr-3 font-semibold">최근 로그인</th>
              <th className="py-2 font-semibold">조치</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const isMe = account.adminUserId === myAdminId
              return (
                <tr key={account.adminUserId} className="border-b border-border align-middle">
                  <td className="py-2 pr-3 font-medium">
                    {account.loginId}
                    {isMe ? <span className="ml-1 text-[11px] text-muted-foreground">(나)</span> : null}
                  </td>
                  <td className="py-2 pr-3">{account.adminName}</td>
                  <td className="py-2 pr-3">{ROLE_LABELS[account.role] ?? account.role}</td>
                  <td className="py-2 pr-3">{account.totpEnabled ? "사용" : "—"}</td>
                  <td className="py-2 pr-3">
                    {/* 색만으로 전달 금지 — 글자로 */}
                    {account.isActive ? "정상" : <b className="text-destructive">정지</b>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {account.lastLoginAt ? formatDateDot(new Date(account.lastLoginAt)) : "—"}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="admin-38"
                        disabled={changeRoleMutation.isPending}
                        onClick={() =>
                          changeRoleMutation.mutate(
                            {
                              targetAdminId: account.adminUserId,
                              role: account.role === "owner" ? "manager" : "owner",
                            },
                            {
                              onSuccess: () => {
                                showToast("권한을 바꿨어요.", { toastVariant: "success" })
                                onChanged()
                              },
                              onError: (roleError) =>
                                showToast(roleError.message, { toastVariant: "error" }),
                            },
                          )
                        }
                      >
                        {account.role === "owner" ? "운영자로" : "최고관리자로"}
                      </Button>

                      {/* 자기 자신 정지는 서비스가 거절한다 — 버튼도 숨겨 혼란을 줄인다 */}
                      {!isMe ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="admin-38"
                          disabled={changeActiveMutation.isPending}
                          onClick={() =>
                            changeActiveMutation.mutate(
                              {
                                targetAdminId: account.adminUserId,
                                isActive: !account.isActive,
                              },
                              {
                                onSuccess: () => {
                                  showToast(
                                    account.isActive ? "계정을 정지했어요." : "계정을 되살렸어요.",
                                    { toastVariant: "success" },
                                  )
                                  onChanged()
                                },
                                onError: (activeError) =>
                                  showToast(activeError.message, { toastVariant: "error" }),
                              },
                            )
                          }
                        >
                          {account.isActive ? "정지" : "해제"}
                        </Button>
                      ) : null}

                      <Button
                        type="button"
                        variant="outline"
                        size="admin-38"
                        disabled={resetPasswordMutation.isPending}
                        onClick={() =>
                          resetPasswordMutation.mutate(
                            { targetAdminId: account.adminUserId },
                            {
                              onSuccess: (resetResult) => {
                                setTempPasswordResult(resetResult)
                                showToast("임시 비밀번호를 발급했어요.", { toastVariant: "success" })
                              },
                              onError: (resetError) =>
                                showToast(resetError.message, { toastVariant: "error" }),
                            },
                          )
                        }
                      >
                        비번 재발급
                      </Button>

                      {account.totpEnabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="admin-38"
                          disabled={resetTotpMutation.isPending}
                          onClick={() =>
                            resetTotpMutation.mutate(
                              { targetAdminId: account.adminUserId },
                              {
                                onSuccess: () => {
                                  showToast("OTP를 초기화했어요. 다음 로그인부터 다시 등록합니다.", {
                                    toastVariant: "success",
                                  })
                                  onChanged()
                                },
                                onError: (totpError) =>
                                  showToast(totpError.message, { toastVariant: "error" }),
                              },
                            )
                          }
                        >
                          OTP 초기화
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** ── 계정 추가 — owner 전용 ── */
function CreateAccountCard({ onCreated }: { onCreated: () => void }) {
  const trpc = useTRPC()
  const { showToast } = useToast()
  const createMutation = useMutation(trpc.adminAccount.create.mutationOptions())

  const [loginId, setLoginId] = React.useState("")
  const [adminName, setAdminName] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [role, setRole] = React.useState<"owner" | "manager">("manager")

  function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    createMutation.mutate(
      { loginId, password, adminName, role },
      {
        onSuccess: () => {
          showToast(`관리자 계정을 만들었어요: ${loginId}`, { toastVariant: "success" })
          setLoginId("")
          setAdminName("")
          setPassword("")
          setRole("manager")
          onCreated()
        },
        onError: (createError) => showToast(createError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">계정 추가</h2>
      <form onSubmit={submit} className="mt-3 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-new-login-id">아이디 (영문 소문자·숫자 4~20자)</Label>
          <Input
            id="account-new-login-id"
            value={loginId}
            onChange={(inputEvent) => setLoginId(inputEvent.target.value)}
            pattern="[a-z0-9]{4,20}"
            autoComplete="off"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-new-name">이름</Label>
          <Input
            id="account-new-name"
            value={adminName}
            onChange={(inputEvent) => setAdminName(inputEvent.target.value)}
            maxLength={50}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-new-init-password">초기 비밀번호 (8자 이상)</Label>
          <Input
            id="account-new-init-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(inputEvent) => setPassword(inputEvent.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="account-new-role">권한</Label>
          <select
            id="account-new-role"
            value={role}
            onChange={(selectEvent) => setRole(selectEvent.target.value as "owner" | "manager")}
            className="h-11 rounded-[calc(var(--radius)-2px)] border border-input bg-background px-3 text-[14px]"
          >
            <option value="manager">운영자</option>
            <option value="owner">최고관리자</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "만드는 중…" : "계정 추가"}
          </Button>
          <p className="m-0 mt-2 text-[12px] text-muted-foreground">
            초기 비밀번호는 본인에게 직접 전달하고, 첫 로그인 후 위의 &lsquo;내 비밀번호
            변경&rsquo;으로 바꾸게 안내하세요.
          </p>
        </div>
      </form>
    </section>
  )
}
