"use client"

// 핸드오프 규격: 관리자 상품등록.dc.html — 기본정보 · 옵션/variant 매트릭스 · 추가상품 ·
// 이미지(대표·상세) · 상세설명. 탭 순서는 목업 주석(3 상품명 → … → 13 상세설명)을 따른다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **URL 주소(slug) 입력칸을 더했다.** 목업에 없는데 DB가 NOT NULL + 영문 소문자만 허용하고,
//    이게 스토어 주소(/products/{slug})다. 상품명이 한글이라 자동 생성이 불가능해 없으면
//    저장 자체가 안 된다.
//  - 상세설명은 일반 textarea다. WYSIWYG 에디터는 별도 범위이고, 서식 HTML을 그대로 저장하면
//    XSS 정화 설계가 먼저 필요하다.
//  - 재고를 여기서 고치면 조정 건수를 알려준다 — 조용히 숫자만 바뀌지 않게.

import * as React from "react"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "@/server/trpc/routers/_app"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { useTRPC } from "@/trpc/client"

/** 서버 저장 키와 같은 구분자 — 조합을 문자열 하나로 다룰 때 쓴다 */
const LABEL_SEPARATOR = ""

type OptionGroup = { name: string; values: string[] }
type VariantRow = {
  optionLabels: string[]
  price: number
  compareAtPrice: number | null
  stock: number
  sku: string | null
  isActive: boolean
}
type AddonRow = { addonId: number | null; name: string; price: number; isActive: boolean }
type ImageRow = { imageKind: "thumbnail" | "detail"; path: string; alt: string }

const PRODUCT_STATUS_CHOICES: { productStatus: "active" | "hidden" | "draft"; label: string }[] = [
  { productStatus: "active", label: "판매중" },
  { productStatus: "hidden", label: "숨김" },
  { productStatus: "draft", label: "작성중" },
]

/** 옵션 그룹들의 전 조합 — 값이 하나도 없는 그룹은 무시한다(목업과 같은 규칙) */
function buildCombinations(optionGroups: OptionGroup[]): string[][] {
  const filled = optionGroups.filter((optionGroup) => optionGroup.values.length > 0)
  if (filled.length === 0) return []
  let combinations: string[][] = [[]]
  for (const optionGroup of filled) {
    const next: string[][] = []
    for (const partial of combinations) {
      for (const value of optionGroup.values) next.push([...partial, value])
    }
    combinations = next
  }
  return combinations
}

/** 라우터 계약에서 뽑는다 — 서버 타입이 바뀌면 여기서 컴파일이 깨져 알려준다 */
type LoadedProductForm = inferRouterOutputs<AppRouter>["adminProduct"]["form"]

/**
 * 조회와 편집을 나눈다 — 편집 폼은 **데이터가 온 뒤에만 마운트**된다.
 *
 * 한 컴포넌트로 두면 "빈 상태로 그렸다가 effect로 서버 값을 밀어넣는" 모양이 되고,
 * 그 setState가 연쇄 렌더를 만든다. 마운트를 늦추면 useState 초기값이 곧 서버 값이라
 * effect가 통째로 사라진다.
 */
export function AdminProductFormView({ productId }: { productId: number | null }) {
  const trpc = useTRPC()
  const formQuery = useQuery(trpc.adminProduct.form.queryOptions({ productId }))

  if (formQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">상품 정보를 불러오는 중입니다</span>
      </div>
    )
  }

  if (formQuery.isError || !formQuery.data) {
    return (
      <div className="py-12 text-center">
        <p role="alert" className="m-0 text-sm text-muted-foreground">
          {formQuery.error?.message ?? "상품 정보를 불러오지 못했습니다."}
        </p>
        <Button variant="outline" size="admin-40" className="mt-4" asChild>
          <Link href="/admin/products">상품 목록으로</Link>
        </Button>
      </div>
    )
  }

  return <ProductFormFields productId={productId} loadedForm={formQuery.data} />
}

