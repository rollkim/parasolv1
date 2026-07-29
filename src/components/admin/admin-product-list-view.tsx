"use client"

// 핸드오프 규격: 관리자 상품목록.dc.html — 상태 탭 + 카테고리/정렬 + 검색 + 목록 + 일괄 처리.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - 목업 탭은 판매중/품절/숨김인데 **작성중(draft)** 탭을 더했다. DB 상태가 draft/active/hidden이고,
//    쓰다 만 상품이 어디에도 안 보이면 다시 찾을 수 없다.
//  - **품절은 상태가 아니라 재고 0에서 파생**된다(스토어프론트와 같은 규칙). 그래서 품절 탭이
//    별도 상태값을 쓰지 않고, 카드도 '품절' 텍스트로 알린다(색만으로 전달 금지 — KWCAG).
//  - 일괄 삭제는 soft delete다. 주문·리뷰가 참조하므로 행을 지우지 않는다.

import * as React from "react"

import Link from "next/link"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { formatKrw } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type ProductTab = "all" | "active" | "soldout" | "hidden" | "draft"
type ProductSort = "recent" | "sales" | "lowstock" | "priceHigh"

const PRODUCT_TABS: { tab: ProductTab; label: string }[] = [
  { tab: "all", label: "전체" },
  { tab: "active", label: "판매중" },
  { tab: "soldout", label: "품절" },
  { tab: "hidden", label: "숨김" },
  { tab: "draft", label: "작성중" },
]

const PRODUCT_SORTS: { sort: ProductSort; label: string }[] = [
  { sort: "recent", label: "최근 등록순" },
  { sort: "sales", label: "판매량순" },
  { sort: "lowstock", label: "재고 적은순" },
  { sort: "priceHigh", label: "가격 높은순" },
]

