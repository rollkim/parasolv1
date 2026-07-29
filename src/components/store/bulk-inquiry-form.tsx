"use client"

// 핸드오프 규격: PaRaSOL 단체구매문의.dc.html — 구매 유형 카드 · 회사/담당자 · 수량/예산 ·
// 납기일 · 요청사항 · 세금계산서 · 개인정보 동의 · 접수 버튼.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **파일 첨부 없음**: bulk_inquiry에 첨부 컬럼이 없다. 버튼만 두면 눌러도 아무 일이
//    없거나 저장되지 않은 채 접수돼, 담당자가 받았다고 착각한다.
//  - 예산은 구간 선택이지만 저장은 **상한 금액(정수)**이다. 구간 문자열을 저장하면
//    나중에 통계·정렬이 안 된다(금액은 원 단위 정수 — RULE-11).
//  - 개인정보 동의는 체크박스가 아니라 **제출 버튼 위 안내 + 필수 체크**로 남긴다(목업과 동일).

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

/** 예산 구간 — 저장은 상한 금액(원). 구간 문자열을 저장하면 통계·정렬이 안 된다 */
const BUDGET_CHOICES: { label: string; upperBound: number | null }[] = [
  { label: "선택 안 함", upperBound: null },
  { label: "100만원 미만", upperBound: 1_000_000 },
  { label: "100~500만원", upperBound: 5_000_000 },
  { label: "500~1,000만원", upperBound: 10_000_000 },
  { label: "1,000만원 이상", upperBound: 100_000_000 },
]

type FieldKey = "companyName" | "managerName" | "phone" | "quantity" | "privacy"

const FIELD_ORDER: FieldKey[] = ["companyName", "managerName", "phone", "quantity", "privacy"]

