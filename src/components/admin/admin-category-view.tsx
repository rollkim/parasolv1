"use client"

// 핸드오프 규격: 관리자 카테고리.dc.html — 좌 트리(펼침·순서) / 우 편집 패널(이름·URL·노출·
// 하위 추가·삭제). 목업이 대분류/중분류 2단계 구조다.
//
// 목업과 의도적으로 다르게 간 부분(사유):
//  - **드래그 대신 ↑↓ 버튼**으로 순서를 바꾼다. 드래그는 키보드만으로 조작할 수 없어
//    "키보드만으로 완주 가능"(KWCAG)을 지킬 수 없다. 계층 이동(부모 바꾸기)은 1차 범위 밖 —
//    상품 연결이 함께 흔들려 되돌리기 어려운 작업이라 별도 설계가 필요하다.
//  - 삭제 전에 **영향 범위를 서버에 물어본다**. "상품 N개가 미분류로 갑니다"를 모르고 누르면
//    되돌릴 수 없다.
//  - 상품 이동 모달은 두지 않았다 — 상품의 카테고리는 상품 등록/수정 화면이 이미 담당한다.

import * as React from "react"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/trpc/client"

type CategoryNode = {
  categoryId: number
  name: string
  slug: string
  sortOrder: number
  isActive: boolean
  productCount: number
  children: CategoryNode[]
}

