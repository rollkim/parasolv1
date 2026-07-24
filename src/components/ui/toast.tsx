"use client"

// 핸드오프 규격: PaRaSOL 오버레이모음.dc.html(토스트 마스터 레퍼런스) — 반전 pill · 아이콘 4종 · 실행취소 플래그

import * as React from "react"

import { cn } from "@/lib/utils"

type ToastVariantName = "success" | "error" | "info"

type ToastUndoAction = {
  /** 핸드오프 실측 라벨이 기본값 */
  undoLabel?: string
  onUndo: () => void
}

type ShowToastOptions = {
  toastVariant?: ToastVariantName
  undoAction?: ToastUndoAction
}

type ActiveToast = {
  toastMessage: string
  toastVariant: ToastVariantName
  undoAction?: ToastUndoAction
  /** 새 토스트가 이전 토스트를 대체할 때 진입 애니메이션을 다시 태우기 위한 remount 키 */
  toastSequence: number
}

const TOAST_DURATION_MS = 2600
const TOAST_UNDO_DURATION_MS = 4000
const TOAST_UNDO_DEFAULT_LABEL = "실행취소"

/* 점 색상은 어두운 pill(--foreground) 위 대비 확보용으로 상태 토큰보다 밝아야 한다.
   핸드오프는 리터럴 oklch를 썼지만 리스킨 전제(RULE-11)상 하드코딩할 수 없어,
   상대 색상 문법으로 토큰의 색상(H)·채도(C)는 유지한 채 명도(L)만 끌어올린다.
   globals.css에 --toast-dot-* 전용 토큰이 승격되면 그 값이 자동으로 우선 적용된다. */
const TOAST_VARIANT_SPEC: Record<
  ToastVariantName,
  { iconPaths: string[]; iconStrokeWidth: number; dotColor: string }
> = {
  success: {
    iconPaths: ["m5 12.5 4.5 4.5L19 7"],
    iconStrokeWidth: 2.4,
    dotColor: "var(--toast-dot-success, oklch(from var(--success) 0.82 c h))",
  },
  error: {
    iconPaths: [
      "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
      "M12 8v5",
      "M12 16.5v.2",
    ],
    iconStrokeWidth: 1.8,
    dotColor: "var(--toast-dot-error, oklch(from var(--destructive) 0.72 c h))",
  },
  info: {
    iconPaths: [
      "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
      "M12 11v5",
      "M12 8v.2",
    ],
    iconStrokeWidth: 1.8,
    dotColor: "var(--toast-dot-info, oklch(from var(--info) 0.75 c h))",
  },
}

