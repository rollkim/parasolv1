// 실사진 도입 전 공용 회색 플레이스홀더 — 상품 카드·상세 갤러리가 함께 쓴다.
// (product_image가 비어 있는 현 단계 대응. 이미지 최적화 도입은 5주차)
//
// 루트 전체를 aria-hidden으로 두는 이유: 순수 장식 블록이라 상품 정보는
// 인접 텍스트(상품명 등)가 전달해야 한다 — 여기서 낭독되면 중복·소음이 된다.

import { ImageIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function ImagePlaceholder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // 비율 고정(정방형)이 기본 — 상세 갤러리 등에서 다른 배치가 필요하면 className으로 덮는다
        "flex aspect-square w-full items-center justify-center bg-muted",
        className
      )}
    >
      <ImageIcon
        aria-hidden="true"
        strokeWidth={1.5}
        className="size-8 text-muted-foreground/50"
      />
    </div>
  )
}
