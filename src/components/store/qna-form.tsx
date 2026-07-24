"use client"

// 핸드오프 규격: PaRaSOL 1대1문의.dc.html 문의 작성 폼 — 유형 칩 단일 선택(min-height 40px) ·
// 제목 인풋 46px · 내용 textarea 150px · 비밀글 커스텀 체크 22px("비밀글로 문의 — 작성자와
// 관리자만 볼 수 있어요", 기본 false) · 액션 우측 정렬(취소 / 문의 등록 48px, 상단 border 구분) ·
// 성공 = 토스트 "문의가 등록되었어요"
// [탭 순서] 4 유형 → 5 제목 → 6 내용 → 7 비밀글 → 9 등록 (첨부 제외 — 아래 사유)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - '내 문의 내역' 탭 없음: 문의 내역 화면은 미구현(후속 배선) — 취소·성공 동선은 고객센터(/support)로 보낸다.
//  - 파일 첨부 없음: support.qna.create가 첨부를 받지 않는다(1차 범위 제외 — 백엔드와 일치).
//  - 문의 상품 카드 없음: 목업도 데모 고정 표시(상품 선택 UI 부재) — 상품 상세의 문의 탭 배선 때 도입.
//  - 비회원 필드(이름·휴대폰·비밀번호) 추가: 목업엔 없지만 서버 규약(비회원 3종 필수)이 요구한다.
//    비밀번호는 문의 확인용 — 서버가 해시만 저장한다.
//  - 유형 칩 40px → 44px 상향(터치 타겟 KWCAG), 선택 상태는 Button toggle 변형 + aria-pressed 이중 전달.

import * as React from "react"

import { useMutation } from "@tanstack/react-query"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"
// 타입 전용 임포트 — 컴파일 시 지워져 server-only 경계를 넘지 않는다(store-footer 선례)
import type { CommonCodeOption } from "@/server/services/common-code.service"

type QnaFieldKey =
  | "guestName"
  | "guestPhone"
  | "guestPassword"
  | "title"
  | "content"

/** 오류 시 포커스 이동 순서 = 폼 렌더 순서 */
const QNA_FIELD_ORDER: QnaFieldKey[] = [
  "guestName",
  "guestPhone",
  "guestPassword",
  "title",
  "content",
]

/** 표시용 체크박스 — 목업 [data-check] 실측 22px. cart-view·auth-view와 동일 규격의
 *  세 번째 재선언 — ui 승격 후보이나 두 파일 수정은 배정 밖이라 보류(리뷰에 보고). */
function SecretCheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px]",
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

type QnaFormProps = {
  /** common_code(qna_type) 활성 목록 — 서버 페이지가 조회해 주입한다(코드 하드코딩 금지) */
  qnaTypeOptions: CommonCodeOption[]
  /** null = 비회원(게스트 3종 입력 필수). 값은 세션 프로필 이름 — 안내 문구에 쓴다. */
  memberName: string | null
}

