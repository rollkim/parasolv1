"use client"

// 헤더 유틸바의 로그아웃 — 링크가 아니라 동작(auth.logout 뮤테이션)이라 별도 클라이언트 컴포넌트다.
// 스타일은 유틸바 링크와 동일 계열(12px·muted → hover primary)로 맞춘다.

import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { useToast } from "@/components/ui/toast"
import { useTRPC } from "@/trpc/client"

export function LogoutButton() {
  const trpc = useTRPC()
  const router = useRouter()
  const { showToast } = useToast()

  const logoutMutation = useMutation(trpc.auth.logout.mutationOptions())

  const handleLogoutClick = () => {
    // aria-disabled는 클릭을 막지 않는다 — 재진입은 여기서 차단(카트 뷰와 동일 패턴)
    if (logoutMutation.isPending) return
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        showToast("로그아웃되었어요")
        // 세션 쿠키가 지워졌으니 서버 트리를 다시 그려 헤더를 비로그인 상태로 되돌린다
        router.refresh()
      },
      onError: () =>
        showToast("로그아웃하지 못했어요. 잠시 후 다시 시도해 주세요.", {
          toastVariant: "error",
        }),
    })
  }

  return (
    <button
      type="button"
      aria-disabled={logoutMutation.isPending}
      onClick={handleLogoutClick}
      className="cursor-pointer transition-colors hover:text-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
      로그아웃
    </button>
  )
}
