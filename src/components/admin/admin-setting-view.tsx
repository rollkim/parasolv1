"use client"

// 핸드오프 규격: 관리자 설정.dc.html — 사이트 정보 / 사업자 정보 / 정책 문구 / 배송비 정책 /
// 측정 ID.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **PG·소셜·알림톡 시크릿 칸을 두지 않았다.** 서버 env가 소유한다(RULE-11) —
//    DB에 평문으로 두면 관리자 화면 하나만 뚫려도 결제 키가 나간다.
//    대신 '서버에서 관리하는 값' 목록으로 어디 있는지 밝힌다.
//  - 도서·산간 추가배송비는 저장하되 **아직 주문 금액에 반영되지 않는다**고 명시한다.
//    지역 판정이 없는 상태에서 숫자만 보이면 적용되는 줄 안다.
//  - 백업 다운로드는 두지 않았다 — DB 백업은 서버 운영 작업이라 화면에서 흉내 낼 일이 아니다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { useRouter } from "next/navigation"

import { useTRPC } from "@/trpc/client"
import type { ThemePreset } from "@/server/services/theme.service"

/** globals.css가 정의한 순서 — 서버 상수를 그대로 못 쓴다(server-only) */
const THEME_PRESET_ORDER = ["sol", "coral", "grape"] as const
const THEME_PRESET_LABEL: Record<ThemePreset, string> = {
  sol: "솔 그린",
  coral: "감귤 코랄",
  grape: "자두 그레이프",
}

type SettingSection = "site" | "theme" | "policy" | "shipping" | "analytics"

const SETTING_SECTIONS: { section: SettingSection; label: string }[] = [
  { section: "site", label: "사이트·사업자 정보" },
  { section: "theme", label: "테마 색상" },
  { section: "policy", label: "정책 문구" },
  { section: "shipping", label: "배송비 정책" },
  { section: "analytics", label: "측정 ID" },
]

