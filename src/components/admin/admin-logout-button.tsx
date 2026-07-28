"use client"

// 관리자 상단바 로그아웃. 세션 쿠키를 지운 뒤 서버 레이아웃이 다시 판정하도록 새로고침한다
// — 레이아웃이 세션 유무로 셸을 붙이므로, 새로고침해야 로그인 화면으로 바뀐다.

import { useRouter } from "next/navigation"

import { useMutation } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { useTRPC } from "@/trpc/client"

export function AdminLogoutButton() {
  const trpc = useTRPC()
  const router = useRouter()
  const { showToast } = useToast()

  const logoutMutation = useMutation(trpc.adminAuth.logout.mutationOptions())

  return (
    <Button
      type="button"
      variant="ghost"
      size="admin-40"
      onClick={() =>
        logoutMutation.mutate(undefined, {
          onSuccess: () => {
            router.replace("/admin/login")
            router.refresh()
          },
          onError: (logoutError) =>
            showToast(logoutError.message, { toastVariant: "error" }),
        })
      }
    >
      {logoutMutation.isPending ? "로그아웃 중…" : "로그아웃"}
    </Button>
  )
}
