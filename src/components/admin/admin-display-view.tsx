"use client"

// 핸드오프 규격: 관리자 배너진열.dc.html — 배너 탭(히어로·띠배너) / 진열 섹션 탭.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **드래그 대신 ↑↓ 버튼**(카테고리와 같은 이유 — 드래그는 키보드로 조작할 수 없다).
//  - 띠배너 색을 **토큰명으로 고른다.** 색상값을 저장하면 리스킨 때 따라오지 않는다(RULE-11).
//  - 카드에 **'지금 노출 중'을 따로 표시**한다. 활성이어도 기간 밖이면 안 보이는데,
//    활성 토글만 보면 왜 스토어에 없는지 알 수 없다.
//  - 자동 유형(신상품·베스트) 섹션에서는 상품 선택 UI를 숨긴다 — 골라둬도 쓰이지 않는다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type DisplayTab = "banner" | "section"

const TONE_CHOICES = [
  { code: "primary", label: "브랜드" },
  { code: "accent", label: "포인트" },
  { code: "foreground", label: "먹색" },
] as const

const SECTION_KINDS = [
  { kind: "manual", label: "수동 큐레이션", hint: "상품을 직접 고릅니다" },
  { kind: "new", label: "신상품", hint: "등록일 기준 자동" },
  { kind: "best", label: "베스트", hint: "판매량 기준 자동" },
] as const

type BannerDraft = {
  bannerId: number | null
  slot: "hero" | "strip"
  title: string
  kicker: string
  subtitle: string
  ctaLabel: string
  imagePath: string | null
  alt: string
  toneCode: "primary" | "accent" | "foreground" | null
  linkUrl: string
  isActive: boolean
  startsAt: string
  endsAt: string
}

function emptyBanner(slot: "hero" | "strip"): BannerDraft {
  return {
    bannerId: null,
    slot,
    title: "",
    kicker: "",
    subtitle: "",
    ctaLabel: "",
    imagePath: null,
    alt: "",
    toneCode: slot === "strip" ? "primary" : null,
    linkUrl: "",
    isActive: true,
    startsAt: "",
    endsAt: "",
  }
}

/** date input(YYYY-MM-DD) ↔ Date. 비우면 무제한 */
function toDateInput(value: Date | null): string {
  if (!value) return ""
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function AdminDisplayView() {
  const [activeTab, setActiveTab] = React.useState<DisplayTab>("banner")

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="관리 대상 선택" className="flex flex-wrap gap-2">
        {(
          [
            { tab: "banner", label: "배너" },
            { tab: "section", label: "진열 섹션" },
          ] as const
        ).map((tabItem) => (
          <Button
            key={tabItem.tab}
            type="button"
            variant="toggle"
            size="admin-40"
            aria-pressed={activeTab === tabItem.tab}
            onClick={() => setActiveTab(tabItem.tab)}
          >
            {tabItem.label}
          </Button>
        ))}
      </div>

      {activeTab === "banner" ? <BannerPanel /> : <SectionPanel />}
    </div>
  )
}

// =============================================================
// 배너
// =============================================================

