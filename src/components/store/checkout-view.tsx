"use client"

// 핸드오프 규격: 체크아웃.dc.html — 좌(주문방식·주문자·배송지·주문상품·약관) + 우(sticky 주문요약),
// 모바일은 하단 고정 결제 바. [탭 순서](체크아웃 L110): 주문방식 → 주문자 → 배송지 → 배송메모 → 약관 → 결제하기
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 결제수단 UI는 **서버가 알려주는 모드**에 따라 갈린다(tossPaymentUiMode):
//    · window(1차) — 결제위젯 이용 신청이 운영 사이트 심사를 요구해 아직 못 받았다.
//      우리가 수단 선택 UI를 그리고 requestPayment({ method })로 결제창을 띄운다.
//    · widget(위젯 키 수령 후) — SDK가 수단·약관 UI를 직접 렌더한다. 우리 버튼은 숨긴다.
//    두 방식은 서버 승인·취소 경로가 완전히 같아서 env 한 줄로 전환된다.
//  - 약관 5종 하드코딩 대신 terms_document에서 받아 렌더: 문구·필수여부는 DB가 진실원(RULE-11 리스킨 전제).
//    동의 대상 선별(필수 전부 + 마케팅)은 서버(checkout-view.service)가 정한다 — 화면이 정하면
//    서버 검증(createOrder)과 어긋나 주문이 막힌다.
//  - 결제 CTA를 disabled로 두지 않고 aria-disabled + 클릭 시 첫 미충족 필드로 포커스 이동: 목업은
//    disabled 버튼에 사유 토스트를 달아 뒀는데 disabled는 클릭·포커스가 안 되어 절대 발화하지 않는 죽은 경로였다.
//  - 필드별 인라인 오류 추가(목업은 토스트 1종): README UX 6 '원인+해결 함께'와 KWCAG 오류 식별 요건.
//    blur 이후에만 표시하고 고쳐지면 즉시 해제한다.
//  - 체크박스·라디오를 ui/checkbox·ui/radio-group(Radix)으로: 목업은 button+span이라 role·aria-checked·
//    화살표 키 이동이 없고 히트 영역이 22px(44px 미달)이었다.
//  - 반응형은 컨테이너 쿼리 대신 뷰포트 기준(md/lg) — 장바구니 화면 선례와 통일.
//  - 배송지 라디오는 저장 배송지 N건을 모두 렌더(목업은 1건 하드코딩). 0건이면 신규 입력만 노출.

import * as React from "react"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { useMutation, useQuery } from "@tanstack/react-query"

import { isRemoteAreaZipcode } from "@/domain/cart"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ImagePlaceholder } from "@/components/store/image-placeholder"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { openDaumPostcode } from "@/lib/daum-postcode"
import { formatKrw } from "@/lib/format"
import { launchTossPayment, type TossPaymentMethod } from "@/lib/toss-payment"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

const NEW_ADDRESS_VALUE = "new"

/**
 * 결제창 모드에서 우리가 그리는 수단 목록.
 * 간편결제(토스페이·카카오페이)는 계약된 MID 키가 있어야 테스트되므로(문서 §6) 1차에서 뺀다 —
 * 누를 수는 있는데 테스트가 안 되면 "되는지 모르는 버튼"이 남는다.
 */
const WINDOW_PAYMENT_METHODS: { method: TossPaymentMethod; label: string }[] = [
  { method: "CARD", label: "신용·체크카드" },
  { method: "TRANSFER", label: "계좌이체" },
  { method: "VIRTUAL_ACCOUNT", label: "가상계좌" },
]

/** 토스 실패 코드 → 사용자 문구. 모르는 코드는 일반 안내로 흡수한다 */
const PAY_ERROR_MESSAGES: Record<string, string> = {
  PAY_PROCESS_CANCELED: "결제를 취소하셨어요. 다시 시도하실 수 있습니다.",
  PAY_PROCESS_ABORTED: "결제가 중단됐어요. 결제 수단을 확인하고 다시 시도해 주세요.",
  REJECT_CARD_COMPANY: "카드사에서 결제를 거절했어요. 다른 카드로 시도해 주세요.",
  INVALID_CALLBACK: "결제 정보가 올바르지 않아요. 처음부터 다시 시도해 주세요.",
  CONFIRM_FAILED:
    "결제 확인 중 문제가 발생했어요. 중복 결제를 막기 위해 주문 내역에서 상태를 먼저 확인해 주세요.",
}

/** 배송 메모 — 코드는 영문(RULE-11), 표시는 한글. 저장은 표시 문장(주문 스냅샷) */
const DELIVERY_MEMO_OPTIONS = [
  { code: "door", label: "문 앞에 두고 벨 눌러주세요" },
  { code: "call", label: "배송 전 연락 주세요" },
  { code: "guard", label: "경비실에 맡겨주세요" },
  { code: "direct", label: "직접 받고 부재 시 문 앞" },
] as const