export function AdminCategoryView() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const treeQuery = useQuery(trpc.adminCategory.tree.queryOptions())
  const createMutation = useMutation(trpc.adminCategory.create.mutationOptions())
  const updateMutation = useMutation(trpc.adminCategory.update.mutationOptions())
  const moveMutation = useMutation(trpc.adminCategory.move.mutationOptions())
  const removeMutation = useMutation(trpc.adminCategory.remove.mutationOptions())

  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [collapsedIds, setCollapsedIds] = React.useState<number[]>([])
  const [editName, setEditName] = React.useState("")
  const [editSlug, setEditSlug] = React.useState("")
  const [editIsActive, setEditIsActive] = React.useState(true)
  const [creatingParentId, setCreatingParentId] = React.useState<number | null | "none">("none")
  const [newName, setNewName] = React.useState("")
  const [newSlug, setNewSlug] = React.useState("")
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryNode | null>(null)

  const tree = treeQuery.data ?? []
  const flatNodes: CategoryNode[] = tree.flatMap((parent) => [parent, ...parent.children])
  const selected = flatNodes.find((node) => node.categoryId === selectedId) ?? null
  const isTopLevel = selected !== null && tree.some((node) => node.categoryId === selected.categoryId)

  const deletePreviewQuery = useQuery({
    ...trpc.adminCategory.deletePreview.queryOptions({
      categoryId: deleteTarget?.categoryId ?? 0,
    }),
    enabled: deleteTarget !== null,
  })

  function refreshTree() {
    void queryClient.invalidateQueries(trpc.adminCategory.pathFilter())
  }

  /** 선택이 바뀌면 편집칸을 그 노드 값으로 맞춘다 — 트리 클릭 시점에 함께 처리한다 */
  function selectNode(node: CategoryNode) {
    setSelectedId(node.categoryId)
    setEditName(node.name)
    setEditSlug(node.slug)
    setEditIsActive(node.isActive)
    setCreatingParentId("none")
  }

  function submitUpdate(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || updateMutation.isPending) return
    updateMutation.mutate(
      {
        categoryId: selected.categoryId,
        name: editName.trim(),
        slug: editSlug.trim(),
        isActive: editIsActive,
      },
      {
        onSuccess: () => {
          showToast("카테고리를 저장했어요.", { toastVariant: "info" })
          refreshTree()
        },
        onError: (updateError) => showToast(updateError.message, { toastVariant: "error" }),
      },
    )
  }

  function submitCreate(event: React.FormEvent) {
    event.preventDefault()
    if (creatingParentId === "none" || createMutation.isPending) return
    createMutation.mutate(
      { parentId: creatingParentId, name: newName.trim(), slug: newSlug.trim() },
      {
        onSuccess: () => {
          showToast(
            creatingParentId === null ? "대분류를 추가했어요." : "하위 카테고리를 추가했어요.",
            { toastVariant: "info" },
          )
          setCreatingParentId("none")
          setNewName("")
          setNewSlug("")
          refreshTree()
        },
        onError: (createError) => showToast(createError.message, { toastVariant: "error" }),
      },
    )
  }

  function moveNode(categoryId: number, direction: "up" | "down") {
    if (moveMutation.isPending) return
    moveMutation.mutate(
      { categoryId, direction },
      {
        onSuccess: (result) => {
          if (result.moved) refreshTree()
        },
        onError: (moveError) => showToast(moveError.message, { toastVariant: "error" }),
      },
    )
  }

  function confirmDelete() {
    if (!deleteTarget || removeMutation.isPending) return
    removeMutation.mutate(
      { categoryId: deleteTarget.categoryId },
      {
        onSuccess: (result) => {
          showToast(
            result.detachedProductCount > 0
              ? `카테고리를 삭제했어요. 상품 ${result.detachedProductCount}개가 미분류가 됐어요.`
              : "카테고리를 삭제했어요.",
            { toastVariant: "info" },
          )
          setDeleteTarget(null)
          if (selectedId === deleteTarget.categoryId) setSelectedId(null)
          refreshTree()
        },
        onError: (deleteError) => showToast(deleteError.message, { toastVariant: "error" }),
      },
    )
  }

  if (treeQuery.isPending) {
    return (
      <div className="flex min-h-40 items-center justify-center" aria-busy="true">
        <Spinner />
        <span className="sr-only">카테고리를 불러오는 중입니다</span>
      </div>
    )
  }

  if (treeQuery.isError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-muted-foreground">
        카테고리를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    )
  }

  function renderRow(node: CategoryNode, depth: 0 | 1, siblings: CategoryNode[]) {
    const nodeIndex = siblings.findIndex((row) => row.categoryId === node.categoryId)
    const isSelected = selectedId === node.categoryId
    const isCollapsed = collapsedIds.includes(node.categoryId)

    return (
      <li key={node.categoryId}>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-[calc(var(--radius)-4px)] px-2 py-1.5",
            isSelected && "bg-secondary",
            !node.isActive && "opacity-60",
          )}
          style={{ paddingLeft: depth === 1 ? 28 : 8 }}
        >
          {depth === 0 && node.children.length > 0 ? (
            <button
              type="button"
              aria-expanded={!isCollapsed}
              aria-label={`${node.name} 하위 ${isCollapsed ? "펼치기" : "접기"}`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              onClick={() =>
                setCollapsedIds((previous) =>
                  isCollapsed
                    ? previous.filter((id) => id !== node.categoryId)
                    : [...previous, node.categoryId],
                )
              }
            >
              <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}

          <button
            type="button"
            aria-pressed={isSelected}
            className="min-w-0 flex-1 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => selectNode(node)}
          >
            <b className={cn("font-semibold", depth === 1 && "font-normal")}>{node.name}</b>
            <span className="ml-1.5 text-[12px] text-muted-foreground">
              {node.slug} · 상품 {node.productCount}
            </span>
            {/* 노출 여부를 색이 아니라 텍스트로 알린다 */}
            {!node.isActive ? (
              <span className="ml-1.5 rounded-[4px] border border-border px-1.5 text-[11px] font-bold">
                숨김
              </span>
            ) : null}
          </button>

          <Button
            type="button"
            variant="ghost"
            size="admin-38"
            aria-label={`${node.name} 위로`}
            disabled={nodeIndex <= 0}
            onClick={() => moveNode(node.categoryId, "up")}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="admin-38"
            aria-label={`${node.name} 아래로`}
            disabled={nodeIndex >= siblings.length - 1}
            onClick={() => moveNode(node.categoryId, "down")}
          >
            ↓
          </Button>
        </div>

        {depth === 0 && !isCollapsed && node.children.length > 0 ? (
          <ul className="m-0 list-none p-0">
            {node.children.map((child) => renderRow(child, 1, node.children))}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-[var(--radius)] border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 font-heading text-[15px] font-extrabold">카테고리 트리</h2>
          <Button
            type="button"
            variant="primary"
            size="admin-38"
            onClick={() => {
              setCreatingParentId(null)
              setNewName("")
              setNewSlug("")
            }}
          >
            + 대분류 추가
          </Button>
        </div>
        <p className="m-0 mt-1 text-[12px] text-muted-foreground">
          대분류 · 중분류 2단계까지 만들 수 있어요. 순서는 ↑↓ 버튼으로 바꿉니다.
        </p>

        {tree.length === 0 ? (
          <p className="m-0 mt-4 text-[13px] text-muted-foreground">
            아직 카테고리가 없어요. 대분류부터 추가해 보세요.
          </p>
        ) : (
          <ul className="m-0 mt-3 list-none p-0">
            {tree.map((node) => renderRow(node, 0, tree))}
          </ul>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        {creatingParentId !== "none" ? (
          <section className="rounded-[var(--radius)] border border-primary bg-card p-4">
            <h2 className="m-0 font-heading text-[15px] font-extrabold">
              {creatingParentId === null ? "대분류 추가" : "하위 카테고리 추가"}
            </h2>
            <form className="mt-3 flex flex-col gap-3" onSubmit={submitCreate}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-category-name">이름 *</Label>
                <Input
                  id="new-category-name"
                  size="admin"
                  required
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-category-slug">URL 주소 *</Label>
                <Input
                  id="new-category-slug"
                  size="admin"
                  required
                  placeholder="bakery"
                  value={newSlug}
                  onChange={(event) => setNewSlug(event.target.value)}
                />
                <p className="m-0 text-[12px] text-muted-foreground">
                  영문 소문자·숫자·하이픈만
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="admin-40" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "추가 중…" : "추가"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="admin-40"
                  onClick={() => setCreatingParentId("none")}
                >
                  취소
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {selected ? (
          <section className="rounded-[var(--radius)] border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="m-0 font-heading text-[15px] font-extrabold">카테고리 편집</h2>
              <span className="rounded-[5px] bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                {isTopLevel ? "대분류" : "중분류"}
              </span>
            </div>

            <form className="mt-3 flex flex-col gap-3" onSubmit={submitUpdate}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="category-name">이름 *</Label>
                <Input
                  id="category-name"
                  size="admin"
                  required
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="category-slug">URL 주소 *</Label>
                <Input
                  id="category-slug"
                  size="admin"
                  required
                  value={editSlug}
                  onChange={(event) => setEditSlug(event.target.value)}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox
                  checked={editIsActive}
                  onCheckedChange={(checked) => setEditIsActive(checked === true)}
                />
                스토어에 노출
              </label>

              <dl className="m-0 flex flex-col gap-1 rounded-[calc(var(--radius)-4px)] bg-muted p-2.5 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">하위 카테고리</dt>
                  <dd className="m-0 font-bold">{selected.children.length}개</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">연결된 상품</dt>
                  <dd className="m-0 font-bold">{selected.productCount}개</dd>
                </div>
              </dl>

              <Button type="submit" variant="primary" size="admin-40" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "저장 중…" : "저장"}
              </Button>
            </form>

            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              {isTopLevel ? (
                <Button
                  type="button"
                  variant="outline"
                  size="admin-40"
                  onClick={() => {
                    setCreatingParentId(selected.categoryId)
                    setNewName("")
                    setNewSlug("")
                  }}
                >
                  + 하위 카테고리 추가
                </Button>
              ) : (
                <p className="m-0 text-[12px] text-muted-foreground">
                  중분류 아래에는 더 만들 수 없어요 — 2단계까지만 지원합니다.
                </p>
              )}
              <Button
                type="button"
                variant="destructive-outline"
                size="admin-40"
                onClick={() => setDeleteTarget(selected)}
              >
                카테고리 삭제
              </Button>
            </div>
          </section>
        ) : (
          <section className="rounded-[var(--radius)] border border-border bg-card p-4">
            <p className="m-0 text-[13px] text-muted-foreground">
              왼쪽 트리에서 카테고리를 선택하면 여기서 편집할 수 있어요.
            </p>
          </section>
        )}
      </aside>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {(deletePreviewQuery.data?.childCount ?? 0) > 0
                ? "하위 분류가 있어 삭제할 수 없어요"
                : "카테고리를 삭제할까요?"}
            </DialogTitle>
            <DialogDescription>
              {(deletePreviewQuery.data?.childCount ?? 0) > 0
                ? "하위 카테고리를 먼저 삭제하거나 다른 분류로 옮긴 뒤 삭제할 수 있어요."
                : `‘${deleteTarget?.name ?? ""}’ 카테고리를 삭제합니다. 연결된 상품 ${
                    deletePreviewQuery.data?.productCount ?? 0
                  }개는 미분류가 됩니다(상품은 지워지지 않아요).`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" size="admin-40" onClick={() => setDeleteTarget(null)}>
              닫기
            </Button>
            {(deletePreviewQuery.data?.childCount ?? 0) === 0 ? (
              <Button
                type="button"
                variant="destructive"
                size="admin-40"
                disabled={removeMutation.isPending || deletePreviewQuery.isPending}
                onClick={confirmDelete}
              >
                {removeMutation.isPending ? "삭제 중…" : "삭제"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
