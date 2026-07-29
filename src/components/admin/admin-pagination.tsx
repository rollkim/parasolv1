"use client"

/**
 * 관리자 목록 공용 페이지네이션.
 *
 * 화면마다 따로 만들면 규격이 갈린다 — 어떤 목록은 1페이지에서 사라지고 어떤 목록은 남고,
 * 터치 타겟도 제각각이 된다. 한 벌로 모아 전 목록이 같게 보이고 같게 동작하게 한다.
 *
 * **1페이지뿐이어도 [1]을 보여준다.** 사라지면 "목록이 여기서 끝인지, 페이징이 없는 화면인지"를
 * 구분할 수 없다. 총 건수도 함께 적어 지금 보고 있는 범위가 분명해진다.
 */

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type AdminPaginationProps = {
  page: number
  pageSize: number
  totalCount: number
  onPageChange: (nextPage: number) => void
  /** 목록 이름 — 스크린리더가 어느 목록의 페이지인지 알 수 있게 */
  label?: string
}

/**
 * 보여줄 페이지 번호 — 현재 쪽 앞뒤 2개씩.
 * 전부 그리면 100쪽짜리 목록에서 번호가 화면을 덮는다.
 */
function visiblePageNumbers(page: number, lastPage: number): number[] {
  const windowStart = Math.max(1, Math.min(page - 2, lastPage - 4))
  const windowEnd = Math.min(lastPage, Math.max(page + 2, 5))
  const numbers: number[] = []
  for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber += 1) {
    numbers.push(pageNumber)
  }
  return numbers
}

export function AdminPagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  label = "목록",
}: AdminPaginationProps) {
  const lastPage = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageNumbers = visiblePageNumbers(page, lastPage)
  const firstIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(page * pageSize, totalCount)

  return (
    <nav
      aria-label={`${label} 페이지 이동`}
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      {/* 지금 보고 있는 범위 — 숫자만으로는 몇 번째 묶음인지 알 수 없다 */}
      <p className="m-0 text-[12px] text-muted-foreground">
        {totalCount === 0
          ? "0건"
          : `총 ${totalCount.toLocaleString("ko-KR")}건 중 ${firstIndex.toLocaleString("ko-KR")}–${lastIndex.toLocaleString("ko-KR")}`}
      </p>

      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="admin-38"
          aria-label="이전 페이지"
          aria-disabled={page <= 1}
          className={cn(page <= 1 && "pointer-events-none opacity-40")}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </Button>

        {/* 앞쪽이 잘렸으면 1쪽으로 가는 길을 남긴다 */}
        {pageNumbers[0] > 1 && (
          <>
            <Button
              type="button"
              variant="outline"
              size="admin-38"
              aria-label="1페이지"
              onClick={() => onPageChange(1)}
            >
              1
            </Button>
            {pageNumbers[0] > 2 && (
              <span aria-hidden="true" className="px-1 text-[12px] text-muted-foreground">
                …
              </span>
            )}
          </>
        )}

        {pageNumbers.map((pageNumber) => (
          <Button
            key={pageNumber}
            type="button"
            variant={pageNumber === page ? "primary" : "outline"}
            size="admin-38"
            aria-label={`${pageNumber}페이지`}
            aria-current={pageNumber === page ? "page" : undefined}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </Button>
        ))}

        {pageNumbers.at(-1)! < lastPage && (
          <>
            {pageNumbers.at(-1)! < lastPage - 1 && (
              <span aria-hidden="true" className="px-1 text-[12px] text-muted-foreground">
                …
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="admin-38"
              aria-label={`마지막 ${lastPage}페이지`}
              onClick={() => onPageChange(lastPage)}
            >
              {lastPage}
            </Button>
          </>
        )}

        <Button
          type="button"
          variant="outline"
          size="admin-38"
          aria-label="다음 페이지"
          aria-disabled={page >= lastPage}
          className={cn(page >= lastPage && "pointer-events-none opacity-40")}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </Button>
      </div>
    </nav>
  )
}