type OrdererFields = { name: string; phone: string; email: string }
type AddressFields = {
  recipient: string
  phone: string
  zipcode: string
  addr1: string
  addr2: string
}

type FieldKey =
  | "ordererName"
  | "ordererPhone"
  | "ordererEmail"
  | "recipient"
  | "addressPhone"
  | "zipcode"
  | "addr1"

const PHONE_PATTERN = /^01[016789][0-9]{7,8}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "")
}

/**
 * 필드 검증 — 메시지는 '무엇이 잘못됐고 어떻게 고치는지'를 함께 담는다(README UX 6).
 * 이름·연락처는 회원·비회원 모두 필수다. 비회원 주문조회의 인증 키가 연락처이기 때문에
 * 비어 있으면 주문 후 조회 자체가 불가능해진다(목업은 이 검증이 빠져 있었다).
 */
function validateFields(
  orderer: OrdererFields,
  addressInput: AddressFields,
  needsAddressInput: boolean,
): Partial<Record<FieldKey, string>> {
  const fieldErrors: Partial<Record<FieldKey, string>> = {}

  if (!orderer.name.trim()) fieldErrors.ordererName = "주문자 이름을 입력해 주세요."
  if (!orderer.phone.trim()) {
    fieldErrors.ordererPhone = "주문 조회에 사용할 연락처를 입력해 주세요."
  } else if (!PHONE_PATTERN.test(digitsOnly(orderer.phone))) {
    fieldErrors.ordererPhone = "연락처 형식이 올바르지 않습니다. 예: 010-1234-5678"
  }
  if (orderer.email.trim() && !EMAIL_PATTERN.test(orderer.email.trim())) {
    fieldErrors.ordererEmail = "이메일 형식이 올바르지 않습니다. 다시 확인해 주세요."
  }

  if (needsAddressInput) {
    if (!addressInput.recipient.trim()) fieldErrors.recipient = "받는 분 이름을 입력해 주세요."
    if (!addressInput.phone.trim()) {
      fieldErrors.addressPhone = "받는 분 연락처를 입력해 주세요."
    } else if (!PHONE_PATTERN.test(digitsOnly(addressInput.phone))) {
      fieldErrors.addressPhone = "연락처 형식이 올바르지 않습니다. 예: 010-1234-5678"
    }
    if (!/^[0-9]{5}$/.test(addressInput.zipcode.trim())) {
      fieldErrors.zipcode = "우편번호 5자리를 입력해 주세요. 주소 검색을 이용하면 자동으로 채워집니다."
    }
    if (!addressInput.addr1.trim()) fieldErrors.addr1 = "주소를 입력해 주세요."
  }

  return fieldErrors
}

