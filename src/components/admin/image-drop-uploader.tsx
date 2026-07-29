"use client"

/**
 * 관리자 공용 이미지 업로더 — 드래그앤드롭 · 즉시 미리보기 · 자동 축소.
 *
 * 상품·배너·이야기가 모두 이 컴포넌트를 쓴다. 화면마다 따로 만들면 축소 규칙과
 * 대체텍스트 강제가 갈려서, 어떤 화면에서는 원본이 그대로 올라가고 어떤 화면에서는
 * alt 없는 이미지가 저장된다.
 *
 * 흐름: 파일 선택/드롭 → 즉시 미리보기(objectURL) → canvas 축소 → 업로드 → 저장 경로로 교체.
 * 미리보기를 먼저 띄우는 이유는 큰 사진일수록 축소·업로드가 몇 초 걸리기 때문이다 —
 * 그동안 아무것도 안 보이면 눌린 건지 알 수 없다.
 */

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useToast } from "@/components/ui/toast"
import {
  IMAGE_RESIZE_TARGETS,
  resizeImageFile,
  type ImageResizePurpose,
} from "@/lib/image-resize"
import { cn } from "@/lib/utils"

/** 축소 전 원본 상한. 서버 상한(MAX_IMAGE_BYTES)과 같은 숫자다 */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

export type UploadedImage = {
  path: string
  alt: string
}

type PendingUpload = {
  previewKey: string
  previewUrl: string
  fileName: string
}

export type ImageDropUploaderProps = {
  /** 이미 올라간 이미지들 — 부모가 상태를 갖는다(저장은 부모 폼이 한다) */
  images: UploadedImage[]
  onChange: (nextImages: UploadedImage[]) => void
  /** 축소 목표 크기를 정한다 */
  purpose: ImageResizePurpose
  /** 업로드 API — 용도별로 다르다(상품/리뷰) */
  uploadEndpoint: string
  /** 서버가 저장 폴더를 고르는 값. 엔드포인트가 요구할 때만 보낸다 */
  folder?: string
  /** 한 장만 쓰는 자리(히어로 등)는 여러 장을 못 고르게 한다 */
  multiple?: boolean
  label: string
  helpText?: string
}