export function AdminProductListView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [activeTab, setActiveTab] = React.useState<ProductTab>("all")
  const [sort, setSort] = React.useState<ProductSort>("recent")
  const [keywordInput, setKeywordInput] = React.useState("")
  const [appliedKeyword, setAppliedKeyword] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [selectedIds, setSelectedIds] = React.useState<number[]>([])

  const listQuery = useQuery(
    trpc.adminProduct.list.queryOptions({
      tab: activeTab,
      sort,
      keyword: appliedKeyword || undefined,
      page,
    }),
  )
  const changeStatusMutation = useMutation(trpc.adminProduct.changeStatus.mutationOptions())
  const removeMutation = useMutation(trpc.adminProduct.remove.mutationOptions())

  const listResult = listQuery.data
  const lastPage = listResult
    ? Math.max(1, Math.ceil(listResult.totalCount / listResult.pageSize))
    : 1
  const visibleIds = listResult?.cards.map((card) => card.productId) ?? []
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))

  function refreshList() {
    setSelectedIds([])
    void queryClient.invalidateQueries(trpc.adminProduct.pathFilter())
  }

  function runBulkStatus(productStatus: "active" | "hidden", label: string) {
    if (selectedIds.length === 0 || changeStatusMutation.isPending) return
    changeStatusMutation.mutate(
      { productIds: selectedIds, productStatus },
      {
        onSuccess: (result) => {
          showToast(`${result.changedCount}개 상품을 ${label}으로 바꿨어요.`, { toastVariant: "info" })
          refreshList()
        },
        onError: (statusError) => showToast(statusError.message, { toastVariant: "error" }),
      },
    )
  }

  function runBulkRemove() {
    if (selectedIds.length === 0 || removeMutation.isPending) return
    removeMutation.mutate(
      { productIds: selectedIds },
      {
        onSuccess: (result) => {
          showToast(`${result.deletedCount}개 상품을 삭제했어요.`, { toastVariant: "info" })
          refreshList()
        },
        onError: (removeError) => showToast(removeError.message, { toastVariant: "error" }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="상품 상태 필터" className="flex flex-wrap gap-2">
          {PRODUCT_TABS.map((tabItem) => (
            <Button
              key={tabItem.tab}
              type="button"
              variant="toggle"
              size="admin-38"
              aria-pressed={activeTab === tabItem.tab}
              onClick={() => {
                setActiveTab(tabItem.tab)
                setPage(1)
                setSelectedIds([])
              }}
            >
              {tabItem.label}
              {listResult ? (
                <span className="ml-1.5 text-[12px] font-bold opacity-70">
                  {listResult.tabCounts[tabItem.tab]}
                </span>
              ) : null}
            </Button>
          ))}
        </div>

        <Button variant="primary" size="admin-40" className="ml-auto" asChild>
          <Link href="/admin/products/new">+ 상품 등록</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <form role="search" className="flex gap-2" onSubmit={(event) => {
          event.preventDefault()
          setAppliedKeyword(keywordInput.trim())
          setPage(1)
        }}>
          <Input
            size="admin"
            type="search"
            aria-label="상품 검색"
            placeholder="상품명·URL 주소"
            className="max-w-[280px]"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
          />
          <Button type="submit" variant="neutral-solid" size="admin-40">
            검색
          </Button>
        </form>

        <label className="flex items-center gap-2 text-[13px]">
          <span className="sr-only">정렬</span>
          <select
            className="h-10 rounded-[calc(var(--radius)-4px)] border border-input bg-card px-2.5 text-[13px]"
            value={sort}
            onChange={(event) => setSort(event.target.value as ProductSort)}
          >
            {PRODUCT_SORTS.map((sortOption) => (
              <option key={sortOption.sort} value={sortOption.sort}>
                {sortOption.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 일괄 처리 — 선택이 있을 때만 나온다 */}
      {selectedIds.length > 0 ? (
        <div
          role="group"
          aria-label="선택 상품 일괄 처리"
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-primary bg-secondary p-2.5"
        >
          <span className="text-[13px] font-bold">{selectedIds.length}개 선택</span>
          <Button type="button" variant="outline" size="admin-38" onClick={() => runBulkStatus("active", "판매중")}>
            판매중으로
          </Button>
          <Button type="button" variant="outline" size="admin-38" onClick={() => runBulkStatus("hidden", "숨김")}>
            숨김으로
          </Button>
          <Button
            type="button"
            variant="destructive-outline"
            size="admin-38"
            onClick={runBulkRemove}
          >
            삭제
          </Button>
          <Button type="button" variant="ghost" size="admin-38" onClick={() => setSelectedIds([])}>
            선택 해제
          </Button>
        </div>
      ) : null}

      {listQuery.isPending ? (
        <div className="flex min-h-40 items-center justify-center" aria-busy="true">
          <Spinner />
          <span className="sr-only">상품 목록을 불러오는 중입니다</span>
        </div>
      ) : listQuery.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
          상품 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : (listResult?.cards.length ?? 0) === 0 ? (
        <EmptyState
          size="section"
          stateTone="neutral"
          headingLevel={2}
          icon={<span aria-hidden="true">🍪</span>}
          title="조건에 맞는 상품이 없어요"
          description="탭이나 검색어를 바꾸거나, 새 상품을 등록해 보세요."
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-[13px]">
              <Checkbox
                aria-label="이 페이지 전체 선택"
                checked={allVisibleChecked}
                onCheckedChange={(checked) =>
                  setSelectedIds(checked === true ? visibleIds : [])
                }
              />
              이 페이지 전체 선택
            </label>
            <p className="m-0 text-[13px] text-muted-foreground">
              총 <b className="text-foreground">{listResult?.totalCount.toLocaleString("ko-KR")}</b>개
            </p>
          </div>

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {listResult?.cards.map((productCard) => (
              <li
                key={productCard.productId}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-3.5",
                  productCard.productStatus === "hidden" && "opacity-60",
                )}
              >
                <Checkbox
                  aria-label={`${productCard.name} 선택`}
                  checked={selectedIds.includes(productCard.productId)}
                  onCheckedChange={(checked) =>
                    setSelectedIds((previous) =>
                      checked === true
                        ? [...previous, productCard.productId]
                        : previous.filter((id) => id !== productCard.productId),
                    )
                  }
                />

                <Link
                  href={`/admin/products/${productCard.productId}`}
                  className="min-w-0 flex-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <b className="font-semibold">{productCard.name}</b>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {[productCard.makerName, productCard.slug, `판매단위 ${productCard.variantCount}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>

                <span className="shrink-0 rounded-[5px] border border-border px-2 py-0.5 text-[12px] font-bold">
                  {productCard.productStatusLabel}
                </span>
                {/* 품절은 텍스트로 알린다 — 색만으로 전달하지 않는다 */}
                {productCard.isSoldOut ? (
                  <span className="shrink-0 rounded-[5px] border border-destructive px-2 py-0.5 text-[12px] font-bold text-destructive">
                    품절
                  </span>
                ) : null}

                <span className="shrink-0 text-[12px] text-muted-foreground">
                  재고 {productCard.totalStock.toLocaleString("ko-KR")}
                </span>
                <span className="shrink-0 text-sm font-bold">{formatKrw(productCard.minPrice)}</span>
              </li>
            ))}
          </ul>

          {lastPage > 1 ? (
            <nav aria-label="페이지 이동" className="flex justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                disabled={page <= 1}
                onClick={() => setPage((previous) => Math.max(1, previous - 1))}
              >
                이전
              </Button>
              <span className="flex items-center px-2 text-[13px] text-muted-foreground">
                {page} / {lastPage}
              </span>
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                disabled={page >= lastPage}
                onClick={() => setPage((previous) => Math.min(lastPage, previous + 1))}
              >
                다음
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  )
}