/** 오류 메시지 — 인풋과 aria-describedby로 연결되고, 색이 아니라 텍스트로도 전달된다 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-destructive">
      {message}
    </p>
  )
}

export function CheckoutView() {
  const trpc = useTRPC()
  const { showToast } = useToast()

  /* 바로구매 — ?buy=<token>이면 장바구니가 아니라 그 임시 카트로 주문서를 그린다.
     서버가 접두사(bn_)를 검사하므로 남의 장바구니 토큰을 넣어도 통하지 않는다 */
  const searchParams = useSearchParams()
  const buyToken = searchParams.get("buy") ?? undefined

  const checkoutQuery = useQuery(trpc.order.getCheckoutView.queryOptions({ buyToken }))
  const createOrderMutation = useMutation(trpc.order.createOrder.mutationOptions())

  const [orderMode, setOrderMode] = React.useState<"member" | "guest">("member")
  const [orderer, setOrderer] = React.useState<OrdererFields>({ name: "", phone: "", email: "" })
  const [selectedAddressValue, setSelectedAddressValue] = React.useState<string>(NEW_ADDRESS_VALUE)
  const [addressInput, setAddressInput] = React.useState<AddressFields>({
    recipient: "",
    phone: "",
    zipcode: "",
    addr1: "",
    addr2: "",
  })
  const [deliveryMemo, setDeliveryMemo] = React.useState("")
  const [agreedTermsIds, setAgreedTermsIds] = React.useState<number[]>([])
  const [touchedFields, setTouchedFields] = React.useState<Partial<Record<FieldKey, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = React.useState(false)
  const [createdOrder, setCreatedOrder] = React.useState<{
    orderNo: string
    grandTotal: number
  } | null>(null)
  const [paymentMethod, setPaymentMethod] = React.useState<TossPaymentMethod>("CARD")
  const [launchingPayment, setLaunchingPayment] = React.useState(false)
  const [sameAsOrderer, setSameAsOrderer] = React.useState(false)
  const postcodeLayerRef = React.useRef<HTMLDivElement>(null)
  const addressDetailRef = React.useRef<HTMLInputElement>(null)

  // 결제 실패로 되돌아온 경우 — 토스가 준 코드를 사용자 문구로 옮긴다
  const payErrorCode = searchParams.get("payError")
  const payErrorMessage = payErrorCode
    ? (PAY_ERROR_MESSAGES[payErrorCode] ??
      "결제를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.")
    : null

  const fieldRefs = React.useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({})
  const checkoutView = checkoutQuery.data
  const [prefillAppliedFor, setPrefillAppliedFor] = React.useState<"member" | "guest" | null>(null)

  // 회원 프로필로 주문자 정보를 채운다 — 데이터가 도착한 최초 1회만.
  // effect가 아니라 렌더 중 조정이다: effect로 하면 이미 그린 화면을 다시 그려 값이 한 번 깜빡인다.
  const prefillTarget = checkoutView ? (checkoutView.isMember ? "member" : "guest") : null
  if (checkoutView && prefillTarget !== null && prefillTarget !== prefillAppliedFor) {
    setPrefillAppliedFor(prefillTarget)
    setOrderMode(prefillTarget)
    if (checkoutView.isMember) {
      setOrderer(checkoutView.ordererPrefill)
      const defaultAddress =
        checkoutView.addresses.find((candidate) => candidate.isDefault) ?? checkoutView.addresses[0]
      if (defaultAddress) setSelectedAddressValue(String(defaultAddress.addressId))
    }
  }

  const savedAddresses = checkoutView?.addresses ?? []
  const isGuestMode = orderMode === "guest"
  const needsAddressInput = isGuestMode || selectedAddressValue === NEW_ADDRESS_VALUE
  const selectedSavedAddress = savedAddresses.find(
    (candidate) => String(candidate.addressId) === selectedAddressValue,
  )

  const fieldErrors = validateFields(orderer, addressInput, needsAddressInput)
  const requiredTermsIds = (checkoutView?.terms ?? [])
    .filter((termsDoc) => termsDoc.isRequired)
    .map((termsDoc) => termsDoc.termsDocumentId)
  const missingTermsIds = requiredTermsIds.filter((id) => !agreedTermsIds.includes(id))

  const orderableLines = (checkoutView?.cart.lines ?? []).filter(
    (line) => !line.unavailable && !line.soldOut,
  )
  const cartSummary = checkoutView?.cart.summary

  /** 오류는 blur 이후 또는 결제 시도 이후에만 보여준다 — 입력 중 빨간 글씨는 방해가 된다 */
  function visibleError(field: FieldKey): string | undefined {
    if (!submitAttempted && !touchedFields[field]) return undefined
    return fieldErrors[field]
  }

  function markTouched(field: FieldKey) {
    setTouchedFields((previous) => ({ ...previous, [field]: true }))
  }

  /**
   * '주문자 정보와 동일' — 켜면 받는 분·연락처를 주문자 값으로 채우고, 이후 주문자 변경도 따라간다.
   * 끄면 마지막 값을 그대로 두고 편집만 열어 준다(지운 뒤 다시 입력하게 하지 않는다).
   */
  function applySameAsOrderer(checked: boolean) {
    setSameAsOrderer(checked)
    if (!checked) return
    setAddressInput((previous) => ({
      ...previous,
      recipient: orderer.name,
      phone: orderer.phone,
    }))
  }

  /** 주문자 변경 — '동일' 상태면 배송지도 같이 움직인다 */
  function updateOrderer(patch: Partial<OrdererFields>) {
    const nextOrderer = { ...orderer, ...patch }
    setOrderer(nextOrderer)
    if (sameAsOrderer) {
      setAddressInput((previous) => ({
        ...previous,
        recipient: nextOrderer.name,
        phone: nextOrderer.phone,
      }))
    }
  }

  /** 다음 우편번호 레이어 — 선택하면 우편번호·기본주소가 채워지고 상세주소로 포커스를 옮긴다 */
  async function openPostcodeSearch() {
    const container = postcodeLayerRef.current
    if (!container) return
    try {
      await openDaumPostcode({
        container,
        onSelect: (fields) => {
          setAddressInput((previous) => ({
            ...previous,
            zipcode: fields.zipcode,
            addr1: fields.addr1,
          }))
          markTouched("zipcode")
          markTouched("addr1")
          // 주소를 고르면 남은 건 동·호수뿐이다 — 거기로 바로 보낸다
          window.setTimeout(() => addressDetailRef.current?.focus(), 0)
        },
      })
    } catch (postcodeError) {
      showToast(
        postcodeError instanceof Error
          ? postcodeError.message
          : "주소 검색을 불러오지 못했습니다.",
        { toastVariant: "error" },
      )
    }
  }

  function toggleTerms(termsDocumentId: number, checked: boolean) {
    setAgreedTermsIds((previous) =>
      checked
        ? [...new Set([...previous, termsDocumentId])]
        : previous.filter((id) => id !== termsDocumentId),
    )
  }

  const allTermsIds = (checkoutView?.terms ?? []).map((termsDoc) => termsDoc.termsDocumentId)
  const allTermsAgreed = allTermsIds.length > 0 && allTermsIds.every((id) => agreedTermsIds.includes(id))

  function switchOrderMode(nextMode: "member" | "guest") {
    setOrderMode(nextMode)
    if (nextMode === "guest") {
      // 비회원 전환 시 회원 프리필을 비운다 — 남의 이름으로 주문되는 혼동을 막는다(목업 동작)
      setOrderer((previous) => ({ ...previous, name: "", phone: "" }))
      setSelectedAddressValue(NEW_ADDRESS_VALUE)
    }
  }

  const blockingReason = (() => {
    if (orderableLines.length === 0) return "주문 가능한 상품이 없습니다."
    if (Object.keys(fieldErrors).length > 0) return "입력하지 않은 정보가 있습니다."
    if (missingTermsIds.length > 0) return "필수 약관에 동의해 주세요."
    return null
  })()

  const FIELD_FOCUS_ORDER: FieldKey[] = [
    "ordererName",
    "ordererPhone",
    "ordererEmail",
    "recipient",
    "addressPhone",
    "zipcode",
    "addr1",
  ]

  /**
   * 주문이 만들어진 뒤 결제창(또는 위젯)을 띄운다.
   * 성공하면 토스가 successUrl로 리다이렉트하므로 이 함수는 보통 돌아오지 않는다 —
   * 돌아왔다면 사용자가 창을 닫았거나 SDK 로드에 실패한 것이다.
   */
  async function startPayment(orderNo: string, grandTotal: number) {
    if (!checkoutView?.tossClientKey) return
    setLaunchingPayment(true)
    try {
      await launchTossPayment({
        uiMode: checkoutView.tossPaymentUiMode,
        clientKey: checkoutView.tossClientKey,
        customerKey: checkoutView.tossCustomerKey,
        orderNo,
        orderName: checkoutView.orderName,
        // 서버가 확정한 금액이다 — 화면 계산값을 쓰지 않는다
        amount: grandTotal,
        method: paymentMethod,
        successUrl: `${window.location.origin}/api/payments/toss/success`,
        failUrl: `${window.location.origin}/api/payments/toss/fail`,
        customerEmail: orderer.email || undefined,
        customerName: orderer.name || undefined,
        widgetSelectors: {
          paymentMethods: "#toss-payment-methods",
          agreement: "#toss-payment-agreement",
        },
      })
    } catch (launchError) {
      // 결제창을 닫은 것도 여기로 온다 — 주문은 pending으로 남아 재시도할 수 있다
      showToast(
        launchError instanceof Error
          ? launchError.message
          : "결제를 시작하지 못했어요. 다시 시도해 주세요.",
        { toastVariant: "error" },
      )
    } finally {
      setLaunchingPayment(false)
    }
  }

  function handleSubmit() {
    // aria-disabled는 클릭을 막지 않는다(막으면 사유를 알릴 수 없어 일부러 활성으로 뒀다).
    // 진행 중·생성 완료 상태에서 다시 눌리면 주문이 중복 생성되므로 여기서 끊는다.
    if (createOrderMutation.isPending || launchingPayment) return
    // 주문은 만들어졌는데 결제를 못 끝낸 경우 — 새 주문을 만들지 않고 결제만 다시 띄운다
    if (createdOrder) {
      void startPayment(createdOrder.orderNo, createdOrder.grandTotal)
      return
    }
    setSubmitAttempted(true)

    const firstInvalid = FIELD_FOCUS_ORDER.find((field) => fieldErrors[field])
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus()
      showToast(fieldErrors[firstInvalid] ?? "입력값을 확인해 주세요.", { toastVariant: "error" })
      return
    }
    if (blockingReason) {
      showToast(blockingReason, { toastVariant: "error" })
      return
    }

    const shippingAddress = needsAddressInput
      ? {
          recipient: addressInput.recipient,
          phone: addressInput.phone,
          zipcode: addressInput.zipcode,
          addr1: addressInput.addr1,
          addr2: addressInput.addr2 || undefined,
          deliveryMemo: deliveryMemo || undefined,
        }
      : {
          // 저장 배송지는 화면이 이미 받은 본인 데이터라 값을 그대로 보낸다.
          // addressId를 보내고 서버가 되읽는 방식은 남의 id로 주소를 캐낼 여지를 만든다.
          recipient: selectedSavedAddress?.recipient ?? "",
          phone: selectedSavedAddress?.phone ?? "",
          zipcode: selectedSavedAddress?.zipcode ?? "",
          addr1: selectedSavedAddress?.addr1 ?? "",
          addr2: selectedSavedAddress?.addr2 ?? undefined,
          deliveryMemo: deliveryMemo || undefined,
        }

    createOrderMutation.mutate(
      {
        orderer: {
          name: orderer.name,
          phone: orderer.phone,
          email: orderer.email || undefined,
        },
        shippingAddress,
        cartItemIds: orderableLines.map((line) => line.cartItemId),
        agreedTermsDocumentIds: agreedTermsIds,
        // 주문 생성도 같은 토큰을 봐야 한다 — 여기서 빠지면 주문서는 바로구매 상품을 그렸는데
        // 실제 주문은 장바구니로 만들어진다
        buyToken,
      },
      {
        onSuccess: (created) => {
          setCreatedOrder({ orderNo: created.orderNo, grandTotal: created.grandTotal })
          if (!checkoutView?.tossClientKey) {
            // 키 미설정(스텁 구간) — 주문서가 만들어진 것까지 확인할 수 있게 완료 화면으로.
            // 완료 화면이 결제 전 주문을 '주문서가 만들어졌어요'로 구분해 표시한다.
            window.location.assign(
              `/order/complete?orderNo=${encodeURIComponent(created.orderNo)}`,
            )
            return
          }
          void startPayment(created.orderNo, created.grandTotal)
        },
        onError: (createError) => showToast(createError.message, { toastVariant: "error" }),
      },
    )
  }

  if (checkoutQuery.isPending) {
    return (
      <div className="flex min-h-60 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">주문서를 불러오는 중입니다</span>
      </div>
    )
  }

  if (checkoutQuery.isError || !checkoutView) {
    return (
      <p role="alert" className="py-16 text-center text-sm text-muted-foreground">
        주문서를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  // 도서·산간 추가비는 주소가 정해져야 나온다. **서버 주문 생성과 같은 도메인 함수**를 써서
  // 화면에 보인 금액과 실제 결제액이 갈리지 않게 한다.
  const selectedZipcode = needsAddressInput
    ? addressInput.zipcode
    : (selectedSavedAddress?.zipcode ?? "")
  const remoteSurcharge =
    cartSummary && isRemoteAreaZipcode(selectedZipcode)
      ? (checkoutView?.shippingPolicy.remoteSurcharge ?? 0)
      : 0

  const summaryRows = cartSummary
    ? [
        { label: "총 상품금액", value: formatKrw(cartSummary.listTotal) },
        ...(cartSummary.productDiscount > 0
          ? [
              {
                label: "상품 할인",
                value: `-${formatKrw(cartSummary.productDiscount)}`,
                emphasis: true,
              },
            ]
          : []),
        ...(cartSummary.addonTotal > 0
          ? [{ label: "추가상품", value: `+${formatKrw(cartSummary.addonTotal)}` }]
          : []),
        {
          label: "배송비",
          value: cartSummary.shippingFee === 0 ? "무료" : formatKrw(cartSummary.shippingFee),
        },
        ...(remoteSurcharge > 0
          ? [{ label: "도서·산간 추가", value: `+${formatKrw(remoteSurcharge)}` }]
          : []),
      ]
    : []

  const payableTotal = cartSummary ? cartSummary.grandTotal + remoteSurcharge : 0
  const payLabel = cartSummary ? `${formatKrw(payableTotal)} 결제하기` : "결제하기"
  const isSubmitting = createOrderMutation.isPending || launchingPayment

  const orderSummaryCard = (
    <div className="rounded-[var(--radius)] border border-border bg-card p-5">
      <h2 className="m-0 font-heading text-[17px] font-extrabold">주문 요약</h2>
      <dl className="mt-3.5 flex flex-col gap-2.5 text-[13px]">
        {summaryRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              className={cn("m-0 font-bold", row.emphasis && "text-destructive")}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3.5 flex items-center justify-between border-t border-border pt-3.5">
        <span className="text-sm font-bold">결제금액</span>
        <strong className="font-heading text-lg font-extrabold">
          {cartSummary ? formatKrw(payableTotal) : "-"}
        </strong>
      </div>

      {/* 결제 실패로 되돌아온 경우 — 맥락을 잃지 않게 이 자리에서 사유를 알리고 재시도시킨다 */}
      {payErrorMessage ? (
        <p
          role="alert"
          className="m-0 mt-3 rounded-[calc(var(--radius)-2px)] border border-destructive/40 bg-destructive/5 px-3.5 py-3 text-[13px] text-destructive"
        >
          {payErrorMessage}
        </p>
      ) : null}

      {blockingReason ? (
        <p aria-live="polite" className="mt-2.5 text-xs text-muted-foreground">
          {blockingReason}
        </p>
      ) : null}

      <Button
        type="button"
        variant="primary"
        size="lg-52"
        className="mt-3 w-full"
        aria-disabled={blockingReason !== null || isSubmitting}
        onClick={handleSubmit}
      >
        {createOrderMutation.isPending
          ? "주문 생성 중…"
          : launchingPayment
            ? "결제창 여는 중…"
            : createdOrder
              ? "결제 다시 시도"
              : payLabel}
      </Button>
    </div>
  )

  return (
    <div className="mt-5 grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_376px]">
      <div className="flex flex-col gap-6">
        {/* ① 주문 방식 */}
        <section aria-labelledby="checkout-mode-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="checkout-mode-heading" className="m-0 font-heading text-lg font-extrabold">
              주문 방식
            </h2>
            <div role="group" aria-label="주문 방식 선택" className="flex gap-1.5">
              {/* 비로그인 상태에서 '회원 주문'을 disabled로 두면 toggle 변형의 품절 표기(dashed·취소선)가
                  적용돼 '선택 불가'로 읽힌다. 실제로는 로그인하면 되는 것이므로 로그인으로 보낸다. */}
              {checkoutView.isMember ? (
                <Button
                  type="button"
                  variant="toggle"
                  size="sm-44"
                  aria-pressed={orderMode === "member"}
                  onClick={() => switchOrderMode("member")}
                >
                  회원 주문
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm-44" asChild>
                  <Link href="/login?next=/checkout">로그인하고 주문</Link>
                </Button>
              )}
              <Button
                type="button"
                variant="toggle"
                size="sm-44"
                aria-pressed={orderMode === "guest"}
                onClick={() => switchOrderMode("guest")}
              >
                비회원 주문
              </Button>
            </div>
          </div>

          {isGuestMode ? (
            <p className="mt-3 rounded-[calc(var(--radius)-2px)] border border-border bg-accent/10 px-3.5 py-3 text-[13px] leading-relaxed text-muted-foreground">
              비회원으로도 바로 주문할 수 있어요. 주문 조회에 사용할 연락처를 정확히 입력해 주세요.
            </p>
          ) : null}
        </section>

        {/* ② 주문자 정보 */}
        <section aria-labelledby="checkout-orderer-heading" className="border-t border-border pt-5">
          <h2 id="checkout-orderer-heading" className="m-0 mb-3 font-heading text-lg font-extrabold">
            주문자 정보
          </h2>
          <div className="flex flex-col gap-2.5">
            <div>
              <Input
                ref={(node) => {
                  fieldRefs.current.ordererName = node
                }}
                aria-label="주문자 이름"
                placeholder="이름"
                value={orderer.name}
                aria-invalid={visibleError("ordererName") ? true : undefined}
                aria-describedby={visibleError("ordererName") ? "err-ordererName" : undefined}
                onBlur={() => markTouched("ordererName")}
                onChange={(event) =>
                  updateOrderer({ name: event.target.value })
                }
              />
              <FieldError id="err-ordererName" message={visibleError("ordererName")} />
            </div>
            <div>
              <Input
                ref={(node) => {
                  fieldRefs.current.ordererPhone = node
                }}
                aria-label="주문자 연락처"
                inputMode="numeric"
                placeholder="연락처 (예: 010-1234-5678)"
                value={orderer.phone}
                aria-invalid={visibleError("ordererPhone") ? true : undefined}
                aria-describedby={visibleError("ordererPhone") ? "err-ordererPhone" : undefined}
                onBlur={() => markTouched("ordererPhone")}
                onChange={(event) =>
                  updateOrderer({ phone: event.target.value })
                }
              />
              <FieldError id="err-ordererPhone" message={visibleError("ordererPhone")} />
            </div>
            <div>
              <Input
                ref={(node) => {
                  fieldRefs.current.ordererEmail = node
                }}
                aria-label="이메일"
                type="email"
                placeholder="이메일 (주문내역 발송)"
                value={orderer.email}
                aria-invalid={visibleError("ordererEmail") ? true : undefined}
                aria-describedby={visibleError("ordererEmail") ? "err-ordererEmail" : undefined}
                onBlur={() => markTouched("ordererEmail")}
                onChange={(event) =>
                  updateOrderer({ email: event.target.value })
                }
              />
              <FieldError id="err-ordererEmail" message={visibleError("ordererEmail")} />
            </div>
          </div>
        </section>

        {/* ③ 배송지 */}
        <section aria-labelledby="checkout-address-heading" className="border-t border-border pt-5">
          <h2 id="checkout-address-heading" className="m-0 mb-3 font-heading text-lg font-extrabold">
            배송지
          </h2>

          {!isGuestMode && savedAddresses.length > 0 ? (
            <RadioGroup
              aria-label="배송지 선택"
              value={selectedAddressValue}
              onValueChange={setSelectedAddressValue}
              className="mb-3.5"
            >
              {savedAddresses.map((savedAddress) => (
                <RadioGroupCard
                  key={savedAddress.addressId}
                  value={String(savedAddress.addressId)}
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="text-sm">{savedAddress.recipient}</b>
                    {savedAddress.isDefault ? (
                      <span className="rounded-[5px] border border-primary px-1.5 py-px text-[11px] font-bold text-primary">
                        기본 배송지
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
                    {savedAddress.phone}
                    <br />({savedAddress.zipcode}) {savedAddress.addr1}
                    {savedAddress.addr2 ? `, ${savedAddress.addr2}` : ""}
                  </span>
                </RadioGroupCard>
              ))}
              <RadioGroupCard value={NEW_ADDRESS_VALUE} className="items-center">
                <b className="text-sm">새로운 배송지로 받기</b>
              </RadioGroupCard>
            </RadioGroup>
          ) : null}

          {needsAddressInput ? (
            <div className="flex flex-col gap-2.5">
              {/* 대부분 주문자가 받는 사람이다 — 두 번 입력하지 않게 한다 */}
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <Checkbox
                  checked={sameAsOrderer}
                  aria-label="주문자 정보와 동일"
                  onCheckedChange={(checked) => applySameAsOrderer(checked === true)}
                />
                <span className="text-[13px] font-semibold">주문자 정보와 동일</span>
              </label>

              <div>
                <Input
                  ref={(node) => {
                    fieldRefs.current.recipient = node
                  }}
                  aria-label="받는 분"
                  placeholder="받는 분"
                  readOnly={sameAsOrderer}
                  className={sameAsOrderer ? "bg-muted" : undefined}
                  value={addressInput.recipient}
                  aria-invalid={visibleError("recipient") ? true : undefined}
                  aria-describedby={visibleError("recipient") ? "err-recipient" : undefined}
                  onBlur={() => markTouched("recipient")}
                  onChange={(event) =>
                    setAddressInput((previous) => ({ ...previous, recipient: event.target.value }))
                  }
                />
                <FieldError id="err-recipient" message={visibleError("recipient")} />
              </div>
              <div>
                <Input
                  ref={(node) => {
                    fieldRefs.current.addressPhone = node
                  }}
                  aria-label="받는 분 연락처"
                  inputMode="numeric"
                  placeholder="받는 분 연락처"
                  readOnly={sameAsOrderer}
                  className={sameAsOrderer ? "bg-muted" : undefined}
                  value={addressInput.phone}
                  aria-invalid={visibleError("addressPhone") ? true : undefined}
                  aria-describedby={visibleError("addressPhone") ? "err-addressPhone" : undefined}
                  onBlur={() => markTouched("addressPhone")}
                  onChange={(event) =>
                    setAddressInput((previous) => ({ ...previous, phone: event.target.value }))
                  }
                />
                <FieldError id="err-addressPhone" message={visibleError("addressPhone")} />
              </div>
              <div>
                <div className="flex gap-2">
                  <Input
                    ref={(node) => {
                      fieldRefs.current.zipcode = node
                    }}
                    aria-label="우편번호"
                    inputMode="numeric"
                    placeholder="우편번호"
                    className="max-w-[140px]"
                    value={addressInput.zipcode}
                    aria-invalid={visibleError("zipcode") ? true : undefined}
                    aria-describedby={visibleError("zipcode") ? "err-zipcode" : undefined}
                    onBlur={() => markTouched("zipcode")}
                    onChange={(event) =>
                      setAddressInput((previous) => ({ ...previous, zipcode: event.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="neutral-solid"
                    size="sm-46"
                    onClick={() => void openPostcodeSearch()}
                  >
                    주소 찾기
                  </Button>
                </div>
                {/* 다음 우편번호 검색 레이어 — 새 창이 아니라 여기 안에 뜬다(팝업 차단·탭 이탈 방지).
                    선택하면 스스로 비워지므로 평소엔 높이 0이다 */}
                <div
                  ref={postcodeLayerRef}
                  className="mt-2 empty:hidden h-[420px] overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border"
                />
                <FieldError id="err-zipcode" message={visibleError("zipcode")} />
              </div>
              <div>
                <Input
                  ref={(node) => {
                    fieldRefs.current.addr1 = node
                  }}
                  aria-label="기본 주소"
                  placeholder="기본 주소"
                  value={addressInput.addr1}
                  aria-invalid={visibleError("addr1") ? true : undefined}
                  aria-describedby={visibleError("addr1") ? "err-addr1" : undefined}
                  onBlur={() => markTouched("addr1")}
                  onChange={(event) =>
                    setAddressInput((previous) => ({ ...previous, addr1: event.target.value }))
                  }
                />
                <FieldError id="err-addr1" message={visibleError("addr1")} />
              </div>
              <Input
                ref={addressDetailRef}
                aria-label="상세 주소"
                placeholder="상세 주소 (동·호수 등)"
                value={addressInput.addr2}
                onChange={(event) =>
                  setAddressInput((previous) => ({ ...previous, addr2: event.target.value }))
                }
              />
            </div>
          ) : null}

          <label className="mt-3 block">
            <span className="sr-only">배송 메모</span>
            <select
              aria-label="배송 메모"
              className="h-11 w-full cursor-pointer rounded-[calc(var(--radius)-4px)] border border-input bg-card px-3.5 text-sm"
              value={deliveryMemo}
              onChange={(event) => setDeliveryMemo(event.target.value)}
            >
              <option value="">배송 메모 (선택)</option>
              {DELIVERY_MEMO_OPTIONS.map((memoOption) => (
                <option key={memoOption.code} value={memoOption.label}>
                  {memoOption.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        {/* ④ 주문 상품 */}
        <section aria-labelledby="checkout-items-heading" className="border-t border-border pt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="checkout-items-heading" className="m-0 font-heading text-lg font-extrabold">
              주문 상품
            </h2>
            <span className="text-[13px] text-muted-foreground">
              총 {orderableLines.length}건
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {orderableLines.map((line) => (
              <li key={line.cartItemId} className="flex items-start gap-3">
                <div className="size-16 shrink-0 overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border">
                  {line.thumbnailPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={line.thumbnailPath}
                      alt={line.thumbnailAlt ?? line.productName}
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImagePlaceholder />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {line.makerName ? (
                    <p className="m-0 text-xs text-muted-foreground">{line.makerName}</p>
                  ) : null}
                  <p className="m-0 text-sm font-bold">{line.productName}</p>
                  <p className="m-0 text-[13px] text-muted-foreground">
                    {[line.optionLabel, `수량 ${line.quantity}`].filter(Boolean).join(" · ")}
                    {line.addons.length > 0
                      ? ` · 추가 ${line.addons.length}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold">{formatKrw(line.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ⑤ 결제수단 — 토스 결제위젯이 들어올 자리 */}
        <section aria-labelledby="checkout-payment-heading" className="border-t border-border pt-5">
          <h2 id="checkout-payment-heading" className="m-0 mb-3 font-heading text-lg font-extrabold">
            결제수단
          </h2>
          {!checkoutView.tossClientKey ? (
            <div className="rounded-[calc(var(--radius)-2px)] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
              결제 연동 준비 중입니다. 토스페이먼츠 키가 등록되면 이 자리에 결제 수단이 표시됩니다.
            </div>
          ) : checkoutView.tossPaymentUiMode === "widget" ? (
            // 위젯 모드 — SDK가 이 컨테이너 안에 수단·약관 UI를 직접 렌더한다
            <>
              <div id="toss-payment-methods" />
              <div id="toss-payment-agreement" className="mt-3" />
            </>
          ) : (
            // 결제창 모드 — 수단을 우리가 그리고 requestPayment({ method })로 넘긴다
            <RadioGroup
              aria-label="결제수단 선택"
              value={paymentMethod}
              onValueChange={(nextMethod) => setPaymentMethod(nextMethod as TossPaymentMethod)}
            >
              {WINDOW_PAYMENT_METHODS.map((paymentOption) => (
                <RadioGroupCard
                  key={paymentOption.method}
                  value={paymentOption.method}
                  className="items-center"
                >
                  <b className="text-sm">{paymentOption.label}</b>
                </RadioGroupCard>
              ))}
            </RadioGroup>
          )}

          {createdOrder ? (
            <p className="m-0 mt-3 text-[13px] text-muted-foreground">
              주문번호 {createdOrder.orderNo} — 결제가 완료되지 않았다면 아래 버튼으로 다시
              시도하실 수 있어요.
            </p>
          ) : null}
        </section>

        {/* ⑥ 약관 동의 */}
        <section aria-labelledby="checkout-terms-heading" className="border-t border-border pt-5">
          <h2 id="checkout-terms-heading" className="sr-only">
            약관 동의
          </h2>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 pb-3.5">
            <Checkbox
              checked={allTermsAgreed}
              aria-label="전체 동의"
              onCheckedChange={(checked) =>
                setAgreedTermsIds(checked === true ? allTermsIds : [])
              }
            />
            <span className="text-[15px] font-extrabold">전체 동의</span>
          </label>

          <ul className="m-0 flex list-none flex-col gap-1 border-t border-border p-0 pt-3.5">
            {checkoutView.terms.map((termsDoc) => (
              <li key={termsDoc.termsDocumentId} className="flex min-h-11 items-center gap-3">
                <Checkbox
                  id={`terms-${termsDoc.termsDocumentId}`}
                  checked={agreedTermsIds.includes(termsDoc.termsDocumentId)}
                  aria-label={`${termsDoc.isRequired ? "필수" : "선택"} 동의: ${termsDoc.title}`}
                  onCheckedChange={(checked) =>
                    toggleTerms(termsDoc.termsDocumentId, checked === true)
                  }
                />
                <label
                  htmlFor={`terms-${termsDoc.termsDocumentId}`}
                  className="flex-1 cursor-pointer text-[13px]"
                >
                  <span
                    className={cn(
                      "font-bold",
                      termsDoc.isRequired ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {termsDoc.isRequired ? "[필수]" : "[선택]"}
                  </span>{" "}
                  {termsDoc.title}
                </label>
                <a
                  href={`/terms/${termsDoc.termsCode}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  보기
                  <span className="sr-only"> (새 창)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

      </div>

      {/*
        요약 카드는 DOM에 하나만 둔다 — 모바일용·데스크톱용을 각각 렌더하면 보조기기에
        '주문 요약' 제목과 결제 버튼이 두 번 읽힌다. 그리드가 좁은 화면에서 아래로 흘려준다.
      */}
      <aside className="self-start lg:sticky lg:top-4">{orderSummaryCard}</aside>
    </div>
  )
}
