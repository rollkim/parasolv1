"use client"

// 핸드오프 규격: PaRaSOL 로그인.dc.html — 중앙 카드(420px) · 로그인/회원가입 탭(균등분할 레일) ·
// .au-input 50px · 로그인 버튼 52px · 커스텀 체크(22/24px) · 가입 스텝 인디케이터(점 26px + 연결바 3px)
// [탭 순서](목업 L100에서 범위 제외분 반영): 1 로그인탭 → 2 회원가입탭 →
// (로그인) 3 아이디 → 4 비번 → 5 비번표시 → 6 로그인버튼 → 7 소셜 3종 ·
// (가입) 3 전체동의 → 4 개별약관 → 5 다음
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 카드 상단 로고·비회원 주문조회 링크 없음: 브랜딩·홈 동선은 공통 셸(StoreHeader) 몫(장바구니 선례).
//    비회원 주문조회 화면은 미구현 — 배선 시 카드 아래 링크로 추가한다.
//  - 아이디 라벨이 "이메일 또는 아이디"가 아니라 "아이디": 스키마상 로그인 아이디(영문 소문자·숫자)와
//    이메일이 분리돼 있고 이메일 로그인은 지원하지 않는다.
//  - placeholder 단독이 아니라 가시 라벨 병기: 값 입력 후 라벨이 사라지는 문제 방지(WCAG 3.3.2).
//  - 로그인 유지 체크·비밀번호 재설정 없음: 세션 만료는 서버 정책(30일 고정)이라 체크가 동작을 갖지
//    못하고, 재설정 프로시저는 미구현(후속 배선).
//  - 간편 로그인(지문/PASS/QR) 미렌더: 3차 기능 숨김 확정. 소셜 3종은 키 발급 대기라 자리만 두고
//    클릭 시 준비중 토스트를 낸다(native disabled는 클릭 자체가 막혀 안내가 불가능하다).
//  - 가입 위저드는 4단계(약관/인증/정보/완료)에서 본인 인증을 뺀 3단계: PASS 연동 범위 제외 확정.
//    이름은 인증 연동 readOnly가 아니라 직접 입력 필드다.
//  - 약관 '보기' 링크 없음: 약관 본문 화면 미구현(후속 배선).
//  - 완료 스텝의 쿠폰 지급 pill·문구 없음: 가입 쿠폰 자동 지급이 서버에 없어 표기하면 거짓 안내가 된다.
//  - 완료 스텝 '로그인 화면으로' 버튼 없음: 가입 즉시 자동 로그인되므로 재진입이 무의미하다
//    (로그인 상태의 /login은 홈으로 리다이렉트).
//  - 가입 성공 직후 router.refresh()를 하지 않는다: /login은 로그인 상태면 홈으로 리다이렉트라
//    완료 스텝이 즉시 사라진다 — 헤더 갱신은 '쇼핑 시작하기'(push 후 refresh)로 미룬다.

import * as React from "react"

import { useMutation } from "@tanstack/react-query"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type AuthTabName = "login" | "signup"

/* ── 공통 소품 ─────────────────────────────────────────────── */

/** 표시용 체크박스 — 목업 [data-check] 실측(개별 22px·전체동의 24px). cart-view의 것과 동일
 *  규격이지만 그쪽은 파일 내부 전용이라 재선언한다 — 세 번째 사용처가 생기면 ui로 승격 후보. */
function AgreeCheckMark({
  checked,
  checkBoxSize = 22,
}: {
  checked: boolean
  checkBoxSize?: 22 | 24
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: checkBoxSize, height: checkBoxSize }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[6px] border-[1.5px]",
        checked ? "border-primary bg-primary" : "border-border bg-card"
      )}
    >
      {checked && (
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          className="text-primary-foreground"
          aria-hidden="true"
        >
          <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

/** 구분선 라벨("소셜 계정으로") — 목업의 hr+텍스트 조합 */
function LabeledDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-[18px] flex items-center gap-3 text-xs font-semibold text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  )
}

/* ── 로그인 패널 ───────────────────────────────────────────── */