function BannerPanel() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const listQuery = useQuery(trpc.adminDisplay.listBanners.queryOptions())
  const saveMutation = useMutation(trpc.adminDisplay.saveBanner.mutationOptions())
  const moveMutation = useMutation(trpc.adminDisplay.moveBanner.mutationOptions())
  const deleteMutation = useMutation(trpc.adminDisplay.deleteBanner.mutationOptions())

  const [draft, setDraft] = React.useState<BannerDraft | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)

  function refreshBanners() {
    void queryClient.invalidateQueries(trpc.adminDisplay.pathFilter())
  }

  async function uploadHeroImage(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !draft || isUploading) return
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("files", fileList[0])
      formData.append("folder", "banners")
      const response = await fetch("/api/admin/product-images", { method: "POST", body: formData })
      const payload = (await response.json()) as { storedPaths?: string[]; message?: string }
      if (!response.ok) {
        showToast(payload.message ?? "이미지를 올리지 못했습니다.", { toastVariant: "error" })
        return
      }
      setDraft({ ...draft, imagePath: payload.storedPaths?.[0] ?? null })
    } catch {
      showToast("이미지를 올리지 못했습니다.", { toastVariant: "error" })
    } finally {
      setIsUploading(false)
    }
  }

  function submitBanner(event: React.FormEvent) {
    event.preventDefault()
    if (!draft || saveMutation.isPending) return
    if (draft.imagePath && !draft.alt.trim()) {
      showToast("이미지를 올렸으면 대체 텍스트를 입력해 주세요.", { toastVariant: "error" })
      return
    }
    saveMutation.mutate(
      {
        bannerId: draft.bannerId,
        slot: draft.slot,
        title: draft.title.trim() || null,
        kicker: draft.kicker.trim() || null,
        subtitle: draft.subtitle.trim() || null,
        ctaLabel: draft.ctaLabel.trim() || null,
        imagePath: draft.imagePath,
        alt: draft.alt.trim() || null,
        toneCode: draft.slot === "strip" ? draft.toneCode : null,
        linkUrl: draft.linkUrl.trim() || null,
        isActive: draft.isActive,
        startsAt: draft.startsAt ? new Date(`${draft.startsAt}T00:00:00`) : null,
        endsAt: draft.endsAt ? new Date(`${draft.endsAt}T23:59:59`) : null,
      },
      {
        onSuccess: () => {
          showToast("배너를 저장했어요.", { toastVariant: "info" })
          setDraft(null)
          refreshBanners()
        },
        onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
      },
    )
  }

  if (draft) {
    const isHero = draft.slot === "hero"
    return (
      <section className="rounded-[var(--radius)] border border-primary bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">
          {isHero ? "히어로 배너" : "띠배너"} {draft.bannerId === null ? "추가" : "수정"}
        </h2>

        <form className="mt-3 flex flex-col gap-3" onSubmit={submitBanner}>
          {isHero ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="banner-kicker">윗줄 문구</Label>
                <Input
                  id="banner-kicker"
                  size="admin"
                  value={draft.kicker}
                  onChange={(event) => setDraft({ ...draft, kicker: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="banner-title">제목</Label>
                <Input
                  id="banner-title"
                  size="admin"
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="banner-subtitle">부제</Label>
                <Input
                  id="banner-subtitle"
                  size="admin"
                  value={draft.subtitle}
                  onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="banner-cta">버튼 문구</Label>
                <Input
                  id="banner-cta"
                  size="admin"
                  value={draft.ctaLabel}
                  onChange={(event) => setDraft({ ...draft, ctaLabel: event.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="banner-image">이미지</Label>
                {draft.imagePath ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/uploads/${draft.imagePath}`}
                      alt=""
                      className="h-14 w-24 rounded-[calc(var(--radius)-6px)] border border-border object-cover"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="admin-38"
                      onClick={() => setDraft({ ...draft, imagePath: null })}
                    >
                      이미지 제거
                    </Button>
                  </div>
                ) : null}
                <input
                  id="banner-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  disabled={isUploading}
                  className="text-[13px] file:mr-2 file:min-h-9 file:rounded-[calc(var(--radius)-4px)] file:border file:border-border file:bg-card file:px-3 file:text-[13px] file:font-bold"
                  onChange={(event) => {
                    void uploadHeroImage(event.target.files)
                    event.target.value = ""
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="banner-alt">대체 텍스트 {draft.imagePath ? "*" : ""}</Label>
                <Input
                  id="banner-alt"
                  size="admin"
                  required={draft.imagePath !== null}
                  placeholder="이미지가 어떤 내용인지 설명"
                  value={draft.alt}
                  onChange={(event) => setDraft({ ...draft, alt: event.target.value })}
                />
                <p className="m-0 text-[12px] text-muted-foreground">
                  이미지를 올렸으면 필수입니다 — 화면을 못 보는 이용자에게 유일한 설명입니다.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="strip-title">띠배너 문구 *</Label>
                <Input
                  id="strip-title"
                  size="admin"
                  required
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </div>
              <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1 text-[13px] font-bold">배경 톤</legend>
                <div className="flex flex-wrap gap-2">
                  {TONE_CHOICES.map((tone) => (
                    <Button
                      key={tone.code}
                      type="button"
                      variant="toggle"
                      size="admin-38"
                      aria-pressed={draft.toneCode === tone.code}
                      onClick={() => setDraft({ ...draft, toneCode: tone.code })}
                    >
                      {tone.label}
                    </Button>
                  ))}
                </div>
                <p className="m-0 text-[12px] text-muted-foreground">
                  색상값이 아니라 테마 토큰을 저장합니다 — 테마를 바꾸면 배너도 함께 따라옵니다.
                </p>
              </fieldset>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="banner-link">링크</Label>
            <Input
              id="banner-link"
              size="admin"
              placeholder="/products 또는 https://..."
              value={draft.linkUrl}
              onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="banner-starts">노출 시작</Label>
              <Input
                id="banner-starts"
                size="admin"
                type="date"
                value={draft.startsAt}
                onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="banner-ends">노출 종료</Label>
              <Input
                id="banner-ends"
                size="admin"
                type="date"
                value={draft.endsAt}
                onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
              />
            </div>
          </div>
          <p className="m-0 text-[12px] text-muted-foreground">
            비워 두면 기간 제한 없이 노출됩니다.
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              aria-label="활성"
              checked={draft.isActive}
              onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked === true })}
            />
            활성
          </label>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="admin-40" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button type="button" variant="outline" size="admin-40" onClick={() => setDraft(null)}>
              취소
            </Button>
          </div>
        </form>
      </section>
    )
  }

  if (listQuery.isPending) {
    return (
      <div className="flex min-h-32 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">배너를 불러오는 중입니다</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {(["hero", "strip"] as const).map((slot) => {
        const banners = listQuery.data?.[slot] ?? []
        return (
          <section key={slot} className="rounded-[var(--radius)] border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 font-heading text-[15px] font-extrabold">
                  {slot === "hero" ? "히어로 배너" : "띠배너"}
                </h2>
                <p className="m-0 text-[12px] text-muted-foreground">
                  {slot === "hero"
                    ? "메인 상단 슬라이드 · 기간별 자동 노출"
                    : "헤더 하단 가로 띠 · 문구와 배경 톤만"}
                </p>
              </div>
              <Button
                type="button"
                variant={slot === "hero" ? "primary" : "outline"}
                size="admin-38"
                onClick={() => setDraft(emptyBanner(slot))}
              >
                + {slot === "hero" ? "히어로" : "띠배너"} 추가
              </Button>
            </div>

            {banners.length === 0 ? (
              <p className="m-0 mt-3 text-[13px] text-muted-foreground">
                등록된 배너가 없어요.
              </p>
            ) : (
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {banners.map((bannerCard, bannerIndex) => (
                  <li
                    key={bannerCard.bannerId}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)-4px)] border border-border p-3",
                      !bannerCard.isLiveNow && "opacity-70",
                    )}
                  >
                    {bannerCard.imagePath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/uploads/${bannerCard.imagePath}`}
                        alt=""
                        className="h-10 w-16 shrink-0 rounded-[6px] border border-border object-cover"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1 text-[13px]">
                      <b className="font-semibold">{bannerCard.title ?? "(제목 없음)"}</b>
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {[
                          bannerCard.kicker,
                          bannerCard.linkUrl,
                          bannerCard.startsAt || bannerCard.endsAt
                            ? `${toDateInput(bannerCard.startsAt) || "제한없음"} ~ ${toDateInput(bannerCard.endsAt) || "제한없음"}`
                            : "기간 제한 없음",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>

                    {/* 활성이어도 기간 밖이면 안 보인다 — 그 차이를 문구로 밝힌다 */}
                    <span
                      className={cn(
                        "shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                        bannerCard.isLiveNow
                          ? "border-primary text-primary"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      {bannerCard.isLiveNow
                        ? "노출 중"
                        : bannerCard.isActive
                          ? "기간 밖"
                          : "비활성"}
                    </span>

                    <Button
                      type="button"
                      variant="ghost"
                      size="admin-38"
                      aria-label={`${bannerCard.title ?? "배너"} 위로`}
                      disabled={bannerIndex === 0}
                      onClick={() =>
                        moveMutation.mutate(
                          { bannerId: bannerCard.bannerId, direction: "up" },
                          { onSuccess: refreshBanners },
                        )
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="admin-38"
                      aria-label={`${bannerCard.title ?? "배너"} 아래로`}
                      disabled={bannerIndex === banners.length - 1}
                      onClick={() =>
                        moveMutation.mutate(
                          { bannerId: bannerCard.bannerId, direction: "down" },
                          { onSuccess: refreshBanners },
                        )
                      }
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="admin-38"
                      onClick={() =>
                        setDraft({
                          bannerId: bannerCard.bannerId,
                          slot,
                          title: bannerCard.title ?? "",
                          kicker: bannerCard.kicker ?? "",
                          subtitle: bannerCard.subtitle ?? "",
                          ctaLabel: bannerCard.ctaLabel ?? "",
                          imagePath: bannerCard.imagePath,
                          alt: bannerCard.alt ?? "",
                          toneCode:
                            (bannerCard.toneCode as BannerDraft["toneCode"]) ??
                            (slot === "strip" ? "primary" : null),
                          linkUrl: bannerCard.linkUrl ?? "",
                          isActive: bannerCard.isActive,
                          startsAt: toDateInput(bannerCard.startsAt),
                          endsAt: toDateInput(bannerCard.endsAt),
                        })
                      }
                    >
                      수정
                    </Button>
                    <Button
                      type="button"
                      variant="destructive-outline"
                      size="admin-38"
                      onClick={() =>
                        deleteMutation.mutate(
                          { bannerId: bannerCard.bannerId },
                          {
                            onSuccess: () => {
                              showToast("배너를 삭제했어요.", { toastVariant: "info" })
                              refreshBanners()
                            },
                            onError: (deleteError) =>
                              showToast(deleteError.message, { toastVariant: "error" }),
                          },
                        )
                      }
                    >
                      삭제
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

// =============================================================
// 진열 섹션
// =============================================================

type SectionDraft = {
  sectionId: number | null
  kicker: string
  title: string
  kind: "manual" | "new" | "best"
  isActive: boolean
  productIds: number[]
}

function SectionPanel() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const listQuery = useQuery(trpc.adminDisplay.listSections.queryOptions())
  const saveMutation = useMutation(trpc.adminDisplay.saveSection.mutationOptions())
  const moveMutation = useMutation(trpc.adminDisplay.moveSection.mutationOptions())
  const deleteMutation = useMutation(trpc.adminDisplay.deleteSection.mutationOptions())

  const [draft, setDraft] = React.useState<SectionDraft | null>(null)
  const [productKeyword, setProductKeyword] = React.useState("")

  const productsQuery = useQuery({
    ...trpc.adminDisplay.searchProducts.queryOptions({ keyword: productKeyword || undefined }),
    enabled: draft?.kind === "manual",
  })

  function refreshSections() {
    void queryClient.invalidateQueries(trpc.adminDisplay.pathFilter())
  }

  if (draft) {
    return (
      <section className="rounded-[var(--radius)] border border-primary bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">
          진열 섹션 {draft.sectionId === null ? "추가" : "수정"}
        </h2>

        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (saveMutation.isPending) return
            saveMutation.mutate(
              {
                sectionId: draft.sectionId,
                kicker: draft.kicker.trim() || null,
                title: draft.title.trim(),
                kind: draft.kind,
                isActive: draft.isActive,
                productIds: draft.kind === "manual" ? draft.productIds : [],
              },
              {
                onSuccess: () => {
                  showToast("진열 섹션을 저장했어요.", { toastVariant: "info" })
                  setDraft(null)
                  refreshSections()
                },
                onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
              },
            )
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-kicker">윗줄 문구</Label>
            <Input
              id="section-kicker"
              size="admin"
              placeholder="CURATED"
              value={draft.kicker}
              onChange={(event) => setDraft({ ...draft, kicker: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="section-title">섹션 제목 *</Label>
            <Input
              id="section-title"
              size="admin"
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>

          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1 text-[13px] font-bold">유형</legend>
            <div className="flex flex-wrap gap-2">
              {SECTION_KINDS.map((kindOption) => (
                <Button
                  key={kindOption.kind}
                  type="button"
                  variant="toggle"
                  size="admin-38"
                  aria-pressed={draft.kind === kindOption.kind}
                  onClick={() => setDraft({ ...draft, kind: kindOption.kind })}
                >
                  {kindOption.label}
                </Button>
              ))}
            </div>
            <p className="m-0 text-[12px] text-muted-foreground">
              {SECTION_KINDS.find((kindOption) => kindOption.kind === draft.kind)?.hint}
            </p>
          </fieldset>

          {/* 자동 유형에는 상품 선택을 보여주지 않는다 — 골라둬도 쓰이지 않는다 */}
          {draft.kind === "manual" ? (
            <div className="flex flex-col gap-2 rounded-[calc(var(--radius)-4px)] bg-muted p-3">
              <p className="m-0 text-[13px] font-bold">
                노출 상품 {draft.productIds.length}개
              </p>
              <Label htmlFor="section-product-search" className="sr-only">
                상품 검색
              </Label>
              <Input
                id="section-product-search"
                size="admin"
                type="search"
                placeholder="상품명으로 검색"
                value={productKeyword}
                onChange={(event) => setProductKeyword(event.target.value)}
              />
              <ul className="m-0 flex max-h-[220px] list-none flex-col gap-1 overflow-y-auto p-0">
                {productsQuery.data?.map((productOption) => {
                  const selectedIndex = draft.productIds.indexOf(productOption.productId)
                  return (
                    <li key={productOption.productId}>
                      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                        <Checkbox
                          aria-label={`${productOption.name} 노출`}
                          checked={selectedIndex >= 0}
                          onCheckedChange={(checked) =>
                            setDraft({
                              ...draft,
                              productIds:
                                checked === true
                                  ? [...draft.productIds, productOption.productId]
                                  : draft.productIds.filter((id) => id !== productOption.productId),
                            })
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{productOption.name}</span>
                        {selectedIndex >= 0 ? (
                          <span className="shrink-0 text-[12px] font-bold text-primary">
                            {selectedIndex + 1}번째
                          </span>
                        ) : null}
                      </label>
                    </li>
                  )
                })}
              </ul>
              <p className="m-0 text-[12px] text-muted-foreground">
                체크한 순서대로 메인에 노출됩니다.
              </p>
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              aria-label="메인에 노출"
              checked={draft.isActive}
              onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked === true })}
            />
            메인에 노출
          </label>

          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="admin-40" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button type="button" variant="outline" size="admin-40" onClick={() => setDraft(null)}>
              취소
            </Button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 font-heading text-[15px] font-extrabold">메인 진열 섹션</h2>
          <p className="m-0 text-[12px] text-muted-foreground">
            ↑↓ 버튼으로 메인 노출 순서를 바꿉니다.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="admin-38"
          onClick={() =>
            setDraft({
              sectionId: null,
              kicker: "",
              title: "",
              kind: "manual",
              isActive: true,
              productIds: [],
            })
          }
        >
          + 진열 섹션 추가
        </Button>
      </div>

      {listQuery.isPending ? (
        <div className="flex min-h-32 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">진열 섹션을 불러오는 중입니다</span>
        </div>
      ) : (listQuery.data?.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={3}
          icon={<span aria-hidden="true">🗂️</span>}
          title="진열 섹션이 없어요"
          description="메인에 보여줄 섹션을 추가해 보세요."
        />
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {listQuery.data?.map((section, sectionIndex) => (
            <li
              key={section.sectionId}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-[calc(var(--radius)-4px)] border border-border p-3",
                !section.isActive && "opacity-60",
              )}
            >
              <span className="min-w-0 flex-1 text-[13px]">
                <b className="font-semibold">{section.title}</b>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {[
                    section.kicker,
                    section.kindLabel,
                    section.kind === "manual" ? `상품 ${section.products.length}개` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold",
                  section.isActive ? "border-primary text-primary" : "border-border text-muted-foreground",
                )}
              >
                {section.isActive ? "노출" : "숨김"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="admin-38"
                aria-label={`${section.title} 위로`}
                disabled={sectionIndex === 0}
                onClick={() =>
                  moveMutation.mutate(
                    { sectionId: section.sectionId, direction: "up" },
                    { onSuccess: refreshSections },
                  )
                }
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="admin-38"
                aria-label={`${section.title} 아래로`}
                disabled={sectionIndex === (listQuery.data?.length ?? 0) - 1}
                onClick={() =>
                  moveMutation.mutate(
                    { sectionId: section.sectionId, direction: "down" },
                    { onSuccess: refreshSections },
                  )
                }
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                onClick={() =>
                  setDraft({
                    sectionId: section.sectionId,
                    kicker: section.kicker ?? "",
                    title: section.title,
                    kind: section.kind,
                    isActive: section.isActive,
                    productIds: section.products.map((productRow) => productRow.productId),
                  })
                }
              >
                수정
              </Button>
              <Button
                type="button"
                variant="destructive-outline"
                size="admin-38"
                onClick={() =>
                  deleteMutation.mutate(
                    { sectionId: section.sectionId },
                    {
                      onSuccess: () => {
                        showToast("진열 섹션을 삭제했어요.", { toastVariant: "info" })
                        refreshSections()
                      },
                      onError: (deleteError) =>
                        showToast(deleteError.message, { toastVariant: "error" }),
                    },
                  )
                }
              >
                삭제
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