function ProductFormFields({
  productId,
  loadedForm,
}: {
  productId: number | null
  loadedForm: LoadedProductForm
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const saveMutation = useMutation(trpc.adminProduct.save.mutationOptions())

  const initialForm = loadedForm.form
  const initialSingleVariant = initialForm.variants.find(
    (variantEntry) => variantEntry.optionLabels.length === 0,
  )
  const initialVariantByKey: Record<string, VariantRow> = {}
  for (const variantEntry of initialForm.variants) {
    if (variantEntry.optionLabels.length > 0) {
      initialVariantByKey[variantEntry.optionLabels.join(LABEL_SEPARATOR)] = variantEntry
    }
  }

  const [name, setName] = React.useState(initialForm.name)
  const [slug, setSlug] = React.useState(initialForm.slug)
  const [summary, setSummary] = React.useState(initialForm.summary ?? "")
  const [description, setDescription] = React.useState(initialForm.description ?? "")
  const [productStatus, setProductStatus] = React.useState<"active" | "hidden" | "draft">(
    initialForm.productStatus,
  )
  const [makerId, setMakerId] = React.useState<number | null>(initialForm.makerId)
  const [categoryIds, setCategoryIds] = React.useState<number[]>(initialForm.categoryIds)
  const [useOptions, setUseOptions] = React.useState(initialForm.options.length > 0)
  const [optionGroups, setOptionGroups] = React.useState<OptionGroup[]>(initialForm.options)
  const [valueDrafts, setValueDrafts] = React.useState<string[]>(initialForm.options.map(() => ""))
  const [variantByKey, setVariantByKey] =
    React.useState<Record<string, VariantRow>>(initialVariantByKey)
  const [singleVariant, setSingleVariant] = React.useState<VariantRow>(
    initialSingleVariant ?? {
      optionLabels: [],
      price: 0,
      compareAtPrice: null,
      stock: 0,
      sku: null,
      isActive: true,
    },
  )
  const [addons, setAddons] = React.useState<AddonRow[]>(initialForm.addons)
  const [images, setImages] = React.useState<ImageRow[]>(initialForm.images)
  const [bulkStock, setBulkStock] = React.useState("")
  const [isUploading, setIsUploading] = React.useState(false)

  const combinations = React.useMemo(
    () => (useOptions ? buildCombinations(optionGroups) : []),
    [useOptions, optionGroups],
  )

  /** 조합별 입력값 — 없으면 기본값. 옵션을 바꿔도 기존 입력이 키로 살아남는다 */
  function variantOf(optionLabels: string[]): VariantRow {
    const key = optionLabels.join(LABEL_SEPARATOR)
    return (
      variantByKey[key] ?? {
        optionLabels,
        price: singleVariant.price,
        compareAtPrice: null,
        stock: 0,
        sku: null,
        isActive: true,
      }
    )
  }

  function patchVariant(optionLabels: string[], patch: Partial<VariantRow>) {
    const key = optionLabels.join(LABEL_SEPARATOR)
    setVariantByKey((previous) => ({
      ...previous,
      [key]: { ...variantOf(optionLabels), ...patch, optionLabels },
    }))
  }

  async function uploadImages(fileList: FileList | null, imageKind: "thumbnail" | "detail") {
    if (!fileList || fileList.length === 0 || isUploading) return
    setIsUploading(true)
    try {
      const formData = new FormData()
      for (const file of Array.from(fileList)) formData.append("files", file)
      const response = await fetch("/api/admin/product-images", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as { storedPaths?: string[]; message?: string }
      if (!response.ok) {
        showToast(payload.message ?? "이미지를 올리지 못했습니다.", { toastVariant: "error" })
        return
      }
      setImages((previous) => [
        ...previous,
        // alt는 비워 둔다 — 저장 시 필수라 관리자가 반드시 채우게 된다(접근성)
        ...(payload.storedPaths ?? []).map((path) => ({ imageKind, path, alt: "" })),
      ])
    } catch {
      showToast("이미지를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.", { toastVariant: "error" })
    } finally {
      setIsUploading(false)
    }
  }

  function submitProduct(event: React.FormEvent) {
    event.preventDefault()
    if (saveMutation.isPending) return

    const variants: VariantRow[] = useOptions
      ? combinations.map((optionLabels) => variantOf(optionLabels))
      : [{ ...singleVariant, optionLabels: [] }]

    if (variants.length === 0) {
      showToast("옵션 값을 하나 이상 추가하거나 옵션 사용을 꺼 주세요.", { toastVariant: "error" })
      return
    }
    const missingAlt = images.find((image) => !image.alt.trim())
    if (missingAlt) {
      showToast("이미지 대체 텍스트를 모두 입력해 주세요.", { toastVariant: "error" })
      return
    }

    saveMutation.mutate(
      {
        productId,
        name: name.trim(),
        slug: slug.trim(),
        summary: summary.trim() || null,
        description: description.trim() || null,
        productStatus,
        badgeLabel: null,
        makerId,
        categoryIds,
        options: useOptions
          ? optionGroups.filter((optionGroup) => optionGroup.values.length > 0)
          : [],
        variants: variants.map((variantRow) => ({
          ...variantRow,
          sku: variantRow.sku?.trim() || null,
        })),
        addons: addons
          .filter((addon) => addon.name.trim())
          .map((addon) => ({ ...addon, name: addon.name.trim() })),
        images: images.map((image) => ({ ...image, alt: image.alt.trim() })),
      },
      {
        onSuccess: (result) => {
          const stockNote =
            result.stockAdjustedCount > 0
              ? ` 재고 ${result.stockAdjustedCount}건을 조정했어요.`
              : ""
          showToast(`상품을 저장했어요.${stockNote}`, { toastVariant: "info" })
          void queryClient.invalidateQueries(trpc.adminProduct.pathFilter())
          router.push("/admin/products")
        },
        onError: (saveError) => showToast(saveError.message, { toastVariant: "error" }),
      },
    )
  }

  const thumbnailImages = images.filter((image) => image.imageKind === "thumbnail")
  const detailImages = images.filter((image) => image.imageKind === "detail")

  return (
    <form className="flex flex-col gap-4" onSubmit={submitProduct}>
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">기본 정보</h2>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-name">상품명 *</Label>
            <Input
              id="product-name"
              size="admin"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-slug">URL 주소 *</Label>
            <Input
              id="product-slug"
              size="admin"
              required
              placeholder="oat-cookie-set"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              aria-describedby="product-slug-help"
            />
            <p id="product-slug-help" className="m-0 text-[12px] text-muted-foreground">
              스토어 주소가 됩니다 — /products/{slug || "주소"} · 영문 소문자·숫자·하이픈만
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="product-summary">한 줄 소개</Label>
            <Input
              id="product-summary"
              size="admin"
              maxLength={300}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
              <Label htmlFor="product-maker">공급처</Label>
              <select
                id="product-maker"
                className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
                value={makerId ?? ""}
                onChange={(event) =>
                  setMakerId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">선택 안 함</option>
                {loadedForm.makerOptions.map((makerOption) => (
                  <option key={makerOption.makerId} value={makerOption.makerId}>
                    {makerOption.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="m-0 flex min-w-[200px] flex-1 flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1 text-[13px] font-bold">판매 상태</legend>
              <div className="flex flex-wrap gap-2">
                {PRODUCT_STATUS_CHOICES.map((statusChoice) => (
                  <Button
                    key={statusChoice.productStatus}
                    type="button"
                    variant="toggle"
                    size="admin-38"
                    aria-pressed={productStatus === statusChoice.productStatus}
                    onClick={() => setProductStatus(statusChoice.productStatus)}
                  >
                    {statusChoice.label}
                  </Button>
                ))}
              </div>
            </fieldset>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-bold">카테고리</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {loadedForm.categoryOptions.map((categoryOption) => (
                <label
                  key={categoryOption.categoryId}
                  className="flex cursor-pointer items-center gap-2 text-[13px]"
                >
                  <Checkbox
                    checked={categoryIds.includes(categoryOption.categoryId)}
                    onCheckedChange={(checked) =>
                      setCategoryIds((previous) =>
                        checked === true
                          ? [...previous, categoryOption.categoryId]
                          : previous.filter((id) => id !== categoryOption.categoryId),
                      )
                    }
                  />
                  {categoryOption.parentId ? `└ ${categoryOption.name}` : categoryOption.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">옵션 · 판매 단위</h2>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <Checkbox
              checked={useOptions}
              onCheckedChange={(checked) => {
                setUseOptions(checked === true)
                if (checked === true && optionGroups.length === 0) {
                  setOptionGroups([{ name: "옵션", values: [] }])
                  setValueDrafts([""])
                }
              }}
            />
            옵션 사용
          </label>
        </div>

        {!useOptions ? (
          <div className="mt-3 flex flex-wrap gap-3 rounded-[calc(var(--radius)-4px)] bg-muted p-3.5">
            <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
              <Label htmlFor="single-price">판매가 *</Label>
              <Input
                id="single-price"
                size="admin"
                inputMode="numeric"
                value={singleVariant.price}
                onChange={(event) =>
                  setSingleVariant((previous) => ({
                    ...previous,
                    price: Number(event.target.value.replace(/[^0-9]/g, "")) || 0,
                  }))
                }
              />
            </div>
            <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
              <Label htmlFor="single-compare">정가 (선택)</Label>
              <Input
                id="single-compare"
                size="admin"
                inputMode="numeric"
                value={singleVariant.compareAtPrice ?? ""}
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^0-9]/g, "")
                  setSingleVariant((previous) => ({
                    ...previous,
                    compareAtPrice: digits ? Number(digits) : null,
                  }))
                }}
              />
            </div>
            <div className="flex min-w-[120px] flex-1 flex-col gap-1.5">
              <Label htmlFor="single-stock">재고 *</Label>
              <Input
                id="single-stock"
                size="admin"
                inputMode="numeric"
                value={singleVariant.stock}
                onChange={(event) =>
                  setSingleVariant((previous) => ({
                    ...previous,
                    stock: Number(event.target.value.replace(/[^0-9]/g, "")) || 0,
                  }))
                }
              />
            </div>
            <p className="m-0 w-full text-[12px] text-muted-foreground">
              옵션 없는 단일 상품입니다. 스토어에는 옵션 선택 UI가 표시되지 않습니다.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {optionGroups.map((optionGroup, groupIndex) => (
              <div
                key={groupIndex}
                className="flex flex-col gap-2 rounded-[calc(var(--radius)-4px)] border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <Label htmlFor={`option-name-${groupIndex}`} className="sr-only">
                    옵션명
                  </Label>
                  <Input
                    id={`option-name-${groupIndex}`}
                    size="admin"
                    className="max-w-[200px]"
                    placeholder="옵션명 (예: 구성)"
                    value={optionGroup.name}
                    onChange={(event) =>
                      setOptionGroups((previous) =>
                        previous.map((entry, index) =>
                          index === groupIndex ? { ...entry, name: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="admin-38"
                    className="ml-auto"
                    onClick={() => {
                      setOptionGroups((previous) => previous.filter((_, i) => i !== groupIndex))
                      setValueDrafts((previous) => previous.filter((_, i) => i !== groupIndex))
                    }}
                  >
                    옵션 삭제
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {optionGroup.values.map((value, valueIndex) => (
                    <span
                      key={value}
                      className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[13px] text-secondary-foreground"
                    >
                      {value}
                      <button
                        type="button"
                        aria-label={`${value} 삭제`}
                        className="inline-flex size-5 items-center justify-center rounded-full hover:bg-muted"
                        onClick={() =>
                          setOptionGroups((previous) =>
                            previous.map((entry, index) =>
                              index === groupIndex
                                ? {
                                    ...entry,
                                    values: entry.values.filter((_, i) => i !== valueIndex),
                                  }
                                : entry,
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <Input
                    size="admin"
                    className="w-[150px]"
                    aria-label={`${optionGroup.name} 옵션값 입력`}
                    placeholder="옵션값 입력 후 Enter"
                    value={valueDrafts[groupIndex] ?? ""}
                    onChange={(event) =>
                      setValueDrafts((previous) =>
                        previous.map((draft, index) =>
                          index === groupIndex ? event.target.value : draft,
                        ),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      // 폼 전체가 제출되면 옵션값 하나 넣으려다 상품이 저장된다
                      event.preventDefault()
                      const draft = (valueDrafts[groupIndex] ?? "").trim()
                      if (!draft || optionGroup.values.includes(draft)) return
                      setOptionGroups((previous) =>
                        previous.map((entry, index) =>
                          index === groupIndex
                            ? { ...entry, values: [...entry.values, draft] }
                            : entry,
                        ),
                      )
                      setValueDrafts((previous) =>
                        previous.map((value, index) => (index === groupIndex ? "" : value)),
                      )
                    }}
                  />
                </div>
              </div>
            ))}

            {optionGroups.length < 3 ? (
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                className="self-start"
                onClick={() => {
                  setOptionGroups((previous) => [...previous, { name: "새 옵션", values: [] }])
                  setValueDrafts((previous) => [...previous, ""])
                }}
              >
                + 옵션 그룹 추가
              </Button>
            ) : null}

            {combinations.length === 0 ? (
              <p className="m-0 rounded-[calc(var(--radius)-3px)] border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
                각 옵션 그룹에 값을 하나 이상 추가하면 판매 단위가 생성됩니다.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-[13px] font-bold">판매 단위 {combinations.length}개</p>
                  <Label htmlFor="bulk-stock" className="sr-only">
                    재고 일괄 적용
                  </Label>
                  <Input
                    id="bulk-stock"
                    size="admin"
                    className="ml-auto w-[120px]"
                    inputMode="numeric"
                    placeholder="재고 일괄"
                    value={bulkStock}
                    onChange={(event) => setBulkStock(event.target.value.replace(/[^0-9]/g, ""))}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="admin-38"
                    onClick={() => {
                      if (!bulkStock) {
                        showToast("일괄 적용할 재고 수량을 입력해 주세요.", { toastVariant: "error" })
                        return
                      }
                      const stock = Number(bulkStock)
                      setVariantByKey((previous) => {
                        const next = { ...previous }
                        for (const optionLabels of combinations) {
                          const key = optionLabels.join(LABEL_SEPARATOR)
                          next[key] = { ...variantOf(optionLabels), stock }
                        }
                        return next
                      })
                    }}
                  >
                    일괄 적용
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-muted text-left">
                        <th scope="col" className="p-2 font-bold">옵션</th>
                        <th scope="col" className="p-2 font-bold">판매가</th>
                        <th scope="col" className="p-2 font-bold">재고</th>
                        <th scope="col" className="p-2 font-bold">SKU</th>
                        <th scope="col" className="p-2 font-bold">판매</th>
                      </tr>
                    </thead>
                    <tbody>
                      {combinations.map((optionLabels) => {
                        const key = optionLabels.join(LABEL_SEPARATOR)
                        const variantRow = variantOf(optionLabels)
                        return (
                          <tr key={key} className="border-t border-border">
                            <th scope="row" className="p-2 text-left font-semibold">
                              {optionLabels.join(" · ")}
                            </th>
                            <td className="p-2">
                              <Input
                                size="admin"
                                inputMode="numeric"
                                aria-label={`${optionLabels.join(" ")} 판매가`}
                                className="w-[110px]"
                                value={variantRow.price}
                                onChange={(event) =>
                                  patchVariant(optionLabels, {
                                    price: Number(event.target.value.replace(/[^0-9]/g, "")) || 0,
                                  })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                size="admin"
                                inputMode="numeric"
                                aria-label={`${optionLabels.join(" ")} 재고`}
                                className="w-[90px]"
                                value={variantRow.stock}
                                onChange={(event) =>
                                  patchVariant(optionLabels, {
                                    stock: Number(event.target.value.replace(/[^0-9]/g, "")) || 0,
                                  })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <Input
                                size="admin"
                                aria-label={`${optionLabels.join(" ")} SKU`}
                                className="w-[120px]"
                                value={variantRow.sku ?? ""}
                                onChange={(event) =>
                                  patchVariant(optionLabels, { sku: event.target.value })
                                }
                              />
                            </td>
                            <td className="p-2">
                              <label className="flex items-center gap-2">
                                <Checkbox
                                  checked={variantRow.isActive}
                                  onCheckedChange={(checked) =>
                                    patchVariant(optionLabels, { isActive: checked === true })
                                  }
                                />
                                <span className="sr-only">
                                  {optionLabels.join(" ")} 판매 여부
                                </span>
                                {variantRow.isActive ? "판매" : "중지"}
                              </label>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">
          추가상품{" "}
          <span className="text-[12px] font-normal text-muted-foreground">
            옵션과 별개로 함께 담기는 상품
          </span>
        </h2>
        <div className="mt-3 flex flex-col gap-2">
          {addons.map((addon, addonIndex) => (
            <div key={addon.addonId ?? `new-${addonIndex}`} className="flex flex-wrap gap-2">
              <Input
                size="admin"
                className="min-w-[180px] flex-1"
                aria-label={`추가상품 ${addonIndex + 1} 이름`}
                placeholder="추가상품 이름"
                value={addon.name}
                onChange={(event) =>
                  setAddons((previous) =>
                    previous.map((entry, index) =>
                      index === addonIndex ? { ...entry, name: event.target.value } : entry,
                    ),
                  )
                }
              />
              <Input
                size="admin"
                className="w-[120px]"
                inputMode="numeric"
                aria-label={`추가상품 ${addonIndex + 1} 가격`}
                value={addon.price}
                onChange={(event) =>
                  setAddons((previous) =>
                    previous.map((entry, index) =>
                      index === addonIndex
                        ? { ...entry, price: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 }
                        : entry,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="admin-38"
                onClick={() =>
                  setAddons((previous) => previous.filter((_, index) => index !== addonIndex))
                }
              >
                삭제
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="admin-38"
            className="self-start"
            onClick={() =>
              setAddons((previous) => [
                ...previous,
                { addonId: null, name: "", price: 0, isActive: true },
              ])
            }
          >
            + 추가상품
          </Button>
        </div>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">이미지</h2>

        {(["thumbnail", "detail"] as const).map((imageKind) => {
          const kindImages = imageKind === "thumbnail" ? thumbnailImages : detailImages
          return (
            <div key={imageKind} className="mt-3">
              <h3 className="m-0 text-[13px] font-bold">
                {imageKind === "thumbnail" ? "대표 갤러리" : "상세 이미지"}
                {imageKind === "thumbnail" ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    첫 장이 대표 이미지가 됩니다
                  </span>
                ) : null}
              </h3>

              <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {kindImages.map((image) => (
                  <li key={image.path} className="flex flex-wrap items-center gap-2">
                    {/* 업로드 확인용 미리보기 — next/image는 원격 로더 설정이 필요해 img를 쓴다 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/uploads/${image.path}`}
                      alt=""
                      width={56}
                      height={56}
                      className="size-14 shrink-0 rounded-[calc(var(--radius)-6px)] border border-border object-cover"
                    />
                    <Input
                      size="admin"
                      className="min-w-[200px] flex-1"
                      aria-label="이미지 대체 텍스트"
                      placeholder="대체 텍스트 (필수)"
                      required
                      value={image.alt}
                      onChange={(event) =>
                        setImages((previous) =>
                          previous.map((entry) =>
                            entry.path === image.path
                              ? { ...entry, alt: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="admin-38"
                      onClick={() =>
                        setImages((previous) =>
                          previous.filter((entry) => entry.path !== image.path),
                        )
                      }
                    >
                      삭제
                    </Button>
                  </li>
                ))}
              </ul>

              <div className="mt-2">
                <Label htmlFor={`upload-${imageKind}`} className="sr-only">
                  {imageKind === "thumbnail" ? "대표" : "상세"} 이미지 올리기
                </Label>
                <input
                  id={`upload-${imageKind}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  multiple
                  disabled={isUploading}
                  className="text-[13px] file:mr-2 file:min-h-9 file:rounded-[calc(var(--radius)-4px)] file:border file:border-border file:bg-card file:px-3 file:text-[13px] file:font-bold"
                  onChange={(event) => {
                    void uploadImages(event.target.files, imageKind)
                    event.target.value = ""
                  }}
                />
              </div>
            </div>
          )
        })}

        <p className="m-0 mt-3 text-[12px] text-muted-foreground">
          JPG · PNG · WebP · AVIF · 한 장 5MB까지. 대체 텍스트는 화면을 못 보는 이용자에게 상품을
          설명하는 유일한 수단이라 필수입니다.
        </p>
      </section>

      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <h2 className="m-0 font-heading text-[15px] font-extrabold">상세 설명</h2>
        <Label htmlFor="product-description" className="sr-only">
          상세 설명
        </Label>
        <Textarea
          id="product-description"
          size="compact"
          className="mt-2"
          placeholder="상품 상세 설명을 입력하세요."
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <p className="m-0 mt-2 text-[12px] text-muted-foreground">
          줄바꿈은 그대로 보입니다. HTML 태그는 글자 그대로 표시됩니다 — 서식 편집기는 아직
          연결되지 않았습니다.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="admin-40" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "저장 중…" : productId === null ? "상품 등록" : "저장"}
        </Button>
        <Button type="button" variant="outline" size="admin-40" asChild>
          <Link href="/admin/products">취소</Link>
        </Button>
      </div>
    </form>
  )
}