export function AdminSettingView() {
  const trpc = useTRPC()
  const settingQuery = useQuery(trpc.adminSetting.get.queryOptions())
  const [activeSection, setActiveSection] = React.useState<SettingSection>("site")

  if (settingQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">설정을 불러오는 중입니다</span>
      </div>
    )
  }

  if (settingQuery.isError || !settingQuery.data) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
        설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  const settings = settingQuery.data

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="설정 항목" className="flex flex-wrap gap-2 xl:flex-col">
        {SETTING_SECTIONS.map((sectionItem) => (
          <Button
            key={sectionItem.section}
            type="button"
            variant="toggle"
            size="admin-40"
            className="xl:justify-start"
            aria-pressed={activeSection === sectionItem.section}
            onClick={() => setActiveSection(sectionItem.section)}
          >
            {sectionItem.label}
          </Button>
        ))}
      </nav>

      <div className="flex flex-col gap-4">
        {activeSection === "site" ? (
          <BusinessInfoForm key="site" initial={settings.businessInfo} />
        ) : null}
        {activeSection === "theme" ? <ThemeForm key="theme" initial={settings.theme} /> : null}
        {activeSection === "policy" ? (
          <PolicyTextForm key="policy" initial={settings.policyText} />
        ) : null}
        {activeSection === "shipping" ? (
          <ShippingPolicyForm key="shipping" initial={settings.shippingPolicy} />
        ) : null}
        {activeSection === "analytics" ? (
          <AnalyticsForm key="analytics" initial={settings.analytics} />
        ) : null}

        {/* 없는 칸을 찾아 헤매지 않도록 어디서 관리하는지 밝힌다 */}
        <section className="rounded-[var(--radius)] border border-border bg-card p-4">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">서버에서 관리하는 값</h2>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[12px] text-muted-foreground">
            {settings.serverManagedKeys.map((managedKey) => (
              <li key={managedKey.label}>
                <b className="text-foreground">{managedKey.label}</b> — {managedKey.reason}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** 저장 버튼 + 성공/실패 토스트가 네 폼에서 같다 */
function useSettingSave(mutationLabel: string) {
  const queryClient = useQueryClient()
  const trpc = useTRPC()
  const { showToast } = useToast()

  return {
    onSuccess: () => {
      showToast(`${mutationLabel}을(를) 저장했어요.`, { toastVariant: "info" })
      void queryClient.invalidateQueries(trpc.adminSetting.pathFilter())
    },
    onError: (saveError: { message: string }) =>
      showToast(saveError.message, { toastVariant: "error" }),
  }
}

function BusinessInfoForm({
  initial,
}: {
  initial: {
    brandName: string
    companyName: string
    ceoName: string
    businessNo: string
    mailOrderNo: string
    address: string
    privacyOfficer: string
    hostingProvider: string
    csPhone: string
    csHours: string[]
    csEmail?: string
    brandTagline: string
    copyrightNotice: string
  }
}) {
  const trpc = useTRPC()
  const saveMutation = useMutation(trpc.adminSetting.saveBusinessInfo.mutationOptions())
  const handlers = useSettingSave("사업자 정보")

  const [form, setForm] = React.useState({
    ...initial,
    csEmail: initial.csEmail ?? "",
    csHoursText: initial.csHours.join("\n"),
  })

  const fields: { key: keyof typeof form; label: string; hint?: string }[] = [
    { key: "brandName", label: "브랜드명", hint: "로고·워드마크에 쓰입니다" },
    { key: "companyName", label: "상호", hint: "법정 표기 — 전자상거래법상 필수" },
    { key: "ceoName", label: "대표자명" },
    { key: "businessNo", label: "사업자등록번호" },
    { key: "mailOrderNo", label: "통신판매업 신고번호" },
    { key: "address", label: "사업장 주소" },
    { key: "privacyOfficer", label: "개인정보 보호책임자" },
    { key: "hostingProvider", label: "호스팅 제공자" },
    { key: "csPhone", label: "고객센터 전화" },
    { key: "csEmail", label: "고객센터 이메일" },
    { key: "brandTagline", label: "브랜드 문구" },
    { key: "copyrightNotice", label: "저작권 표기" },
  ]

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">사이트·사업자 정보</h2>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        전 화면 푸터의 법정 표기와 고객센터 안내에 쓰입니다. 업체가 바뀌면 여기만 고칩니다.
      </p>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (saveMutation.isPending) return
          const { csHoursText, ...rest } = form
          saveMutation.mutate(
            {
              ...rest,
              csEmail: rest.csEmail || undefined,
              csHours: csHoursText
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            },
            handlers,
          )
        }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`business-${field.key}`}>{field.label}</Label>
              <Input
                id={`business-${field.key}`}
                size="admin"
                value={String(form[field.key] ?? "")}
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
              />
              {field.hint ? (
                <p className="m-0 text-[12px] text-muted-foreground">{field.hint}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="business-cshours">고객센터 운영시간</Label>
          <Textarea
            id="business-cshours"
            size="compact"
            placeholder={"평일 10:00–17:00\n점심 12:30–13:30 · 주말·공휴일 휴무"}
            value={form.csHoursText}
            onChange={(event) => setForm({ ...form, csHoursText: event.target.value })}
          />
          <p className="m-0 text-[12px] text-muted-foreground">한 줄에 하나씩 입력합니다.</p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="admin-40"
          className="self-start"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </form>
    </section>
  )
}

function PolicyTextForm({
  initial,
}: {
  initial: { shippingNotice: string; returnNotice: string; exchangeNotice: string }
}) {
  const trpc = useTRPC()
  const saveMutation = useMutation(trpc.adminSetting.savePolicyText.mutationOptions())
  const handlers = useSettingSave("정책 문구")
  const [form, setForm] = React.useState(initial)

  const fields: { key: keyof typeof initial; label: string }[] = [
    { key: "shippingNotice", label: "배송 안내" },
    { key: "returnNotice", label: "반품 안내" },
    { key: "exchangeNotice", label: "교환 안내" },
  ]

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">정책 문구</h2>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        상품 상세·주문·푸터에 노출되는 안내입니다.
      </p>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (saveMutation.isPending) return
          saveMutation.mutate(form, handlers)
        }}
      >
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`policy-${field.key}`}>{field.label}</Label>
            <Textarea
              id={`policy-${field.key}`}
              size="compact"
              value={form[field.key]}
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            />
          </div>
        ))}

        <Button
          type="submit"
          variant="primary"
          size="admin-40"
          className="self-start"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </form>
    </section>
  )
}

function ShippingPolicyForm({
  initial,
}: {
  initial: { baseFee: number; freeThreshold: number; remoteSurcharge: number }
}) {
  const trpc = useTRPC()
  const saveMutation = useMutation(trpc.adminSetting.saveShippingPolicy.mutationOptions())
  const handlers = useSettingSave("배송비 정책")
  const [form, setForm] = React.useState(initial)

  const toNumber = (value: string) => Number(value.replace(/[^0-9]/g, "")) || 0

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">배송비 정책</h2>
      {/* 이 값이 어디까지 영향을 주는지 밝힌다 — 바꾸면 클레임 배송비도 함께 바뀐다 */}
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        주문서 배송비와 <b className="text-foreground">반품·교환 배송비</b>가 이 값에서 계산됩니다.
      </p>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (saveMutation.isPending) return
          saveMutation.mutate(form, handlers)
        }}
      >
        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
            <Label htmlFor="shipping-base">기본 배송비 (원)</Label>
            <Input
              id="shipping-base"
              size="admin"
              inputMode="numeric"
              value={form.baseFee}
              onChange={(event) => setForm({ ...form, baseFee: toNumber(event.target.value) })}
            />
          </div>
          <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
            <Label htmlFor="shipping-free">무료배송 기준 (원)</Label>
            <Input
              id="shipping-free"
              size="admin"
              inputMode="numeric"
              value={form.freeThreshold}
              onChange={(event) =>
                setForm({ ...form, freeThreshold: toNumber(event.target.value) })
              }
            />
            <p className="m-0 text-[12px] text-muted-foreground">0이면 항상 무료배송입니다.</p>
          </div>
        </div>

        <div className="flex max-w-[320px] flex-col gap-1.5">
          <Label htmlFor="shipping-remote">도서·산간 추가배송비 (원)</Label>
          <Input
            id="shipping-remote"
            size="admin"
            inputMode="numeric"
            value={form.remoteSurcharge}
            onChange={(event) =>
              setForm({ ...form, remoteSurcharge: toNumber(event.target.value) })
            }
          />
          <p className="m-0 text-[12px] text-muted-foreground">
            제주·울릉도 등 도서 지역 우편번호에 자동으로 더해집니다.{" "}
            <b className="text-foreground">무료배송이어도 이 금액은 붙습니다</b> — 택배사가
            실제로 청구하기 때문입니다. 0이면 추가하지 않습니다.
          </p>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="admin-40"
          className="self-start"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </form>
    </section>
  )
}