export function BulkInquiryForm() {
  const trpc = useTRPC()
  const { showToast } = useToast()

  const typesQuery = useQuery(trpc.bulkInquiry.purchaseTypes.queryOptions())
  const createMutation = useMutation(trpc.bulkInquiry.create.mutationOptions())

  const [purchaseTypeCode, setPurchaseTypeCode] = React.useState("")
  const [companyName, setCompanyName] = React.useState("")
  const [businessNo, setBusinessNo] = React.useState("")
  const [managerName, setManagerName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [wantedProduct, setWantedProduct] = React.useState("")
  const [quantity, setQuantity] = React.useState("")
  const [budgetIndex, setBudgetIndex] = React.useState(0)
  const [dueDate, setDueDate] = React.useState("")
  const [content, setContent] = React.useState("")
  const [needTaxInvoice, setNeedTaxInvoice] = React.useState(false)
  const [privacyAgreed, setPrivacyAgreed] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<FieldKey, string>>>({})
  const [isSubmitted, setIsSubmitted] = React.useState(false)

  const purchaseTypes = typesQuery.data ?? []
  // 첫 유형을 기본 선택 — 고르지 않고 제출하면 서버가 막지만, 안내보다 기본값이 낫다
  const selectedTypeCode = purchaseTypeCode || purchaseTypes[0]?.code || ""

  const submittedHeadingRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (isSubmitted) submittedHeadingRef.current?.focus()
  }, [isSubmitted])

  function validate(): Partial<Record<FieldKey, string>> {
    const errors: Partial<Record<FieldKey, string>> = {}
    if (companyName.trim().length === 0) errors.companyName = "회사/단체명을 입력해 주세요."
    if (managerName.trim().length === 0) errors.managerName = "담당자명을 입력해 주세요."
    if (!/^0[0-9]{8,10}$/.test(phone.replaceAll("-", ""))) {
      errors.phone = "연락처를 숫자만 입력해 주세요."
    }
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (Number.isNaN(parsedQuantity) || parsedQuantity < 1) {
      errors.quantity = "예상 수량을 입력해 주세요."
    }
    if (!privacyAgreed) errors.privacy = "개인정보 수집·이용에 동의해 주세요."
    return errors
  }

  function submitInquiry(event: React.FormEvent) {
    event.preventDefault()
    if (createMutation.isPending) return

    const errors = validate()
    setFieldErrors(errors)
    const firstErrored = FIELD_ORDER.find((fieldKey) => errors[fieldKey])
    if (firstErrored) {
      document.getElementById(`bulk-${firstErrored}`)?.focus()
      return
    }

    createMutation.mutate(
      {
        purchaseTypeCode: selectedTypeCode,
        companyName: companyName.trim(),
        businessNo: businessNo.trim() || undefined,
        managerName: managerName.trim(),
        phone: phone.replaceAll("-", ""),
        email: email.trim() || undefined,
        wantedProduct: wantedProduct.trim() || undefined,
        quantity: Number.parseInt(quantity, 10),
        budget: BUDGET_CHOICES[budgetIndex]?.upperBound ?? undefined,
        dueDate: dueDate || undefined,
        needTaxInvoice,
        content: content.trim() || undefined,
      },
      {
        onSuccess: () => setIsSubmitted(true),
        onError: (createError) =>
          showToast(
            createError.message.startsWith("[")
              ? "문의를 접수하지 못했어요. 입력값을 확인하고 다시 시도해 주세요."
              : createError.message,
            { toastVariant: "error" },
          ),
      },
    )
  }

  if (isSubmitted) {
    return (
      <section
        aria-label="단체구매 문의 접수 완료"
        className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-5 py-12 text-center"
      >
        <div
          aria-hidden="true"
          className="flex size-[70px] items-center justify-center rounded-full bg-secondary text-primary"
        >
          <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}>
            <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 ref={submittedHeadingRef} tabIndex={-1} className="m-0 font-heading text-xl font-extrabold outline-none">
          문의가 접수되었어요
        </h2>
        <p className="m-0 text-sm text-muted-foreground">
          영업일 기준 1일 이내에 담당자가 연락드립니다.
        </p>
        <Button variant="outline" size="md-48" asChild>
          <Link href="/">메인으로</Link>
        </Button>
      </section>
    )
  }

  if (typesQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">문의 양식을 불러오는 중입니다</span>
      </div>
    )
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submitInquiry} noValidate>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-2 text-[13px] font-bold">구매 유형</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {purchaseTypes.map((purchaseType) => (
            <Button
              key={purchaseType.code}
              type="button"
              variant="toggle"
              size="lg-54"
              aria-pressed={selectedTypeCode === purchaseType.code}
              className="h-auto flex-col items-start gap-0.5 py-3 text-left"
              onClick={() => setPurchaseTypeCode(purchaseType.code)}
            >
              <span className="text-sm font-bold">{purchaseType.name}</span>
              {purchaseType.summary ? (
                <span className="text-[12px] font-normal opacity-80">{purchaseType.summary}</span>
              ) : null}
            </Button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          fieldKey="companyName"
          label="회사/단체명"
          required
          error={fieldErrors.companyName}
        >
          <Input
            id="bulk-companyName"
            size="modal"
            placeholder="예: ○○주식회사"
            value={companyName}
            aria-invalid={fieldErrors.companyName ? true : undefined}
            onChange={(event) => setCompanyName(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="managerName" label="담당자명" required error={fieldErrors.managerName}>
          <Input
            id="bulk-managerName"
            size="modal"
            placeholder="담당자 성함"
            value={managerName}
            aria-invalid={fieldErrors.managerName ? true : undefined}
            onChange={(event) => setManagerName(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="phone" label="연락처" required error={fieldErrors.phone}>
          <Input
            id="bulk-phone"
            size="modal"
            type="tel"
            inputMode="numeric"
            placeholder="'-' 없이 숫자만"
            value={phone}
            aria-invalid={fieldErrors.phone ? true : undefined}
            onChange={(event) => setPhone(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="companyName" label="이메일" htmlForOverride="bulk-email">
          <Input
            id="bulk-email"
            size="modal"
            type="email"
            placeholder="견적서 받으실 이메일"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="companyName" label="사업자등록번호" htmlForOverride="bulk-businessNo">
          <Input
            id="bulk-businessNo"
            size="modal"
            placeholder="세금계산서가 필요하면 입력해 주세요"
            value={businessNo}
            onChange={(event) => setBusinessNo(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="companyName" label="희망 상품" htmlForOverride="bulk-wantedProduct">
          <Input
            id="bulk-wantedProduct"
            size="modal"
            placeholder="예: 통밀 오트 쿠키 선물세트"
            value={wantedProduct}
            onChange={(event) => setWantedProduct(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="quantity" label="예상 수량" required error={fieldErrors.quantity}>
          <Input
            id="bulk-quantity"
            size="modal"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="예: 100"
            value={quantity}
            aria-invalid={fieldErrors.quantity ? true : undefined}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="companyName" label="희망 납기일" htmlForOverride="bulk-dueDate">
          <Input
            id="bulk-dueDate"
            size="modal"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </FormField>

        <FormField fieldKey="companyName" label="예산 범위" htmlForOverride="bulk-budget">
          <select
            id="bulk-budget"
            className="h-[46px] w-full rounded-[calc(var(--radius)-4px)] border border-input bg-card px-3 text-sm"
            value={budgetIndex}
            onChange={(event) => setBudgetIndex(Number(event.target.value))}
          >
            {BUDGET_CHOICES.map((choice, choiceIndex) => (
              <option key={choice.label} value={choiceIndex}>
                {choice.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bulk-content">상세 요청사항</Label>
        <Textarea
          id="bulk-content"
          placeholder="구성, 포장 방식(개별 포장·리본 등), 로고 인쇄, 분할 배송지 등 필요한 내용을 자유롭게 적어주세요."
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </div>

      <button
        type="button"
        role="checkbox"
        aria-checked={needTaxInvoice}
        onClick={() => setNeedTaxInvoice((previous) => !previous)}
        className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-left"
      >
        <CheckMark checked={needTaxInvoice} />
        <span className="text-sm">세금계산서 발행 필요</span>
      </button>

      <div className="border-t border-border pt-[18px]">
        <button
          id="bulk-privacy"
          type="button"
          role="checkbox"
          aria-checked={privacyAgreed}
          aria-invalid={fieldErrors.privacy ? true : undefined}
          onClick={() => {
            setPrivacyAgreed((previous) => !previous)
            setFieldErrors((previous) => ({ ...previous, privacy: undefined }))
          }}
          className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-left"
        >
          <CheckMark checked={privacyAgreed} />
          <span className="text-sm">
            <span className="font-bold text-primary">[필수]</span> 개인정보 수집·이용 동의
          </span>
        </button>
        <Link href="/terms/privacy" className="ml-1 text-[12px] text-muted-foreground underline">
          내용 보기
        </Link>
        {fieldErrors.privacy ? (
          <p role="alert" className="m-0 mt-1.5 text-[12px] text-destructive">
            {fieldErrors.privacy}
          </p>
        ) : null}
      </div>

      <Button type="submit" variant="primary" size="xl-56" disabled={createMutation.isPending}>
        {createMutation.isPending ? "접수 중…" : "견적 문의 접수하기"}
      </Button>
      <p className="m-0 text-center text-[12px] text-muted-foreground">
        접수 후 영업일 기준 1일 이내에 담당자가 연락드립니다.
      </p>
    </form>
  )
}

function FormField({
  fieldKey,
  label,
  required,
  error,
  htmlForOverride,
  children,
}: {
  fieldKey: FieldKey
  label: string
  required?: boolean
  error?: string
  htmlForOverride?: string
  children: React.ReactNode
}) {
  const inputId = htmlForOverride ?? `bulk-${fieldKey}`
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="m-0 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** 표시용 체크 — 실제 상태는 부모 button의 aria-checked가 전달한다 */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-[6px] border-[1.5px]",
        checked ? "border-primary bg-primary" : "border-border bg-card",
      )}
    >
      {checked && (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="text-primary-foreground">
          <path d="m5 12.5 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}
