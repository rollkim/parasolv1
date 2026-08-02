"use client"

// 핸드오프 규격: 마이페이지.dc.html — 프로필 요약 카드 · 섹션 내비(모바일 칩 / 데스크톱 220px 사이드)
// · 조건부 렌더 4섹션(주문 내역·배송지 관리·내 리뷰·정보 수정, URL 라우팅 없는 단일 페이지 상태 전환).
// [탭 순서](마이페이지 L111): 섹션 내비 → 섹션 콘텐츠 액션 (로고는 공통 셸 몫)
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 등급 뱃지·적립금/쿠폰/누적주문 스탯 3열 중 **적립금만** 살린다: 쿠폰·등급은 아직 미구현이라
//    빈 숫자를 세 칸 늘어놓지 않는다. 이메일 마스킹도 안 한다(본인 화면 — 목업은 데모 값).
//  - 주문 내역: 주문 도메인 미구현 — 목업 시드 카드 대신 빈 상태(목업에 빈 상태 규격이 없어 신규 설계).
//  - 내 리뷰: 목록은 이 섹션이, 작성 폼은 /mypage/reviews가 맡는다 — 별점·태그·사진이 들어가는
//    폼을 섹션에 얹으면 다른 섹션 상태까지 이 화면이 떠안는다.
//  - 배송지 추가/수정 폼: 목업은 토스트 데모뿐 — 오버레이 모음 폼 모달 규격(Dialog)로 신규 구성.
//    우편번호는 다음 주소검색 레이어로 채운다(체크아웃과 같은 방식). 삭제는 확인 모달 경유(목업 실측).
//  - 기본 배송지 수정 시 '기본' 체크박스를 숨긴다: 해제를 허용하면 기본 배송지가 0개인 상태가 생긴다.
//  - aside 로그아웃 버튼 없음: 공통 셸(헤더 유틸/드로어)이 이미 제공해 중복 배선하지 않는다.
//  - 칩 38px·카드 버튼 38px → 44px 상향(KWCAG 터치 타겟). 섹션 전환 시 섹션 제목으로 포커스 이동(접근성 보완).
//  - 컨테이너 쿼리(@container, 768px)는 셸 선례를 따라 뷰포트 기준(md:)으로 환산.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CoinsIcon, MapPinIcon, PackageIcon, StarIcon, UserIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { ImagePlaceholder } from "@/components/store/image-placeholder"
import { openDaumPostcode } from "@/lib/daum-postcode"
import { formatKrw } from "@/lib/format"
import { MAX_SAVED_ADDRESSES } from "@/domain/address"
import { cn } from "@/lib/utils"
import type { CustomerAddress, MyProfile } from "@/server/services/customer.service"
import { useTRPC } from "@/trpc/client"

type MypageSectionKey = "orders" | "points" | "addresses" | "reviews" | "profile"

const MYPAGE_SECTIONS: { sectionKey: MypageSectionKey; sectionLabel: string }[] = [
  { sectionKey: "orders", sectionLabel: "주문 내역" },
  { sectionKey: "points", sectionLabel: "적립금" },
  { sectionKey: "addresses", sectionLabel: "배송지 관리" },
  { sectionKey: "reviews", sectionLabel: "내 리뷰" },
  { sectionKey: "profile", sectionLabel: "정보 수정" },
]

const MOBILE_PHONE_PATTERN = /^01[016789][0-9]{7,8}$/

/** 하이픈 제거 저장값(서버 규약)을 표시용으로 되돌린다 */
function formatMobileForDisplay(mobileDigits: string): string {
  const phoneParts = mobileDigits.match(/^(01[0-9])([0-9]{3,4})([0-9]{4})$/)
  return phoneParts
    ? `${phoneParts[1]}-${phoneParts[2]}-${phoneParts[3]}`
    : mobileDigits
}

/** 표시용 체크박스 — 목업 [data-check] 22px 규격(cart·auth·qna와 동일한 네 번째 재선언 — ui 승격 후보) */
function DefaultAddressCheckMark({ checked }: { checked: boolean }) {
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

/** 폼 필드 공통 골격 — 라벨·인풋·오류(원인+해결)를 같은 구조로 묶는다 */
function FormFieldRow({
  fieldId,
  fieldLabel,
  required = false,
  errorMessage,
  hintMessage,
  children,
}: {
  fieldId: string
  fieldLabel: string
  required?: boolean
  errorMessage?: string
  hintMessage?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId} required={required}>
        {fieldLabel}
      </Label>
      {children}
      {errorMessage ? (
        <p
          id={`${fieldId}-error`}
          className="m-0 text-xs font-semibold text-destructive"
        >
          {errorMessage}
        </p>
      ) : hintMessage ? (
        <p id={`${fieldId}-hint`} className="m-0 text-xs text-muted-foreground">
          {hintMessage}
        </p>
      ) : null}
    </div>
  )
}

// =============================================================
// 주문 내역 (내 리뷰는 도메인 미구현이라 빈 상태 — 파일 머리 주석 참조)
// =============================================================