// 카카오·네이버 색은 각 사 공식 CI 규정값(목업 리터럴 동일) — 리스킨 대상이 아니라 토큰화하지 않는다
const SOCIAL_LOGIN_PROVIDERS = [
  {
    providerKey: "kakao",
    buttonLabel: "카카오로 시작하기",
    buttonClassName: "border-transparent bg-[#FEE500] text-[#191600]",
  },
  {
    providerKey: "naver",
    buttonLabel: "네이버로 시작하기",
    buttonClassName: "border-transparent bg-[#03C75A] text-white",
  },
  {
    providerKey: "google",
    buttonLabel: "Google로 시작하기",
    buttonClassName: "border-border bg-card text-foreground",
  },
] as const

/**
 * 로그인·가입 후 돌아갈 곳. 체크아웃이 /login?next=/checkout으로 보내는데
 * 이걸 무시하면 담아 둔 장바구니를 두고 홈으로 튕긴다.
 *
 * **외부 URL은 받지 않는다** — 슬래시 하나로 시작하는 내부 경로만 허용한다.
 * 그러지 않으면 ?next=https://evil.example 로 우리 로그인 화면을 미끼 삼는
 * 오픈 리다이렉트가 된다("//evil.example"도 브라우저에는 외부 주소다).
 */
function useNextPath(): string {
  const searchParams = useSearchParams()
  const requestedPath = searchParams.get("next")
  if (!requestedPath) return "/"
  if (!requestedPath.startsWith("/") || requestedPath.startsWith("//")) return "/"
  return requestedPath
}