export function QnaForm({ qnaTypeOptions, memberName }: QnaFormProps) {
  const trpc = useTRPC()
  const { showToast } = useToast()

  const qnaCreateMutation = useMutation(trpc.support.qna.create.mutationOptions())

  const isGuest = memberName === null

  const [selectedTypeCode, setSelectedTypeCode] = React.useState(
    qnaTypeOptions[0]?.code ?? ""
  )
  const [guestNameValue, setGuestNameValue] = React.useState("")
  const [guestPhoneValue, setGuestPhoneValue] = React.useState("")
  const [guestPasswordValue, setGuestPasswordValue] = React.useState("")
  const [titleValue, setTitleValue] = React.useState("")
  const [contentValue, setContentValue] = React.useState("")
  const [isSecret, setIsSecret] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<QnaFieldKey, string>>
  >({})
  const [isSubmitted, setIsSubmitted] = React.useState(false)

  /* 성공 패널 전환 시 제목으로 포커스 이동 — 폼이 사라진 자리에서 키보드·스크린리더가
     길을 잃지 않게 한다(auth-view 가입 완료 스텝과 동일 패턴) */
  const submittedHeadingRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (isSubmitted) submittedHeadingRef.current?.focus()
  }, [isSubmitted])

  const handleFieldChange = (fieldKey: QnaFieldKey, fieldValue: string) => {
    const setterByField: Record<QnaFieldKey, (nextValue: string) => void> = {
      guestName: setGuestNameValue,
      guestPhone: setGuestPhoneValue,
      guestPassword: setGuestPasswordValue,
      title: setTitleValue,
      content: setContentValue,
    }
    setterByField[fieldKey](fieldValue)
    // 수정을 시작하면 해당 필드의 지난 오류는 걷어낸다 — 재검증은 제출 시점에(auth-view 선례)
    setFieldErrors((previousErrors) => {
      if (!previousErrors[fieldKey]) return previousErrors
      const nextErrors = { ...previousErrors }
      delete nextErrors[fieldKey]
      return nextErrors
    })
  }

  /** support.qna.create의 zod 규칙과 동일한 클라이언트 사전 검증 — 최종 판정은 항상 서버가 한다 */
  const validateQnaFields = (): Partial<Record<QnaFieldKey, string>> => {
    const validationErrors: Partial<Record<QnaFieldKey, string>> = {}

    if (isGuest) {
      if (guestNameValue.trim().length === 0) {
        validationErrors.guestName = "이름을 입력해 주세요."
      } else if (guestNameValue.trim().length > 50) {
        validationErrors.guestName = "이름은 50자 이하로 입력해 주세요."
      }
      if (!/^01[016789][0-9]{7,8}$/.test(guestPhoneValue.replaceAll("-", ""))) {
        validationErrors.guestPhone =
          "휴대폰 번호 형식이 올바르지 않습니다. '-' 없이 01로 시작하는 번호를 입력해 주세요."
      }
      if (guestPasswordValue.length < 4) {
        validationErrors.guestPassword = "비밀번호는 4자 이상 입력해 주세요."
      } else if (guestPasswordValue.length > 72) {
        validationErrors.guestPassword = "비밀번호는 72자 이하로 입력해 주세요."
      }
    }
    if (titleValue.trim().length === 0) {
      validationErrors.title = "제목을 입력해 주세요."
    } else if (titleValue.trim().length > 200) {
      validationErrors.title = "제목은 200자 이하로 입력해 주세요."
    }
    if (contentValue.trim().length === 0) {
      validationErrors.content = "문의 내용을 입력해 주세요."
    } else if (contentValue.trim().length > 5000) {
      validationErrors.content = "문의 내용은 5,000자 이하로 입력해 주세요."
    }

    return validationErrors
  }

  const handleQnaSubmit = (formSubmitEvent: React.FormEvent<HTMLFormElement>) => {
    formSubmitEvent.preventDefault()
    if (qnaCreateMutation.isPending) return

    const validationErrors = validateQnaFields()
    setFieldErrors(validationErrors)
    const firstErroredField = QNA_FIELD_ORDER.find(
      (fieldKey) => validationErrors[fieldKey]
    )
    if (firstErroredField) {
      document.getElementById(`qna-${firstErroredField}`)?.focus()
      return
    }

    qnaCreateMutation.mutate(
      {
        categoryCode: selectedTypeCode,
        title: titleValue.trim(),
        content: contentValue.trim(),
        isSecret,
        // 회원이면 guest 필드를 아예 보내지 않는다 — 서버도 세션 우선으로 버리지만 표면을 좁힌다
        ...(isGuest
          ? {
              guestName: guestNameValue.trim(),
              guestPhone: guestPhoneValue.replaceAll("-", ""),
              guestPassword: guestPasswordValue,
            }
          : {}),
      },
      {
        onSuccess: () => {
          showToast("문의가 등록되었어요")
          setIsSubmitted(true)
        },
        onError: (qnaCreateError) => {
          // zod 다중 이슈는 message가 JSON 배열 문자열로 온다 — 그대로 노출하지 않는다(auth-view 선례)
          showToast(
            qnaCreateError.message.startsWith("[")
              ? "문의를 등록하지 못했어요. 입력값을 확인하고 다시 시도해 주세요."
              : qnaCreateError.message,
            { toastVariant: "error" }
          )
        },
      }
    )
  }

  /** 성공 패널에서 '새 문의 작성' — 내역 화면이 없어 이어서 쓸 수 있는 동선을 남긴다 */
  const handleWriteAnotherClick = () => {
    setSelectedTypeCode(qnaTypeOptions[0]?.code ?? "")
    setGuestNameValue("")
    setGuestPhoneValue("")
    setGuestPasswordValue("")
    setTitleValue("")
    setContentValue("")
    setIsSecret(false)
    setFieldErrors({})
    setIsSubmitted(false)
  }

  if (isSubmitted) {
    return (
      <section
        aria-label="문의 등록 완료"
        className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-5 py-10 text-center"
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
          ref={submittedHeadingRef}
          tabIndex={-1}
          className="m-0 text-[21px] font-extrabold outline-none"
        >
          문의가 등록되었어요
        </h2>
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          내용을 확인한 뒤 빠르게 답변드릴게요.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="md-48"
            onClick={handleWriteAnotherClick}
          >
            새 문의 작성
          </Button>
          <Button asChild variant="primary" size="md-48">
            <Link href="/support">고객센터로</Link>
          </Button>
        </div>
      </section>
    )
  }

  return (
    <form onSubmit={handleQnaSubmit} noValidate className="flex flex-col gap-[18px]">
      {!isGuest && (
        <p className="m-0 text-[13px] text-muted-foreground">
          {memberName}님의 회원 문의로 등록돼요.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {/* 칩 그룹은 input이 아니라 <label>을 연결할 수 없다 — Label 규격(13px/700 + 필수 별표)을 span으로 재현해 그룹 라벨로 쓴다 */}
        <span
          id="qna-type-label"
          className="flex items-center gap-1 text-[13px] leading-none font-bold"
        >
          문의 유형
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
          <span className="sr-only">(필수)</span>
        </span>
        <div
          role="group"
          aria-labelledby="qna-type-label"
          className="flex flex-wrap gap-2"
        >
          {qnaTypeOptions.map((qnaTypeOption) => (
            <Button
              key={qnaTypeOption.code}
              type="button"
              variant="toggle"
              size="sm-44"
              aria-pressed={selectedTypeCode === qnaTypeOption.code}
              onClick={() => setSelectedTypeCode(qnaTypeOption.code)}
            >
              {qnaTypeOption.name}
            </Button>
          ))}
        </div>
      </div>

      {isGuest && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qna-guestName" required>
              이름
            </Label>
            <Input
              id="qna-guestName"
              size="form"
              type="text"
              autoComplete="name"
              placeholder="이름"
              value={guestNameValue}
              onChange={(changeEvent) =>
                handleFieldChange("guestName", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.guestName ? true : undefined}
              aria-describedby={
                fieldErrors.guestName ? "qna-guestName-error" : undefined
              }
            />
            {fieldErrors.guestName && (
              <p
                id="qna-guestName-error"
                className="m-0 text-xs font-semibold text-destructive"
              >
                {fieldErrors.guestName}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qna-guestPhone" required>
              휴대폰 번호
            </Label>
            <Input
              id="qna-guestPhone"
              size="form"
              type="tel"
              autoComplete="tel"
              placeholder="'-' 없이 숫자만"
              value={guestPhoneValue}
              onChange={(changeEvent) =>
                handleFieldChange("guestPhone", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.guestPhone ? true : undefined}
              aria-describedby={
                fieldErrors.guestPhone ? "qna-guestPhone-error" : undefined
              }
            />
            {fieldErrors.guestPhone && (
              <p
                id="qna-guestPhone-error"
                className="m-0 text-xs font-semibold text-destructive"
              >
                {fieldErrors.guestPhone}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qna-guestPassword" required>
              문의 확인 비밀번호
            </Label>
            <Input
              id="qna-guestPassword"
              size="form"
              type="password"
              autoComplete="new-password"
              placeholder="4자 이상"
              value={guestPasswordValue}
              onChange={(changeEvent) =>
                handleFieldChange("guestPassword", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.guestPassword ? true : undefined}
              aria-describedby={
                fieldErrors.guestPassword
                  ? "qna-guestPassword-error"
                  : "qna-guestPassword-hint"
              }
            />
            {fieldErrors.guestPassword ? (
              <p
                id="qna-guestPassword-error"
                className="m-0 text-xs font-semibold text-destructive"
              >
                {fieldErrors.guestPassword}
              </p>
            ) : (
              <p
                id="qna-guestPassword-hint"
                className="m-0 text-xs text-muted-foreground"
              >
                문의 내역을 확인할 때 필요해요.
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qna-title" required>
          제목
        </Label>
        <Input
          id="qna-title"
          size="form"
          type="text"
          placeholder="문의 제목을 입력해 주세요"
          value={titleValue}
          onChange={(changeEvent) =>
            handleFieldChange("title", changeEvent.target.value)
          }
          aria-invalid={fieldErrors.title ? true : undefined}
          aria-describedby={fieldErrors.title ? "qna-title-error" : undefined}
        />
        {fieldErrors.title && (
          <p id="qna-title-error" className="m-0 text-xs font-semibold text-destructive">
            {fieldErrors.title}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qna-content" required>
          문의 내용
        </Label>
        <Textarea
          id="qna-content"
          size="form"
          placeholder="문의하실 내용을 자세히 적어주시면 정확한 답변에 도움이 돼요."
          value={contentValue}
          onChange={(changeEvent) =>
            handleFieldChange("content", changeEvent.target.value)
          }
          aria-invalid={fieldErrors.content ? true : undefined}
          aria-describedby={fieldErrors.content ? "qna-content-error" : undefined}
        />
        {fieldErrors.content && (
          <p
            id="qna-content-error"
            className="m-0 text-xs font-semibold text-destructive"
          >
            {fieldErrors.content}
          </p>
        )}
      </div>

      <button
        type="button"
        role="checkbox"
        aria-checked={isSecret}
        onClick={() => setIsSecret((previousSecret) => !previousSecret)}
        className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 px-1 text-left"
      >
        <SecretCheckMark checked={isSecret} />
        <span className="text-sm font-semibold text-foreground">
          비밀글로 문의
        </span>
        <span className="text-[13px] text-muted-foreground">
          — 작성자와 관리자만 볼 수 있어요
        </span>
      </button>

      <div className="flex justify-end gap-2 border-t border-border pt-[18px]">
        {/* 목업의 취소는 '내 문의 내역' 탭 이동 — 내역 화면 미구현이라 고객센터로 보낸다 */}
        <Button asChild variant="outline" size="md-48">
          <Link href="/support">취소</Link>
        </Button>
        <Button type="submit" variant="primary" size="md-48">
          {qnaCreateMutation.isPending ? "등록 중…" : "문의 등록"}
        </Button>
      </div>
    </form>
  )
}