export function ImageDropUploader({
  images,
  onChange,
  purpose,
  uploadEndpoint,
  folder,
  multiple = true,
  label,
  helpText,
}: ImageDropUploaderProps) {
  const { showToast } = useToast()
  const [isDragging, setIsDragging] = React.useState(false)
  const [pending, setPending] = React.useState<PendingUpload[]>([])
  const inputRef = React.useRef<HTMLInputElement>(null)
  const target = IMAGE_RESIZE_TARGETS[purpose]

  /* 미리보기 URL은 브라우저가 알아서 놓아주지 않는다 — 언마운트 때 반드시 회수한다.
     안 하면 관리자가 사진을 많이 올릴수록 탭 메모리가 계속 늘어난다.
     ref는 렌더 중이 아니라 이벤트 핸들러에서만 만진다(렌더 중 ref 수정은 동시성 렌더에서 깨진다) */
  const liveObjectUrlsRef = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const liveUrls = liveObjectUrlsRef.current
    return () => {
      for (const url of liveUrls) URL.revokeObjectURL(url)
    }
  }, [])

  async function processFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"))
    if (files.length === 0) {
      showToast("이미지 파일만 올릴 수 있어요.", { toastVariant: "error" })
      return
    }

    for (const file of files) {
      if (file.size > MAX_SOURCE_BYTES) {
        showToast(`${file.name} — 한 장은 20MB까지 올릴 수 있어요.`, { toastVariant: "error" })
        continue
      }

      const previewKey = `${file.name}-${file.lastModified}-${Math.round(file.size)}`
      const previewUrl = URL.createObjectURL(file)
      liveObjectUrlsRef.current.add(previewUrl)
      setPending((previous) => [...previous, { previewKey, previewUrl, fileName: file.name }])

      try {
        const resized = await resizeImageFile(file, purpose)
        const formData = new FormData()
        formData.append("files", resized.blob, resized.fileName)
        if (folder) formData.append("folder", folder)

        const response = await fetch(uploadEndpoint, { method: "POST", body: formData })
        const payload = (await response.json()) as {
          storedPaths?: string[]
          message?: string
        }
        if (!response.ok || !payload.storedPaths?.length) {
          showToast(payload.message ?? `${file.name} 업로드에 실패했어요.`, {
            toastVariant: "error",
          })
          continue
        }

        // alt는 비워 둔다 — 저장 시 필수라 관리자가 반드시 채우게 된다(접근성)
        onChange([...images, ...payload.storedPaths.map((path) => ({ path, alt: "" }))])
      } catch {
        showToast(`${file.name} 처리에 실패했어요. 다른 파일로 시도해 주세요.`, {
          toastVariant: "error",
        })
      } finally {
        liveObjectUrlsRef.current.delete(previewUrl)
        URL.revokeObjectURL(previewUrl)
        setPending((previous) => previous.filter((item) => item.previewKey !== previewKey))
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          if (event.dataTransfer.files.length > 0) void processFiles(event.dataTransfer.files)
        }}
        className={cn(
          "rounded-[var(--radius)] border-2 border-dashed p-6 text-center transition-colors",
          isDragging ? "border-primary bg-secondary" : "border-border bg-card",
        )}
      >
        <p className="m-0 text-[13px] font-semibold">{label}</p>
        <p className="m-0 mt-1 text-[12px] text-muted-foreground">
          여기로 끌어다 놓거나 버튼으로 고르세요 · JPG · PNG · WebP · AVIF · 한 장 20MB까지
        </p>
        <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
          올릴 때 자동으로 {target.maxWidth}×{target.maxHeight} 이하로 줄입니다.
          {helpText ? ` ${helpText}` : ""}
        </p>

        {/* 드래그는 마우스 전용이라 파일 선택 버튼을 반드시 함께 둔다(키보드·모바일) */}
        <Button
          type="button"
          variant="outline"
          size="admin-40"
          className="mt-3"
          onClick={() => inputRef.current?.click()}
        >
          파일 선택
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple={multiple}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void processFiles(event.target.files)
            event.target.value = ""
          }}
        />
      </div>

      {(images.length > 0 || pending.length > 0) && (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, imageIndex) => (
            <li
              key={image.path}
              className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-border bg-card p-2"
            >
              <span className="block aspect-square overflow-hidden rounded-[6px] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/uploads/${image.path}`}
                  alt={image.alt || "대체 텍스트를 아직 입력하지 않은 이미지"}
                  className="size-full object-cover"
                />
              </span>
              <Label htmlFor={`alt-${image.path}`} className="text-[11px]">
                대체 텍스트 *
              </Label>
              <Input
                id={`alt-${image.path}`}
                size="admin-dense"
                value={image.alt}
                placeholder="예: 통밀 오트 쿠키 12개입 상자"
                onChange={(event) =>
                  onChange(
                    images.map((row, rowIndex) =>
                      rowIndex === imageIndex ? { ...row, alt: event.target.value } : row,
                    ),
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                size="admin-38"
                onClick={() => onChange(images.filter((_, rowIndex) => rowIndex !== imageIndex))}
              >
                삭제
              </Button>
            </li>
          ))}

          {/* 처리 중인 것도 같은 자리에 보인다 — 어디에 들어갈지 미리 알 수 있다 */}
          {pending.map((item) => (
            <li
              key={item.previewKey}
              className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-border bg-card p-2"
            >
              <span className="relative block aspect-square overflow-hidden rounded-[6px] bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.previewUrl}
                  alt=""
                  className="size-full object-cover opacity-50"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner />
                </span>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {item.fileName} 처리 중…
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