function LoginPanel() {
  const trpc = useTRPC()
  const router = useRouter()
  const nextPath = useNextPath()
  const { showToast } = useToast()

  const loginMutation = useMutation(trpc.auth.login.mutationOptions())

  const [loginId, setLoginId] = React.useState("")
  const [loginPassword, setLoginPassword] = React.useState("")
  const [showLoginPassword, setShowLoginPassword] = React.useState(false)
  const [loginFieldErrors, setLoginFieldErrors] = React.useState<{
    loginId?: string
    password?: string
  }>({})
  // 서버가 판정하는 실패(아이디/비번 불일치)는 특정 필드 귀속이 아니라 폼 레벨로 보여준다
  const [loginFormError, setLoginFormError] = React.useState<string | null>(null)

  const handleLoginSubmit = (formSubmitEvent: React.FormEvent<HTMLFormElement>) => {
    formSubmitEvent.preventDefault()
    if (loginMutation.isPending) return

    const trimmedLoginId = loginId.trim()
    const fieldErrors: typeof loginFieldErrors = {}
    if (!trimmedLoginId) fieldErrors.loginId = "아이디를 입력해 주세요."
    if (!loginPassword) fieldErrors.password = "비밀번호를 입력해 주세요."
    setLoginFieldErrors(fieldErrors)
    if (fieldErrors.loginId || fieldErrors.password) {
      document
        .getElementById(fieldErrors.loginId ? "login-id" : "login-password")
        ?.focus()
      return
    }

    setLoginFormError(null)
    loginMutation.mutate(
      { loginId: trimmedLoginId, password: loginPassword },
      {
        onSuccess: (sessionProfile) => {
          showToast(`${sessionProfile.name}님, 환영해요!`)
          // push가 먼저 처리되고 refresh가 새 라우트 기준으로 서버 트리를 다시 그린다 —
          // 순서를 바꾸면 /login의 리다이렉트를 한 번 더 타게 된다
          router.push(nextPath)
          router.refresh()
        },
        onError: (loginError) => {
          // zod 다중 이슈는 message가 JSON 배열 문자열로 온다 — 그대로 노출하지 않는다
          setLoginFormError(
            loginError.message.startsWith("[")
              ? "아이디와 비밀번호를 다시 확인해 주세요."
              : loginError.message
          )
        },
      }
    )
  }

  const handleSocialLoginClick = () => {
    showToast("소셜 로그인은 준비 중이에요. 아이디 로그인을 이용해 주세요.", {
      toastVariant: "info",
    })
  }

  return (
    <div className="pt-4">
      <form onSubmit={handleLoginSubmit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-id">아이디</Label>
          <Input
            id="login-id"
            size="auth"
            type="text"
            autoComplete="username"
            placeholder="아이디"
            value={loginId}
            onChange={(changeEvent) => {
              setLoginId(changeEvent.target.value)
              setLoginFieldErrors((previousErrors) => ({ ...previousErrors, loginId: undefined }))
            }}
            aria-invalid={loginFieldErrors.loginId ? true : undefined}
            aria-describedby={loginFieldErrors.loginId ? "login-id-error" : undefined}
          />
          {loginFieldErrors.loginId && (
            <p id="login-id-error" className="m-0 text-xs font-semibold text-destructive">
              {loginFieldErrors.loginId}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">비밀번호</Label>
          <div className="relative">
            <Input
              id="login-password"
              size="auth"
              type={showLoginPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="비밀번호"
              className="pr-[46px]"
              value={loginPassword}
              onChange={(changeEvent) => {
                setLoginPassword(changeEvent.target.value)
                setLoginFieldErrors((previousErrors) => ({ ...previousErrors, password: undefined }))
              }}
              aria-invalid={loginFieldErrors.password ? true : undefined}
              aria-describedby={loginFieldErrors.password ? "login-password-error" : undefined}
            />
            {/* 목업 38×38 실측 유지 + after로 히트 영역 44px 확장(KWCAG) */}
            <button
              type="button"
              aria-label="비밀번호 표시 전환"
              aria-pressed={showLoginPassword}
              onClick={() => setShowLoginPassword((previousShown) => !previousShown)}
              className="absolute top-1/2 right-1.5 flex size-[38px] -translate-y-1/2 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground after:absolute after:-inset-[3px] after:content-['']"
            >
              {showLoginPassword ? (
                <EyeOffIcon className="size-5" aria-hidden="true" />
              ) : (
                <EyeIcon className="size-5" aria-hidden="true" />
              )}
            </button>
          </div>
          {loginFieldErrors.password && (
            <p id="login-password-error" className="m-0 text-xs font-semibold text-destructive">
              {loginFieldErrors.password}
            </p>
          )}
        </div>

        {loginFormError && (
          <p role="alert" className="m-0 text-[13px] font-semibold text-destructive">
            {loginFormError}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg-52" className="mt-1 w-full">
          {loginMutation.isPending ? "로그인 중…" : "로그인"}
        </Button>
      </form>

      <LabeledDivider>소셜 계정으로</LabeledDivider>

      <div className="flex flex-col gap-[9px]">
        {SOCIAL_LOGIN_PROVIDERS.map((socialProvider) => (
          <button
            key={socialProvider.providerKey}
            type="button"
            onClick={handleSocialLoginClick}
            className={cn(
              "flex min-h-[50px] w-full cursor-pointer items-center justify-center rounded-[calc(var(--radius)-2px)] border text-[15px] font-bold transition-[filter] hover:brightness-[0.97]",
              socialProvider.buttonClassName
            )}
          >
            {socialProvider.buttonLabel}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── 회원가입 위저드 ───────────────────────────────────────── */

type SignupStepName = "terms" | "account" | "complete"

const SIGNUP_STEP_LABELS: { stepName: SignupStepName; stepLabel: string }[] = [
  { stepName: "terms", stepLabel: "약관" },
  { stepName: "account", stepLabel: "정보" },
  { stepName: "complete", stepLabel: "완료" },
]

type TermsAgreementCode = "age" | "terms" | "privacy" | "marketing"

const AGREEMENT_ITEMS: {
  agreementCode: TermsAgreementCode
  agreementLabel: string
  isRequired: boolean
}[] = [
  { agreementCode: "age", agreementLabel: "만 14세 이상입니다", isRequired: true },
  { agreementCode: "terms", agreementLabel: "이용약관 동의", isRequired: true },
  { agreementCode: "privacy", agreementLabel: "개인정보 수집·이용 동의", isRequired: true },
  { agreementCode: "marketing", agreementLabel: "마케팅 정보 수신 동의", isRequired: false },
]

const REQUIRED_AGREEMENT_CODES = AGREEMENT_ITEMS.filter(
  (agreementItem) => agreementItem.isRequired
).map((agreementItem) => agreementItem.agreementCode)

type SignupFieldKey = "loginId" | "password" | "passwordConfirm" | "name" | "email" | "phone"

const SIGNUP_ACCOUNT_FIELDS: {
  fieldKey: SignupFieldKey
  fieldLabel: string
  fieldPlaceholder: string
  inputType: "text" | "password" | "email" | "tel"
  autoCompleteToken: string
}[] = [
  {
    fieldKey: "loginId",
    fieldLabel: "아이디",
    fieldPlaceholder: "영문 소문자·숫자 4~20자",
    inputType: "text",
    autoCompleteToken: "username",
  },
  {
    fieldKey: "password",
    fieldLabel: "비밀번호",
    fieldPlaceholder: "8자 이상",
    inputType: "password",
    autoCompleteToken: "new-password",
  },
  {
    fieldKey: "passwordConfirm",
    fieldLabel: "비밀번호 확인",
    fieldPlaceholder: "비밀번호를 한 번 더 입력",
    inputType: "password",
    autoCompleteToken: "new-password",
  },
  {
    fieldKey: "name",
    fieldLabel: "이름",
    fieldPlaceholder: "이름",
    inputType: "text",
    autoCompleteToken: "name",
  },
  {
    fieldKey: "email",
    fieldLabel: "이메일",
    fieldPlaceholder: "name@example.com",
    inputType: "email",
    autoCompleteToken: "email",
  },
  {
    fieldKey: "phone",
    fieldLabel: "휴대폰 번호",
    fieldPlaceholder: "'-' 없이 숫자만",
    inputType: "tel",
    autoCompleteToken: "tel",
  },
]

/** auth.signup의 zod 규칙과 동일한 클라이언트 사전 검증 — 최종 판정은 항상 서버가 한다 */
function validateSignupAccountFields(
  accountFieldValues: Record<SignupFieldKey, string>
): Partial<Record<SignupFieldKey, string>> {
  const fieldErrors: Partial<Record<SignupFieldKey, string>> = {}

  if (!/^[a-z0-9]{4,20}$/.test(accountFieldValues.loginId)) {
    fieldErrors.loginId = "아이디는 영문 소문자·숫자 4~20자로 입력해 주세요."
  }
  if (accountFieldValues.password.length < 8) {
    fieldErrors.password = "비밀번호는 8자 이상 입력해 주세요."
  } else if (accountFieldValues.password.length > 72) {
    fieldErrors.password = "비밀번호는 72자 이하로 입력해 주세요."
  }
  if (
    accountFieldValues.passwordConfirm.length === 0 ||
    accountFieldValues.passwordConfirm !== accountFieldValues.password
  ) {
    fieldErrors.passwordConfirm =
      "비밀번호가 일치하지 않아요. 같은 비밀번호를 한 번 더 입력해 주세요."
  }
  if (accountFieldValues.name.trim().length === 0) {
    fieldErrors.name = "이름을 입력해 주세요."
  } else if (accountFieldValues.name.trim().length > 50) {
    fieldErrors.name = "이름은 50자 이하로 입력해 주세요."
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountFieldValues.email)) {
    fieldErrors.email = "이메일 형식이 올바르지 않습니다. name@example.com 형태로 입력해 주세요."
  }
  if (!/^01[016789][0-9]{7,8}$/.test(accountFieldValues.phone.replaceAll("-", ""))) {
    fieldErrors.phone =
      "휴대폰 번호 형식이 올바르지 않습니다. '-' 없이 01로 시작하는 번호를 입력해 주세요."
  }

  return fieldErrors
}

/** 스텝 인디케이터 — 점 26px 원 + 연결바 3px + 라벨 11px(목업 실측, 인증 제외 3단계) */
function SignupStepIndicator({ currentStepIndex }: { currentStepIndex: number }) {
  return (
    <ol aria-label="가입 진행 단계" className="m-0 mb-5 flex list-none p-0">
      {SIGNUP_STEP_LABELS.map((signupStep, stepIndex) => {
        const isReached = stepIndex <= currentStepIndex
        return (
          <li
            key={signupStep.stepName}
            aria-current={stepIndex === currentStepIndex ? "step" : undefined}
            className="flex flex-1 flex-col items-center gap-1.5"
          >
            {/* 점·연결바는 장식 — 진행 상태는 라벨 + aria-current가 전달한다 */}
            <span aria-hidden="true" className="flex w-full items-center">
              <span
                className={cn(
                  "h-[3px] flex-1",
                  stepIndex === 0
                    ? "bg-transparent"
                    : isReached
                      ? "bg-primary"
                      : "bg-border"
                )}
              />
              <span
                className={cn(
                  "flex size-[26px] items-center justify-center rounded-full text-xs font-extrabold",
                  isReached
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-muted-foreground"
                )}
              >
                {stepIndex < currentStepIndex ? "✓" : stepIndex + 1}
              </span>
              <span
                className={cn(
                  "h-[3px] flex-1",
                  stepIndex === SIGNUP_STEP_LABELS.length - 1
                    ? "bg-transparent"
                    : stepIndex < currentStepIndex
                      ? "bg-primary"
                      : "bg-border"
                )}
              />
            </span>
            <span
              className={cn(
                "text-[11px] font-bold",
                stepIndex === currentStepIndex ? "text-primary" : "text-muted-foreground"
              )}
            >
              {signupStep.stepLabel}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function SignupWizard({ siteName }: { siteName: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const nextPath = useNextPath()
  const { showToast } = useToast()

  const signupMutation = useMutation(trpc.auth.signup.mutationOptions())

  const [signupStep, setSignupStep] = React.useState<SignupStepName>("terms")
  const [agreedCodes, setAgreedCodes] = React.useState<Set<TermsAgreementCode>>(
    () => new Set()
  )
  const [termsStepError, setTermsStepError] = React.useState<string | null>(null)
  const [accountFieldValues, setAccountFieldValues] = React.useState<
    Record<SignupFieldKey, string>
  >({ loginId: "", password: "", passwordConfirm: "", name: "", email: "", phone: "" })
  const [accountFieldErrors, setAccountFieldErrors] = React.useState<
    Partial<Record<SignupFieldKey, string>>
  >({})
  // 완료 문구용 — 서버가 확정한 이름(트림 반영)을 그대로 쓴다
  const [completedCustomerName, setCompletedCustomerName] = React.useState("")

  /* 스텝 전환 시 제목으로 포커스를 옮긴다 — 키보드·스크린리더가 위저드 진행을 놓치지 않게(KWCAG).
     첫 렌더(탭 진입)는 탭 자체에 포커스가 있어야 하므로 건너뛴다. */
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null)
  const isFirstStepRenderRef = React.useRef(true)
  React.useEffect(() => {
    if (isFirstStepRenderRef.current) {
      isFirstStepRenderRef.current = false
      return
    }
    stepHeadingRef.current?.focus()
  }, [signupStep])

  const allAgreed = AGREEMENT_ITEMS.every((agreementItem) =>
    agreedCodes.has(agreementItem.agreementCode)
  )

  const handleToggleAgreement = (agreementCode: TermsAgreementCode) => {
    setTermsStepError(null)
    setAgreedCodes((previousCodes) => {
      const nextCodes = new Set(previousCodes)
      if (nextCodes.has(agreementCode)) nextCodes.delete(agreementCode)
      else nextCodes.add(agreementCode)
      return nextCodes
    })
  }

  const handleToggleAllAgreements = () => {
    setTermsStepError(null)
    setAgreedCodes(
      allAgreed
        ? new Set()
        : new Set(AGREEMENT_ITEMS.map((agreementItem) => agreementItem.agreementCode))
    )
  }

  const handleTermsNextClick = () => {
    const hasAllRequired = REQUIRED_AGREEMENT_CODES.every((requiredCode) =>
      agreedCodes.has(requiredCode)
    )
    if (!hasAllRequired) {
      setTermsStepError("필수 약관에 모두 동의해 주세요.")
      return
    }
    setSignupStep("account")
  }

  const handleAccountFieldChange = (fieldKey: SignupFieldKey, fieldValue: string) => {
    setAccountFieldValues((previousValues) => ({ ...previousValues, [fieldKey]: fieldValue }))
    // 수정을 시작하면 해당 필드의 지난 오류는 걷어낸다 — 재검증은 제출 시점에
    setAccountFieldErrors((previousErrors) => {
      if (!previousErrors[fieldKey]) return previousErrors
      const nextErrors = { ...previousErrors }
      delete nextErrors[fieldKey]
      return nextErrors
    })
  }

  const focusFirstErroredField = (
    fieldErrors: Partial<Record<SignupFieldKey, string>>
  ) => {
    const firstErroredField = SIGNUP_ACCOUNT_FIELDS.find(
      (fieldSpec) => fieldErrors[fieldSpec.fieldKey]
    )
    if (firstErroredField) {
      document.getElementById(`signup-${firstErroredField.fieldKey}`)?.focus()
    }
  }

  const handleSignupSubmit = (formSubmitEvent: React.FormEvent<HTMLFormElement>) => {
    formSubmitEvent.preventDefault()
    if (signupMutation.isPending) return

    const fieldErrors = validateSignupAccountFields(accountFieldValues)
    setAccountFieldErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) {
      focusFirstErroredField(fieldErrors)
      return
    }

    signupMutation.mutate(
      {
        loginId: accountFieldValues.loginId,
        password: accountFieldValues.password,
        name: accountFieldValues.name.trim(),
        email: accountFieldValues.email,
        phone: accountFieldValues.phone,
        agreedTermsCodes: [...agreedCodes],
      },
      {
        onSuccess: (sessionProfile) => {
          setCompletedCustomerName(sessionProfile.name)
          setSignupStep("complete")
        },
        onError: (signupError) => {
          // 아이디 중복(CONFLICT)은 원인 필드로 되돌린다 — 사용자가 고칠 지점이 명확하다
          if (signupError.data?.code === "CONFLICT") {
            setAccountFieldErrors({ loginId: signupError.message })
            document.getElementById("signup-loginId")?.focus()
            return
          }
          // zod 다중 이슈는 message가 JSON 배열 문자열로 온다 — 그대로 노출하지 않는다
          showToast(
            signupError.message.startsWith("[")
              ? "가입을 완료하지 못했어요. 입력값을 확인하고 다시 시도해 주세요."
              : signupError.message,
            { toastVariant: "error" }
          )
        },
      }
    )
  }

  const handleStartShoppingClick = () => {
    // push가 먼저 처리되고 refresh가 새 라우트 기준으로 서버 트리를 다시 그린다 —
    // 이 시점에서야 헤더가 로그인 상태(마이페이지·로그아웃)로 바뀐다(파일 상단 사유 참조)
    router.push(nextPath)
    router.refresh()
  }

  const currentStepIndex = SIGNUP_STEP_LABELS.findIndex(
    (signupStepSpec) => signupStepSpec.stepName === signupStep
  )

  return (
    <div className="pt-4">
      <SignupStepIndicator currentStepIndex={currentStepIndex} />

      {/* key로 스텝마다 remount해 진입 애니메이션을 다시 태운다(reduced-motion은 전역 CSS가 존중) */}
      <div key={signupStep} className="animate-fade-in">
        {signupStep === "terms" && (
          <section aria-label="약관 동의">
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="m-0 text-[19px] font-extrabold outline-none"
            >
              약관에 동의해 주세요
            </h2>
            <p className="m-0 mt-1.5 text-[13px] text-muted-foreground">
              서비스 이용에 필요한 약관을 확인하고 동의해 주세요.
            </p>

            <button
              type="button"
              role="checkbox"
              aria-checked={allAgreed}
              onClick={handleToggleAllAgreements}
              className="mt-4 flex min-h-[52px] w-full cursor-pointer items-center gap-2.5 rounded-[calc(var(--radius)-3px)] bg-secondary px-3.5 text-left text-[15px] font-extrabold text-secondary-foreground"
            >
              <AgreeCheckMark checked={allAgreed} checkBoxSize={24} />
              약관 전체 동의
            </button>

            <div className="mt-2 flex flex-col">
              {AGREEMENT_ITEMS.map((agreementItem) => (
                <button
                  key={agreementItem.agreementCode}
                  type="button"
                  role="checkbox"
                  aria-checked={agreedCodes.has(agreementItem.agreementCode)}
                  aria-label={`${agreementItem.isRequired ? "필수" : "선택"} 동의: ${agreementItem.agreementLabel}`}
                  onClick={() => handleToggleAgreement(agreementItem.agreementCode)}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-1 text-left"
                >
                  <AgreeCheckMark checked={agreedCodes.has(agreementItem.agreementCode)} />
                  {/* 필수/선택은 색 + 텍스트 이중 전달(KWCAG) */}
                  <span
                    className={cn(
                      "shrink-0 text-xs font-bold",
                      agreementItem.isRequired ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    [{agreementItem.isRequired ? "필수" : "선택"}]
                  </span>
                  <span className="text-[13px]">{agreementItem.agreementLabel}</span>
                </button>
              ))}
            </div>

            {termsStepError && (
              <p role="alert" className="m-0 mt-2 text-xs font-semibold text-destructive">
                {termsStepError}
              </p>
            )}

            <Button
              type="button"
              variant="primary"
              size="lg-52"
              className="mt-4 w-full"
              onClick={handleTermsNextClick}
            >
              다음
            </Button>
          </section>
        )}

        {signupStep === "account" && (
          <section aria-label="계정 정보 입력">
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="m-0 text-[19px] font-extrabold outline-none"
            >
              계정 정보 입력
            </h2>
            <p className="m-0 mt-1.5 text-[13px] text-muted-foreground">
              로그인에 사용할 정보를 입력해 주세요.
            </p>

            <form
              onSubmit={handleSignupSubmit}
              noValidate
              className="mt-4 flex flex-col gap-3"
            >
              {SIGNUP_ACCOUNT_FIELDS.map((fieldSpec) => {
                const fieldErrorMessage = accountFieldErrors[fieldSpec.fieldKey]
                const inputElementId = `signup-${fieldSpec.fieldKey}`
                const errorElementId = `${inputElementId}-error`
                return (
                  <div key={fieldSpec.fieldKey} className="flex flex-col gap-1.5">
                    <Label htmlFor={inputElementId} required>
                      {fieldSpec.fieldLabel}
                    </Label>
                    <Input
                      id={inputElementId}
                      size="auth"
                      type={fieldSpec.inputType}
                      autoComplete={fieldSpec.autoCompleteToken}
                      placeholder={fieldSpec.fieldPlaceholder}
                      value={accountFieldValues[fieldSpec.fieldKey]}
                      onChange={(changeEvent) =>
                        handleAccountFieldChange(fieldSpec.fieldKey, changeEvent.target.value)
                      }
                      aria-invalid={fieldErrorMessage ? true : undefined}
                      aria-describedby={fieldErrorMessage ? errorElementId : undefined}
                    />
                    {fieldErrorMessage && (
                      <p
                        id={errorElementId}
                        className="m-0 text-xs font-semibold text-destructive"
                      >
                        {fieldErrorMessage}
                      </p>
                    )}
                  </div>
                )
              })}

              <div className="mt-1 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg-52"
                  className="flex-1"
                  onClick={() => setSignupStep("terms")}
                >
                  이전
                </Button>
                <Button type="submit" variant="primary" size="lg-52" className="flex-[1.6]">
                  {signupMutation.isPending ? "가입 처리 중…" : "가입 완료"}
                </Button>
              </div>
            </form>
          </section>
        )}

        {signupStep === "complete" && (
          <section
            aria-label="가입 완료"
            className="flex flex-col items-center gap-3 py-4 text-center"
          >
            <div
              aria-hidden="true"
              className="flex size-[70px] items-center justify-center rounded-full bg-secondary text-primary"
            >
              <svg
                width={34}
                height={34}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.6}
                aria-hidden="true"
              >
                <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              className="m-0 text-[21px] font-extrabold outline-none"
            >
              가입을 환영해요!
            </h2>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">
              {completedCustomerName}님, {siteName} 회원이 되셨어요.
              <br />
              자동으로 로그인되었어요. 바로 쇼핑을 시작해 보세요.
            </p>
            <Button
              type="button"
              variant="primary"
              size="lg-52"
              className="mt-2 w-full"
              onClick={handleStartShoppingClick}
            >
              쇼핑 시작하기
            </Button>
          </section>
        )}
      </div>
    </div>
  )
}

/* ── 진입점 ────────────────────────────────────────────────── */

type AuthViewProps = {
  /** site_setting의 상호 — 완료 문구에 쓴다(브랜드 하드코딩 금지, RULE-11) */
  siteName: string
  initialAuthTab: AuthTabName
}

export function AuthView({ siteName, initialAuthTab }: AuthViewProps) {
  const [authTab, setAuthTab] = React.useState<AuthTabName>(initialAuthTab)

  // 탭 전환 시 비활성 패널은 unmount된다(Radix 기본) — 로그인 오류·가입 진행 상태가 함께
  // 초기화되는데, 목업도 탭 전환 시 오류·스텝을 리셋하므로 의도된 동작으로 둔다.
  return (
    <div className="rounded-lg border border-border bg-card p-[clamp(20px,4vw,30px)]">
      <Tabs
        value={authTab}
        onValueChange={(nextTabValue) => setAuthTab(nextTabValue as AuthTabName)}
      >
        <TabsList variant="underline-full" aria-label="로그인 또는 회원가입" className="mb-0">
          <TabsTrigger value="login">로그인</TabsTrigger>
          <TabsTrigger value="signup">회원가입</TabsTrigger>
        </TabsList>
        <TabsContent value="login">
          <LoginPanel />
        </TabsContent>
        <TabsContent value="signup">
          <SignupWizard siteName={siteName} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