function AnalyticsForm({
  initial,
}: {
  initial: { ga4MeasurementId: string; naverWcsId: string }
}) {
  const trpc = useTRPC()
  const saveMutation = useMutation(trpc.adminSetting.saveAnalytics.mutationOptions())
  const handlers = useSettingSave("측정 ID")
  const [form, setForm] = React.useState(initial)

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">측정 ID</h2>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        브라우저에 그대로 실리는 공개 값이라 여기서 관리합니다. 시크릿 키는 서버가 소유합니다.
      </p>

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (saveMutation.isPending) return
          saveMutation.mutate(form, handlers)
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="analytics-ga4">GA4 측정 ID</Label>
          <Input
            id="analytics-ga4"
            size="admin"
            placeholder="G-XXXXXXXXXX"
            value={form.ga4MeasurementId}
            onChange={(event) => setForm({ ...form, ga4MeasurementId: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="analytics-naver">네이버 전환 ID</Label>
          <Input
            id="analytics-naver"
            size="admin"
            value={form.naverWcsId}
            onChange={(event) => setForm({ ...form, naverWcsId: event.target.value })}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="admin-40"
          className="self-start"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </form>
    </section>
  )
}

/**
 * 테마 색상 — 프리셋 이름만 고른다.
 *
 * 색상값을 직접 고르게 하지 않는 이유(RULE-11): 색을 자유롭게 넣으면 대비·명도 조합이 깨져
 * 접근성이 무너지고, 새 컴포넌트가 나올 때마다 색 목록을 늘려야 한다.
 * 프리셋은 globals.css에서 대비까지 맞춰 정의돼 있다.
 */
function ThemeForm({
  initial,
}: {
  initial: { storefront: ThemePreset; admin: ThemePreset }
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const saveMutation = useMutation(trpc.adminSetting.saveTheme.mutationOptions())
  const handlers = useSettingSave("테마 색상")
  const [form, setForm] = React.useState(initial)

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <h2 className="m-0 font-heading text-[15px] font-extrabold">테마 색상</h2>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        스토어 화면과 관리자 화면의 색을 각각 고릅니다. 관리자는 오래 보는 업무 화면이라
        브랜드 색과 다르게 두셔도 됩니다.
      </p>

      <form
        className="mt-3 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (saveMutation.isPending) return
          saveMutation.mutate(form, {
            ...handlers,
            onSuccess: () => {
              handlers.onSuccess?.()
              // 레이아웃이 서버에서 data-theme을 그리므로 새로고침해야 색이 바뀐다
              router.refresh()
            },
          })
        }}
      >
        {(
          [
            { field: "storefront" as const, label: "스토어 화면" },
            { field: "admin" as const, label: "관리자 화면" },
          ]
        ).map((target) => (
          <fieldset key={target.field} className="m-0 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-bold">{target.label}</legend>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESET_ORDER.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="toggle"
                  size="admin-40"
                  aria-pressed={form[target.field] === preset}
                  onClick={() => setForm({ ...form, [target.field]: preset })}
                >
                  {/* 색 견본 + 이름 — 이름만 있으면 어떤 색인지 모르고,
                      견본만 있으면 색을 구분 못 하는 이용자가 고를 수 없다(KWCAG) */}
                  <span
                    aria-hidden="true"
                    data-theme={preset}
                    className="mr-1.5 inline-block size-3.5 rounded-full border border-border bg-primary align-middle"
                  />
                  {THEME_PRESET_LABEL[preset]}
                </Button>
              ))}
            </div>
          </fieldset>
        ))}

        <Button
          type="submit"
          variant="primary"
          size="admin-40"
          className="self-start"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </form>
    </section>
  )
}