type ToastContextValue = {
  showToast: (toastMessage: string, options?: ShowToastOptions) => void
  dismissToast: () => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

function ToastVariantIcon({ toastVariant }: { toastVariant: ToastVariantName }) {
  const { iconPaths, iconStrokeWidth, dotColor } = TOAST_VARIANT_SPEC[toastVariant]

  return (
    <span
      data-slot="toast-icon"
      aria-hidden="true"
      className="flex"
      style={{ color: dotColor }}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={iconStrokeWidth}
        aria-hidden="true"
      >
        {iconPaths.map((iconPath) => (
          <path
            key={iconPath}
            d={iconPath}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </span>
  )
}

function ToastViewport({
  activeToast,
  onUndoClick,
  onAutoDismissPause,
  onAutoDismissResume,
}: {
  activeToast: ActiveToast | null
  onUndoClick: () => void
  onAutoDismissPause: () => void
  onAutoDismissResume: () => void
}) {
  /* live region은 토스트와 함께 마운트하지 않고 항상 비워둔 채 유지한다 —
     조건부 생성 시 스크린리더가 낭독을 건너뛸 수 있다. */
  return (
    <div data-slot="toast-viewport" aria-live="polite">
      {activeToast && (
        <div
          key={activeToast.toastSequence}
          data-slot="toast"
          data-variant={activeToast.toastVariant}
          /* WCAG 2.2.1(응답시간 조절): hover·포커스 동안 자동 소멸을 멈춰야
             키보드·스크린리더 사용자가 실행취소 버튼에 도달할 시간을 확보하고,
             포커스된 버튼이 소멸로 사라지며 포커스가 body로 유실되는 것을 막는다.
             onFocus/onBlur는 React가 focusin/focusout으로 위임하므로 내부 버튼까지 커버된다. */
          onPointerEnter={onAutoDismissPause}
          onFocus={onAutoDismissPause}
          onPointerLeave={(pointerLeaveEvent) => {
            // 포커스가 토스트 안에 남아 있으면 hover가 끝나도 일시정지를 유지한다
            if (pointerLeaveEvent.currentTarget.contains(document.activeElement)) return
            onAutoDismissResume()
          }}
          onBlur={(toastBlurEvent) => {
            const toastRootElement = toastBlurEvent.currentTarget
            // 토스트 내부 간 포커스 이동은 이탈이 아니다
            if (toastRootElement.contains(toastBlurEvent.relatedTarget as Node | null)) return
            // 포인터가 아직 올라가 있으면 hover 일시정지 상태를 유지한다
            if (toastRootElement.matches(":hover")) return
            onAutoDismissResume()
          }}
          className={cn(
            "fixed bottom-[var(--toast-bottom,40px)] left-1/2 z-[600] flex max-w-[90vw] items-center gap-[11px] rounded-full bg-foreground px-[18px] py-[13px] text-sm font-semibold text-background shadow-[0_8px_30px_rgba(0,0,0,0.25)]",
            /* 중앙정렬은 반드시 transform 속성으로 지정한다 — Tailwind 4의 -translate-x-1/2는
               별도 translate 속성이라 toastIn 키프레임의 transform과 합성되어 −100%로 밀리고,
               transform 속성이면 애니메이션 중 키프레임이 대체·종료 후 복귀해 항상 −50%가 유지된다 */
            "[transform:translateX(-50%)] animate-toast-in"
          )}
        >
          <ToastVariantIcon toastVariant={activeToast.toastVariant} />
          <span>{activeToast.toastMessage}</span>
          {activeToast.undoAction && (
            <button
              type="button"
              data-slot="toast-undo"
              onClick={onUndoClick}
              /* after 의사요소로 44px 터치 타겟만 확보 — pill 높이(46px)는 그대로 유지.
                 포커스 링 두께·오프셋은 전역 :focus-visible 규칙을 그대로 쓰고,
                 어두운 pill 위 대비를 위해 색만 --ring에서 --background로 반전한다. */
              className="relative ml-1.5 cursor-pointer bg-transparent text-sm font-extrabold text-background underline after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] focus-visible:outline-background"
            >
              {activeToast.undoAction.undoLabel ?? TOAST_UNDO_DEFAULT_LABEL}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [activeToast, setActiveToast] = React.useState<ActiveToast | null>(null)
  const dismissTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastSequenceRef = React.useRef(0)
  /* 일시정지 후 재개 시 재설정할 duration — 잔여 시간 방식은 hover 해제 직후
     극소 잔여로 즉시 소멸하는 문제가 있어 전체 duration으로 재설정한다 */
  const autoDismissDurationRef = React.useRef(TOAST_DURATION_MS)

  const clearDismissTimer = React.useCallback(() => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  const dismissToast = React.useCallback(() => {
    clearDismissTimer()
    setActiveToast(null)
  }, [clearDismissTimer])

  /* 단일 토스트 정책 — 큐·스택 없이 항상 마지막 토스트만 남긴다 */
  const showToast = React.useCallback(
    (toastMessage: string, options?: ShowToastOptions) => {
      const { toastVariant = "success", undoAction } = options ?? {}

      clearDismissTimer()
      toastSequenceRef.current += 1
      setActiveToast({
        toastMessage,
        toastVariant,
        undoAction,
        toastSequence: toastSequenceRef.current,
      })

      autoDismissDurationRef.current = undoAction
        ? TOAST_UNDO_DURATION_MS
        : TOAST_DURATION_MS
      dismissTimerRef.current = setTimeout(
        () => setActiveToast(null),
        autoDismissDurationRef.current
      )
    },
    [clearDismissTimer]
  )

  /* WCAG 2.2.1: hover·포커스 동안 자동 소멸 타이머를 일시정지한다 */
  const pauseAutoDismiss = React.useCallback(() => {
    clearDismissTimer()
  }, [clearDismissTimer])

  const resumeAutoDismiss = React.useCallback(() => {
    clearDismissTimer()
    dismissTimerRef.current = setTimeout(
      () => setActiveToast(null),
      autoDismissDurationRef.current
    )
  }, [clearDismissTimer])

  React.useEffect(() => clearDismissTimer, [clearDismissTimer])

  /* 실행취소는 "타이머 해제 → 토스트 제거 → 콜백" 순서.
     후속 안내 토스트는 도메인 문구이므로 호출부가 결정한다. */
  const handleUndoClick = React.useCallback(() => {
    const pendingUndoAction = activeToast?.undoAction
    dismissToast()
    pendingUndoAction?.onUndo()
  }, [activeToast, dismissToast])

  const toastContextValue = React.useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast]
  )

  return (
    <ToastContext.Provider value={toastContextValue}>
      {children}
      <ToastViewport
        activeToast={activeToast}
        onUndoClick={handleUndoClick}
        onAutoDismissPause={pauseAutoDismiss}
        onAutoDismissResume={resumeAutoDismiss}
      />
    </ToastContext.Provider>
  )
}

function useToast() {
  const toastContextValue = React.useContext(ToastContext)

  if (!toastContextValue) {
    throw new Error("useToast는 ToastProvider 내부에서만 사용할 수 있습니다.")
  }

  return toastContextValue
}

export { ToastProvider, useToast }