function OrdersSection() {
  const trpc = useTRPC()
  const ordersQuery = useQuery(trpc.order.listMyOrders.queryOptions())

  if (ordersQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">주문 내역을 불러오는 중입니다</span>
      </div>
    )
  }

  if (ordersQuery.isError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
        주문 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  const orderCards = ordersQuery.data ?? []
  if (orderCards.length === 0) {
    return (
      <EmptyState
        size="section"
        stateTone="neutral"
        headingLevel={3}
        icon={<PackageIcon aria-hidden="true" />}
        title="아직 주문이 없어요"
        description="마음에 드는 상품을 찾아 첫 주문을 시작해 보세요."
        actions={[{ label: "상품 보러가기", href: "/products" }]}
      />
    )
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {orderCards.map((orderCard) => (
        <li key={orderCard.orderNo}>
          {/* 카드 전체가 상세 진입 — 터치 타겟이 넉넉하고 링크가 하나뿐이라 탐색이 단순하다 */}
          <Link
            href={`/order/${orderCard.orderNo}`}
            className="flex items-start gap-3 rounded-[var(--radius)] border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <div className="size-16 shrink-0 overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border">
              {orderCard.leadThumbnailPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={orderCard.leadThumbnailPath}
                  alt={orderCard.leadThumbnailAlt ?? orderCard.leadProductName}
                  className="size-full object-cover"
                />
              ) : (
                <ImagePlaceholder />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-muted-foreground">
                  {new Date(orderCard.orderedAt).toLocaleDateString("ko-KR")}
                </span>
                <span className="rounded-[5px] border border-primary px-1.5 py-px text-[11px] font-bold text-primary">
                  {orderCard.orderStatusLabel}
                </span>
              </div>
              <p className="m-0 mt-1 text-sm font-bold">
                {orderCard.leadProductName}
                {orderCard.itemCount > 1 ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    외 {orderCard.itemCount - 1}건
                  </span>
                ) : null}
              </p>
              <p className="m-0 text-[13px] text-muted-foreground">{orderCard.orderNo}</p>
            </div>
            <span className="shrink-0 text-sm font-bold">{formatKrw(orderCard.grandTotal)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * 내 리뷰 — 쓸 상품과 쓴 리뷰를 함께 보여준다.
 *
 * 작성 폼은 이 섹션 안에서 열지 않고 /mypage/reviews로 보낸다: 별점·태그·사진·본문이
 * 들어가는 폼이라 섹션 하나에 얹으면 다른 섹션 상태까지 이 화면이 떠안는다.
 */
function ReviewsSection() {
  const trpc = useTRPC()
  const reviewableQuery = useQuery(trpc.review.listReviewable.queryOptions())
  const mineQuery = useQuery(trpc.review.listMine.queryOptions())

  if (reviewableQuery.isPending || mineQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">리뷰를 불러오는 중입니다</span>
      </div>
    )
  }

  const reviewableCount = reviewableQuery.data?.length ?? 0
  const myReviews = mineQuery.data ?? []

  if (reviewableCount === 0 && myReviews.length === 0) {
    return (
      <EmptyState
        size="section"
        stateTone="neutral"
        headingLevel={3}
        icon={<StarIcon aria-hidden="true" />}
        title="작성한 리뷰가 없어요"
        description="구매한 상품을 받으시면 여기에서 리뷰를 남기실 수 있어요."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {reviewableCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-primary bg-card p-4">
          <p className="m-0 min-w-0 flex-1 text-sm">
            리뷰를 기다리는 상품이 <b className="font-bold">{reviewableCount}개</b> 있어요.
          </p>
          <Button variant="primary" size="sm-44" asChild>
            <Link href="/mypage/reviews">리뷰 쓰러 가기</Link>
          </Button>
        </div>
      ) : null}

      {myReviews.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">아직 작성한 리뷰가 없어요.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {myReviews.map((myReview) => (
            <li
              key={myReview.reviewId}
              className="rounded-[var(--radius)] border border-border bg-card p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true" className="text-sm text-primary">
                  {"★".repeat(myReview.rating)}
                </span>
                <span className="text-[13px] font-bold">{myReview.rating}점</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {myReview.productName}
                </span>
                {/* 숨김 처리된 리뷰도 본인에게는 보인다 — 사라지면 왜 없는지 알 수 없다 */}
                {myReview.isHidden ? (
                  <span className="rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">
                    비공개 처리됨
                  </span>
                ) : null}
              </div>
              <p className="m-0 mt-2 whitespace-pre-wrap text-[13px] leading-[1.8] text-muted-foreground">
                {myReview.content}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Button variant="outline" size="sm-44" className="self-start" asChild>
        <Link href="/mypage/reviews">리뷰 전체 관리</Link>
      </Button>
    </div>
  )
}

// =============================================================
// 적립금
// =============================================================

/** 원장 한 줄의 성격 — 부호로 갈린다. 색만으로 전달하지 않으려면 글자 라벨이 필요하다(KWCAG) */
function pointRowKindLabel(amount: number): string {
  return amount >= 0 ? "적립" : "차감"
}

function formatPointDate(value: Date | string): string {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function PointsSection() {
  const trpc = useTRPC()
  const [page, setPage] = React.useState(1)

  const summaryQuery = useQuery(trpc.mypage.pointSummary.queryOptions())
  const historyQuery = useQuery(trpc.mypage.pointHistory.queryOptions({ page }))

  if (summaryQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">적립금을 불러오는 중입니다</span>
      </div>
    )
  }

  const pointSummary = summaryQuery.data
  const history = historyQuery.data
  const totalPages = history ? Math.max(1, Math.ceil(history.totalCount / history.pageSize)) : 1

  return (
    <div className="flex flex-col gap-4">
      {/* 보유와 사용 가능을 나눠 보여준다 — 소멸 대기분이 섞인 보유액만 보이면
          "있다는데 결제에서 안 된다"가 문의로 돌아온다 */}
      <div className="rounded-[var(--radius)] border border-border bg-card p-5">
        <p className="m-0 text-[13px] text-muted-foreground">사용 가능 적립금</p>
        <strong className="mt-1 block font-heading text-[28px] font-extrabold text-primary">
          {formatKrw(pointSummary?.usableBalance ?? 0)}
        </strong>
        {pointSummary && pointSummary.balance !== pointSummary.usableBalance ? (
          <p className="m-0 mt-1 text-[13px] text-muted-foreground">
            보유 {formatKrw(pointSummary.balance)} — 차액은 사용 기한이 지난 금액이에요.
          </p>
        ) : null}

        {pointSummary && pointSummary.expiringSoonAmount > 0 ? (
          <p
            // 소멸 예정은 '알아야 손해를 막는' 정보라 조용히 두지 않는다
            className="m-0 mt-3 rounded-[calc(var(--radius)-2px)] border border-primary bg-secondary px-3.5 py-3 text-[13px] font-semibold text-secondary-foreground"
          >
            30일 안에 {formatKrw(pointSummary.expiringSoonAmount)}이 소멸돼요. 먼저 사용해 주세요.
          </p>
        ) : null}
      </div>

      {historyQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">적립금 내역을 불러오는 중입니다</span>
        </div>
      ) : (history?.rows.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={3}
          icon={<CoinsIcon aria-hidden="true" />}
          title="적립금 내역이 없어요"
          description="구매를 확정하시면 결제 금액의 일부가 적립금으로 돌아와요."
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {history?.rows.map((historyRow) => (
              <li
                key={historyRow.transactionId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] border border-border bg-card p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-semibold">{historyRow.title}</p>
                  <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
                    {[
                      formatPointDate(historyRow.createdAt),
                      historyRow.orderNo ? `주문 ${historyRow.orderNo}` : null,
                      historyRow.expiresAt
                        ? `${formatPointDate(historyRow.expiresAt)} 소멸`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <b
                    className={cn(
                      "block text-sm font-bold",
                      historyRow.amount >= 0 ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">{pointRowKindLabel(historyRow.amount)} </span>
                    {historyRow.amount >= 0 ? "+" : "-"}
                    {formatKrw(Math.abs(historyRow.amount))}
                  </b>
                  <span className="text-[12px] text-muted-foreground">
                    잔액 {formatKrw(historyRow.balanceAfter)}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {/* 1페이지뿐이어도 [1]을 보여준다 — 목록이 끝났다는 신호가 된다(관리자 규격과 통일) */}
          <nav aria-label="적립금 내역 페이지" className="flex flex-wrap items-center gap-2">
            {Array.from({ length: totalPages }, (_, pageIndex) => pageIndex + 1).map(
              (pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  aria-current={pageNumber === page ? "page" : undefined}
                  onClick={() => setPage(pageNumber)}
                  className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[calc(var(--radius)-4px)] border border-border bg-card text-[13px] font-semibold text-foreground hover:bg-muted aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground"
                >
                  {pageNumber}
                </button>
              ),
            )}
          </nav>
        </>
      )}
    </div>
  )
}

// =============================================================
// 배송지 관리
// =============================================================

type AddressFieldKey = "recipient" | "phone" | "zipcode" | "addr1" | "addr2" | "label"

/** 오류 시 포커스 이동 순서 = 폼 렌더 순서 */
const ADDRESS_FIELD_ORDER: AddressFieldKey[] = [
  "recipient",
  "phone",
  "zipcode",
  "addr1",
  "addr2",
  "label",
]

function AddressFormDialog({
  editingAddress,
  onClose,
}: {
  /** null이면 신규 등록 */
  editingAddress: CustomerAddress | null
  onClose: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const isEditMode = editingAddress !== null
  const createAddressMutation = useMutation(trpc.mypage.createAddress.mutationOptions())
  const updateAddressMutation = useMutation(trpc.mypage.updateAddress.mutationOptions())
  const savePending = createAddressMutation.isPending || updateAddressMutation.isPending

  const [recipientValue, setRecipientValue] = React.useState(
    editingAddress?.recipient ?? ""
  )
  const [phoneValue, setPhoneValue] = React.useState(
    editingAddress ? formatMobileForDisplay(editingAddress.phone) : ""
  )
  const [zipcodeValue, setZipcodeValue] = React.useState(editingAddress?.zipcode ?? "")
  const [addr1Value, setAddr1Value] = React.useState(editingAddress?.addr1 ?? "")
  const [addr2Value, setAddr2Value] = React.useState(editingAddress?.addr2 ?? "")
  const [labelValue, setLabelValue] = React.useState(editingAddress?.label ?? "")
  const [isDefaultChecked, setIsDefaultChecked] = React.useState(false)
  const postcodeLayerRef = React.useRef<HTMLDivElement>(null)
  const addr2InputRef = React.useRef<HTMLInputElement>(null)
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<AddressFieldKey, string>>
  >({})

  // 현재 기본 배송지를 수정할 때는 체크박스를 숨긴다 — 해제를 허용하면 기본이 0개가 된다
  const showDefaultCheckbox = !(isEditMode && editingAddress.isDefault)

  /** 다음 우편번호 레이어 — 고르면 우편번호·기본주소가 채워지고 상세주소로 포커스가 간다(체크아웃 선례) */
  async function openPostcodeSearch() {
    const container = postcodeLayerRef.current
    if (!container) return
    try {
      await openDaumPostcode({
        container,
        onSelect: (addressFields) => {
          setZipcodeValue(addressFields.zipcode)
          setAddr1Value(addressFields.addr1)
          setFieldErrors((previousErrors) => {
            const nextErrors = { ...previousErrors }
            delete nextErrors.zipcode
            delete nextErrors.addr1
            return nextErrors
          })
          // 주소를 고르면 남은 건 동·호수뿐이다 — 거기로 바로 보낸다
          window.setTimeout(() => addr2InputRef.current?.focus(), 0)
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

  const handleFieldChange = (fieldKey: AddressFieldKey, fieldValue: string) => {
    const setterByField: Record<AddressFieldKey, (nextValue: string) => void> = {
      recipient: setRecipientValue,
      phone: setPhoneValue,
      zipcode: setZipcodeValue,
      addr1: setAddr1Value,
      addr2: setAddr2Value,
      label: setLabelValue,
    }
    setterByField[fieldKey](fieldValue)
    // 수정을 시작하면 해당 필드의 지난 오류는 걷어낸다 — 재검증은 제출 시점에(qna-form 선례)
    setFieldErrors((previousErrors) => {
      if (!previousErrors[fieldKey]) return previousErrors
      const nextErrors = { ...previousErrors }
      delete nextErrors[fieldKey]
      return nextErrors
    })
  }

  /** mypage 라우터 zod와 동일한 클라이언트 사전 검증 — 최종 판정은 항상 서버가 한다 */
  const validateAddressFields = (): Partial<Record<AddressFieldKey, string>> => {
    const validationErrors: Partial<Record<AddressFieldKey, string>> = {}

    if (recipientValue.trim().length === 0) {
      validationErrors.recipient = "받는 분 이름을 입력해 주세요."
    } else if (recipientValue.trim().length > 50) {
      validationErrors.recipient = "받는 분 이름은 50자 이하로 입력해 주세요."
    }
    if (!MOBILE_PHONE_PATTERN.test(phoneValue.replaceAll("-", ""))) {
      validationErrors.phone =
        "휴대폰 번호 형식이 올바르지 않습니다. '-' 없이 01로 시작하는 번호를 입력해 주세요."
    }
    if (!/^[0-9]{5}$/.test(zipcodeValue.trim())) {
      validationErrors.zipcode = "우편번호는 숫자 5자리로 입력해 주세요."
    }
    if (addr1Value.trim().length === 0) {
      validationErrors.addr1 = "주소를 입력해 주세요."
    } else if (addr1Value.trim().length > 200) {
      validationErrors.addr1 = "주소는 200자 이하로 입력해 주세요."
    }
    if (addr2Value.trim().length > 200) {
      validationErrors.addr2 = "상세 주소는 200자 이하로 입력해 주세요."
    }
    if (labelValue.trim().length > 20) {
      validationErrors.label = "배송지 이름은 20자 이하로 입력해 주세요."
    }

    return validationErrors
  }

  const handleAddressSubmit = (formSubmitEvent: React.FormEvent<HTMLFormElement>) => {
    formSubmitEvent.preventDefault()
    if (savePending) return

    const validationErrors = validateAddressFields()
    setFieldErrors(validationErrors)
    const firstErroredField = ADDRESS_FIELD_ORDER.find(
      (fieldKey) => validationErrors[fieldKey]
    )
    if (firstErroredField) {
      document.getElementById(`addr-${firstErroredField}`)?.focus()
      return
    }

    const saveAddressFields = {
      recipient: recipientValue.trim(),
      phone: phoneValue.replaceAll("-", ""),
      zipcode: zipcodeValue.trim(),
      addr1: addr1Value.trim(),
      // 빈 문자열은 보내지 않는다 — 서버가 null로 통일 저장하는 규약과 맞춘다
      ...(addr2Value.trim() ? { addr2: addr2Value.trim() } : {}),
      ...(labelValue.trim() ? { label: labelValue.trim() } : {}),
      // 체크했을 때만 보낸다 — 수정에서 미전송이면 기본 여부를 건드리지 않는다(서버 규약)
      ...(showDefaultCheckbox && isDefaultChecked ? { isDefault: true } : {}),
    }

    const saveHandlers = {
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.mypage.listAddresses.pathFilter())
        showToast(isEditMode ? "배송지를 수정했어요" : "배송지를 추가했어요")
        onClose()
      },
      onError: (saveError: { message: string }) => {
        // zod 다중 이슈는 message가 JSON 배열 문자열로 온다 — 그대로 노출하지 않는다(qna-form 선례)
        showToast(
          saveError.message.startsWith("[")
            ? "배송지를 저장하지 못했어요. 입력값을 확인하고 다시 시도해 주세요."
            : saveError.message,
          { toastVariant: "error" }
        )
      },
    }

    if (isEditMode) {
      updateAddressMutation.mutate(
        { addressId: editingAddress.addressId, ...saveAddressFields },
        saveHandlers
      )
    } else {
      createAddressMutation.mutate(saveAddressFields, saveHandlers)
    }
  }

  return (
    <Dialog open onOpenChange={(dialogOpen) => !dialogOpen && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "배송지 수정" : "배송지 추가"}</DialogTitle>
          <DialogDescription>
            받는 분 정보와 주소를 입력해 주세요.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleAddressSubmit}
          noValidate
          className="flex flex-col gap-3.5"
        >
          <FormFieldRow
            fieldId="addr-recipient"
            fieldLabel="받는 분"
            required
            errorMessage={fieldErrors.recipient}
          >
            <Input
              id="addr-recipient"
              size="modal"
              type="text"
              autoComplete="name"
              placeholder="받는 분 이름"
              value={recipientValue}
              onChange={(changeEvent) =>
                handleFieldChange("recipient", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.recipient ? true : undefined}
              aria-describedby={
                fieldErrors.recipient ? "addr-recipient-error" : undefined
              }
            />
          </FormFieldRow>

          <FormFieldRow
            fieldId="addr-phone"
            fieldLabel="휴대폰 번호"
            required
            errorMessage={fieldErrors.phone}
          >
            <Input
              id="addr-phone"
              size="modal"
              type="tel"
              autoComplete="tel"
              placeholder="'-' 없이 숫자만"
              value={phoneValue}
              onChange={(changeEvent) =>
                handleFieldChange("phone", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.phone ? true : undefined}
              aria-describedby={fieldErrors.phone ? "addr-phone-error" : undefined}
            />
          </FormFieldRow>

          <FormFieldRow
            fieldId="addr-zipcode"
            fieldLabel="우편번호"
            required
            errorMessage={fieldErrors.zipcode}
            hintMessage="주소 검색으로 채우면 오타 없이 정확합니다."
          >
            <div className="flex gap-2">
              <Input
                id="addr-zipcode"
                size="modal"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                readOnly
                placeholder="주소 검색"
                className="max-w-[140px]"
                value={zipcodeValue}
                aria-invalid={fieldErrors.zipcode ? true : undefined}
                aria-describedby={
                  fieldErrors.zipcode ? "addr-zipcode-error" : "addr-zipcode-hint"
                }
              />
              <Button type="button" variant="outline" size="sm-44" onClick={openPostcodeSearch}>
                주소 검색
              </Button>
            </div>
            {/* 검색 레이어가 이 안에 뜬다 — 새 창이 아니라서 팝업 차단·탭 이탈이 없다(체크아웃 선례) */}
            <div ref={postcodeLayerRef} className="empty:hidden" />
          </FormFieldRow>

          <FormFieldRow
            fieldId="addr-addr1"
            fieldLabel="주소"
            required
            errorMessage={fieldErrors.addr1}
          >
            <Input
              id="addr-addr1"
              size="modal"
              type="text"
              autoComplete="address-line1"
              placeholder="도로명 또는 지번 주소"
              value={addr1Value}
              onChange={(changeEvent) =>
                handleFieldChange("addr1", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.addr1 ? true : undefined}
              aria-describedby={fieldErrors.addr1 ? "addr-addr1-error" : undefined}
            />
          </FormFieldRow>

          <FormFieldRow
            fieldId="addr-addr2"
            fieldLabel="상세 주소"
            errorMessage={fieldErrors.addr2}
          >
            <Input
              id="addr-addr2"
              ref={addr2InputRef}
              size="modal"
              type="text"
              autoComplete="address-line2"
              placeholder="동·호수 등 (선택)"
              value={addr2Value}
              onChange={(changeEvent) =>
                handleFieldChange("addr2", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.addr2 ? true : undefined}
              aria-describedby={fieldErrors.addr2 ? "addr-addr2-error" : undefined}
            />
          </FormFieldRow>

          <FormFieldRow
            fieldId="addr-label"
            fieldLabel="배송지 이름"
            errorMessage={fieldErrors.label}
          >
            <Input
              id="addr-label"
              size="modal"
              type="text"
              placeholder="예: 우리집, 회사 (선택)"
              value={labelValue}
              onChange={(changeEvent) =>
                handleFieldChange("label", changeEvent.target.value)
              }
              aria-invalid={fieldErrors.label ? true : undefined}
              aria-describedby={fieldErrors.label ? "addr-label-error" : undefined}
            />
          </FormFieldRow>

          {showDefaultCheckbox && (
            <button
              type="button"
              role="checkbox"
              aria-checked={isDefaultChecked}
              onClick={() => setIsDefaultChecked((previousChecked) => !previousChecked)}
              className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 px-1 text-left"
            >
              <DefaultAddressCheckMark checked={isDefaultChecked} />
              <span className="text-sm font-semibold text-foreground">
                기본 배송지로 설정
              </span>
            </button>
          )}

          <DialogFooter className="mt-1.5">
            <Button
              type="button"
              variant="outline"
              size="md-48"
              className="flex-1"
              onClick={onClose}
            >
              취소
            </Button>
            {/* pending은 aria-disabled — hard disabled는 포커스를 body로 유실시킨다(장바구니 선례) */}
            <Button
              type="submit"
              variant="primary"
              size="md-48"
              className="flex-1"
              aria-disabled={savePending}
            >
              {savePending ? "저장 중…" : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddressesSection() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const addressListQuery = useQuery(trpc.mypage.listAddresses.queryOptions())
  const setDefaultMutation = useMutation(
    trpc.mypage.setDefaultAddress.mutationOptions()
  )
  const deleteAddressMutation = useMutation(trpc.mypage.deleteAddress.mutationOptions())

  /* 폼 모달 상태 — undefined=닫힘 · null=신규 등록 · CustomerAddress=수정.
     key로 넘겨 대상이 바뀔 때마다 폼 상태를 초기화한다 */
  const [addressFormTarget, setAddressFormTarget] = React.useState<
    CustomerAddress | null | undefined
  >(undefined)
  const [deleteTarget, setDeleteTarget] = React.useState<CustomerAddress | null>(null)

  const refreshAddressList = () =>
    void queryClient.invalidateQueries(trpc.mypage.listAddresses.pathFilter())

  const handleSetDefault = (targetAddress: CustomerAddress) => {
    if (setDefaultMutation.isPending) return
    setDefaultMutation.mutate(
      { addressId: targetAddress.addressId },
      {
        onSuccess: () => {
          refreshAddressList()
          showToast("기본 배송지로 설정했어요")
        },
        onError: (setDefaultError) => {
          showToast(setDefaultError.message, { toastVariant: "error" })
          refreshAddressList()
        },
      }
    )
  }

  const handleConfirmDelete = () => {
    if (deleteTarget === null || deleteAddressMutation.isPending) return
    deleteAddressMutation.mutate(
      { addressId: deleteTarget.addressId },
      {
        onSuccess: () => {
          refreshAddressList()
          showToast("배송지를 삭제했어요")
          setDeleteTarget(null)
        },
        onError: (deleteError) => {
          showToast(deleteError.message, { toastVariant: "error" })
          refreshAddressList()
          setDeleteTarget(null)
        },
      }
    )
  }

  /* 상한은 서버가 판정한다(여기 숫자는 안내용) — 다 찼을 때 폼을 열게 두면
     주소를 다 입력하고 저장 버튼에서야 거부당한다. 미리 알리고, 그래도 누르면 이유를 말해준다 */
  const savedAddressCount = addressListQuery.data?.length ?? 0
  const isAddressBookFull = savedAddressCount >= MAX_SAVED_ADDRESSES

  const handleAddAddressClick = () => {
    if (isAddressBookFull) {
      showToast(
        `배송지는 ${MAX_SAVED_ADDRESSES}개까지 저장할 수 있어요. 쓰지 않는 배송지를 지우고 다시 시도해 주세요.`,
        { toastVariant: "error" }
      )
      return
    }
    setAddressFormTarget(null)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">
          주문할 때 사용할 배송지를 관리해요.
          {addressListQuery.isSuccess && (
            <>
              {" "}
              <span className={cn(isAddressBookFull && "font-semibold text-foreground")}>
                ({savedAddressCount}/{MAX_SAVED_ADDRESSES}
                {isAddressBookFull ? " · 가득 참" : ""})
              </span>
            </>
          )}
        </p>
        <Button
          type="button"
          variant="primary"
          size="sm-44"
          // disabled 대신 aria-disabled — 포커스를 유지해 왜 못 누르는지 읽어줄 수 있게 한다
          aria-disabled={isAddressBookFull}
          className={cn(isAddressBookFull && "opacity-50")}
          onClick={handleAddAddressClick}
        >
          + 배송지 추가
        </Button>
      </div>

      {addressListQuery.isPending ? (
        <SkeletonGroup
          loadingLabel="배송지 목록을 불러오는 중입니다"
          className="mt-3.5 flex flex-col gap-2.5"
        >
          {[0, 1].map((rowIndex) => (
            <Skeleton key={rowIndex} className="h-[130px] rounded-lg" />
          ))}
        </SkeletonGroup>
      ) : addressListQuery.isError ? (
        <EmptyState
          role="alert"
          size="panel"
          stateTone="danger"
          headingLevel={3}
          className="mt-3.5"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
              <path d="M12 8v5" strokeLinecap="round" />
              <path d="M12 16.5v.2" strokeLinecap="round" />
            </svg>
          }
          title="배송지를 불러오지 못했어요"
          description="일시적인 문제일 수 있어요. 잠시 후 다시 시도해 주세요."
          actions={[{ label: "다시 시도", onAction: () => void addressListQuery.refetch() }]}
        />
      ) : addressListQuery.data.length === 0 ? (
        <EmptyState
          size="panel"
          stateTone="neutral"
          headingLevel={3}
          className="mt-3.5"
          icon={<MapPinIcon aria-hidden="true" />}
          title="등록된 배송지가 없어요"
          description="배송지를 등록해 두면 주문할 때 바로 선택할 수 있어요."
          actions={[
            { label: "배송지 추가", onAction: () => setAddressFormTarget(null) },
          ]}
        />
      ) : (
        <ul className="m-0 mt-3.5 flex list-none flex-col gap-2.5 p-0">
          {addressListQuery.data.map((customerAddress) => (
            <li
              key={customerAddress.addressId}
              className={cn(
                "rounded-lg border bg-card p-4",
                // 기본 배송지는 테두리로도 구분하되, 의미는 '기본 배송지' 뱃지 텍스트가 전달한다(KWCAG)
                customerAddress.isDefault ? "border-primary" : "border-border"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-bold">
                  {customerAddress.recipient}
                </span>
                {customerAddress.isDefault && (
                  <span className="rounded-[5px] border border-primary px-1.5 py-px text-[11px] font-bold text-primary">
                    기본 배송지
                  </span>
                )}
                {customerAddress.label && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {customerAddress.label}
                  </span>
                )}
              </div>
              <p className="m-0 mt-1.5 text-[13px] leading-[1.6] text-muted-foreground">
                {formatMobileForDisplay(customerAddress.phone)}
                <br />({customerAddress.zipcode}) {customerAddress.addr1}
                {customerAddress.addr2 ? ` ${customerAddress.addr2}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {!customerAddress.isDefault && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm-44"
                    className="text-[13px]"
                    aria-disabled={setDefaultMutation.isPending}
                    onClick={() => handleSetDefault(customerAddress)}
                  >
                    기본으로 설정
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm-44"
                  className="text-[13px]"
                  onClick={() => setAddressFormTarget(customerAddress)}
                >
                  수정
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm-44"
                  className="text-[13px] text-muted-foreground hover:border-destructive hover:bg-card hover:text-destructive"
                  onClick={() => setDeleteTarget(customerAddress)}
                >
                  삭제
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {addressFormTarget !== undefined && (
        <AddressFormDialog
          key={addressFormTarget?.addressId ?? "create"}
          editingAddress={addressFormTarget}
          onClose={() => setAddressFormTarget(undefined)}
        />
      )}

      {/* 삭제 확인 모달 — 오버레이 모음 확인 모달 규격(취소/삭제) */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(dialogOpen) => !dialogOpen && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>배송지를 삭제할까요?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.recipient} · ${deleteTarget.addr1}`
                : ""}
              <br />
              삭제한 배송지는 되돌릴 수 없어요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="md-48"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="md-48"
              className="flex-1"
              aria-disabled={deleteAddressMutation.isPending}
              onClick={handleConfirmDelete}
            >
              {deleteAddressMutation.isPending ? "삭제 중…" : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// =============================================================
// 정보 수정
// =============================================================

type ProfileFieldKey = "name" | "email" | "phone"

const PROFILE_FIELD_ORDER: ProfileFieldKey[] = ["name", "email", "phone"]

function ProfileEditForm({ myProfile }: { myProfile: MyProfile }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const updateProfileMutation = useMutation(trpc.mypage.updateProfile.mutationOptions())

  const [nameValue, setNameValue] = React.useState(myProfile.name)
  const [emailValue, setEmailValue] = React.useState(myProfile.email ?? "")
  const [phoneValue, setPhoneValue] = React.useState(
    myProfile.phone ? formatMobileForDisplay(myProfile.phone) : ""
  )
  const [fieldErrors, setFieldErrors] = React.useState<
    Partial<Record<ProfileFieldKey, string>>
  >({})

  const handleFieldChange = (fieldKey: ProfileFieldKey, fieldValue: string) => {
    const setterByField: Record<ProfileFieldKey, (nextValue: string) => void> = {
      name: setNameValue,
      email: setEmailValue,
      phone: setPhoneValue,
    }
    setterByField[fieldKey](fieldValue)
    setFieldErrors((previousErrors) => {
      if (!previousErrors[fieldKey]) return previousErrors
      const nextErrors = { ...previousErrors }
      delete nextErrors[fieldKey]
      return nextErrors
    })
  }

  /** mypage.updateProfile zod와 동일한 사전 검증 — 최종 판정은 항상 서버가 한다 */
  const validateProfileFields = (): Partial<Record<ProfileFieldKey, string>> => {
    const validationErrors: Partial<Record<ProfileFieldKey, string>> = {}

    if (nameValue.trim().length === 0) {
      validationErrors.name = "이름을 입력해 주세요."
    } else if (nameValue.trim().length > 50) {
      validationErrors.name = "이름은 50자 이하로 입력해 주세요."
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim())) {
      validationErrors.email = "이메일 형식이 올바르지 않습니다. 다시 확인해 주세요."
    }
    if (!MOBILE_PHONE_PATTERN.test(phoneValue.replaceAll("-", ""))) {
      validationErrors.phone =
        "휴대폰 번호 형식이 올바르지 않습니다. '-' 없이 01로 시작하는 번호를 입력해 주세요."
    }

    return validationErrors
  }

  const handleProfileSubmit = (formSubmitEvent: React.FormEvent<HTMLFormElement>) => {
    formSubmitEvent.preventDefault()
    if (updateProfileMutation.isPending) return

    const validationErrors = validateProfileFields()
    setFieldErrors(validationErrors)
    const firstErroredField = PROFILE_FIELD_ORDER.find(
      (fieldKey) => validationErrors[fieldKey]
    )
    if (firstErroredField) {
      document.getElementById(`profile-${firstErroredField}`)?.focus()
      return
    }

    updateProfileMutation.mutate(
      {
        name: nameValue.trim(),
        email: emailValue.trim(),
        phone: phoneValue.replaceAll("-", ""),
      },
      {
        onSuccess: (updatedProfile) => {
          // 응답이 곧 최신 프로필 — 요약 카드가 재조회 없이 갱신되도록 캐시를 직접 맞춘다.
          // 이름은 auth.sessionInfo 캐시에도 있으므로 함께 무효화한다.
          queryClient.setQueryData(trpc.mypage.getProfile.queryKey(), updatedProfile)
          void queryClient.invalidateQueries(trpc.auth.sessionInfo.pathFilter())
          showToast("회원 정보를 수정했어요")
        },
        onError: (updateError) => {
          showToast(
            updateError.message.startsWith("[")
              ? "회원 정보를 수정하지 못했어요. 입력값을 확인하고 다시 시도해 주세요."
              : updateError.message,
            { toastVariant: "error" }
          )
        },
      }
    )
  }

  return (
    <form
      onSubmit={handleProfileSubmit}
      noValidate
      className="flex max-w-[420px] flex-col gap-[18px]"
    >
      {myProfile.loginId !== null ? (
        <FormFieldRow
          fieldId="profile-loginId"
          fieldLabel="아이디"
          hintMessage="아이디는 변경할 수 없어요."
        >
          <Input
            id="profile-loginId"
            size="form"
            type="text"
            value={myProfile.loginId}
            readOnly
            aria-describedby="profile-loginId-hint"
          />
        </FormFieldRow>
      ) : (
        <p className="m-0 text-[13px] text-muted-foreground">
          소셜 로그인 계정이에요. 아이디·비밀번호 없이 이용할 수 있어요.
        </p>
      )}

      <FormFieldRow
        fieldId="profile-name"
        fieldLabel="이름"
        required
        errorMessage={fieldErrors.name}
      >
        <Input
          id="profile-name"
          size="form"
          type="text"
          autoComplete="name"
          value={nameValue}
          onChange={(changeEvent) =>
            handleFieldChange("name", changeEvent.target.value)
          }
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "profile-name-error" : undefined}
        />
      </FormFieldRow>

      <FormFieldRow
        fieldId="profile-email"
        fieldLabel="이메일"
        required
        errorMessage={fieldErrors.email}
      >
        <Input
          id="profile-email"
          size="form"
          type="email"
          autoComplete="email"
          value={emailValue}
          onChange={(changeEvent) =>
            handleFieldChange("email", changeEvent.target.value)
          }
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "profile-email-error" : undefined}
        />
      </FormFieldRow>

      <FormFieldRow
        fieldId="profile-phone"
        fieldLabel="휴대폰 번호"
        required
        errorMessage={fieldErrors.phone}
      >
        <Input
          id="profile-phone"
          size="form"
          type="tel"
          autoComplete="tel"
          placeholder="'-' 없이 숫자만"
          value={phoneValue}
          onChange={(changeEvent) =>
            handleFieldChange("phone", changeEvent.target.value)
          }
          aria-invalid={fieldErrors.phone ? true : undefined}
          aria-describedby={fieldErrors.phone ? "profile-phone-error" : undefined}
        />
      </FormFieldRow>

      {/* 비밀번호 변경은 백엔드 미구현 — 후속 배선(파일 머리 주석 참조) */}
      <div className="flex justify-end border-t border-border pt-[18px]">
        <Button
          type="submit"
          variant="primary"
          size="md-48"
          aria-disabled={updateProfileMutation.isPending}
        >
          {updateProfileMutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </div>
    </form>
  )
}

// =============================================================
// 루트
// =============================================================

export function MypageView() {
  const trpc = useTRPC()

  const profileQuery = useQuery(trpc.mypage.getProfile.queryOptions())
  /* 요약 카드가 쓰는 잔액 — 적립금 섹션도 같은 쿼리를 보므로 캐시가 공유된다 */
  const pointSummaryQuery = useQuery(trpc.mypage.pointSummary.queryOptions())

  const [activeSection, setActiveSection] = React.useState<MypageSectionKey>("orders")

  /* 섹션 전환 시 섹션 제목으로 포커스 이동 — 내비 아래 콘텐츠가 통째로 바뀌는 화면에서
     키보드·스크린리더가 길을 잃지 않게 한다(qna-form 선례). 첫 렌더는 제외 */
  const sectionHeadingRef = React.useRef<HTMLHeadingElement>(null)
  const isFirstSectionRender = React.useRef(true)
  React.useEffect(() => {
    if (isFirstSectionRender.current) {
      isFirstSectionRender.current = false
      return
    }
    sectionHeadingRef.current?.focus()
  }, [activeSection])

  if (profileQuery.isPending) {
    return (
      <SkeletonGroup loadingLabel="마이페이지를 불러오는 중입니다">
        <Skeleton className="h-[88px] rounded-lg" />
        <div className="mt-4 flex gap-2">
          {[0, 1, 2, 3].map((chipIndex) => (
            <Skeleton key={chipIndex} className="h-11 w-24 rounded-full" />
          ))}
        </div>
        <Skeleton className="mt-4 h-[280px] rounded-lg" />
      </SkeletonGroup>
    )
  }

  if (profileQuery.isError) {
    return (
      <EmptyState
        role="alert"
        size="section"
        stateTone="danger"
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
            <path d="M12 8v5" strokeLinecap="round" />
            <path d="M12 16.5v.2" strokeLinecap="round" />
          </svg>
        }
        title="회원 정보를 불러오지 못했어요"
        description="일시적인 문제이거나 로그인이 만료됐을 수 있어요. 다시 시도하거나 로그인해 주세요."
        actions={[
          { label: "다시 시도", onAction: () => void profileQuery.refetch() },
          { label: "로그인", actionVariant: "ghost", href: "/login" },
        ]}
      />
    )
  }

  const myProfile = profileQuery.data
  const activeSectionLabel =
    MYPAGE_SECTIONS.find((section) => section.sectionKey === activeSection)
      ?.sectionLabel ?? ""

  return (
    <>
      {/* 프로필 요약 카드 — 아바타 52px·이름 17px·이메일 13px(목업 실측). 스탯·등급은 2차(파일 머리 주석) */}
      <section
        aria-label="내 정보 요약"
        className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-5 py-[18px]"
      >
        <div
          aria-hidden="true"
          className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-secondary text-primary"
        >
          <UserIcon className="size-[26px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold">{myProfile.name}님</div>
          {myProfile.email && (
            <div className="truncate text-[13px] text-muted-foreground">
              {myProfile.email}
            </div>
          )}
        </div>

        {/* 사용 가능 적립금 — 누르면 내역 섹션으로. 요약 카드가 이미 요청하는 값이라 추가 왕복이 없다 */}
        <button
          type="button"
          onClick={() => setActiveSection("points")}
          className="flex min-h-11 cursor-pointer flex-col items-end justify-center rounded-[calc(var(--radius)-4px)] px-3 py-1 text-right hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="text-[12px] text-muted-foreground">적립금</span>
          <b className="font-heading text-[17px] font-extrabold text-primary">
            {pointSummaryQuery.data ? formatKrw(pointSummaryQuery.data.usableBalance) : "—"}
          </b>
        </button>
      </section>

      <div className="mt-4 md:grid md:grid-cols-[220px_minmax(0,1fr)] md:items-start md:gap-8">
        {/* 섹션 내비 — 모바일 가로 스크롤 칩 / 데스크톱 스티키 사이드(목업 실측). 상태 전달은 aria-pressed */}
        <nav aria-label="마이페이지 섹션" className="md:sticky md:top-4">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
            {MYPAGE_SECTIONS.map((section) => (
              <button
                key={section.sectionKey}
                type="button"
                aria-pressed={activeSection === section.sectionKey}
                onClick={() => setActiveSection(section.sectionKey)}
                className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border border-border bg-card px-[15px] text-[13px] font-semibold whitespace-nowrap text-foreground aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {section.sectionLabel}
              </button>
            ))}
          </div>
          <div className="hidden md:flex md:flex-col md:gap-1">
            {MYPAGE_SECTIONS.map((section) => (
              <button
                key={section.sectionKey}
                type="button"
                aria-pressed={activeSection === section.sectionKey}
                onClick={() => setActiveSection(section.sectionKey)}
                className="flex min-h-11 cursor-pointer items-center rounded-[calc(var(--radius)-4px)] px-3.5 text-left text-sm font-semibold text-foreground hover:bg-muted aria-pressed:bg-secondary aria-pressed:text-secondary-foreground aria-pressed:hover:bg-secondary"
              >
                {section.sectionLabel}
              </button>
            ))}
          </div>
        </nav>

        <section aria-label={activeSectionLabel} className="mt-4 min-w-0 md:mt-0">
          <h2
            ref={sectionHeadingRef}
            tabIndex={-1}
            className="m-0 mb-4 font-heading text-xl font-extrabold outline-none"
          >
            {activeSectionLabel}
          </h2>

          {activeSection === "orders" && <OrdersSection />}
          {activeSection === "points" && <PointsSection />}
          {activeSection === "addresses" && <AddressesSection />}
          {activeSection === "reviews" && <ReviewsSection />}
          {activeSection === "profile" && <ProfileEditForm myProfile={myProfile} />}
        </section>
      </div>
    </>
  )
}
