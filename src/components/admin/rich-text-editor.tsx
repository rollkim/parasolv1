"use client"

/**
 * 서식 본문 에디터 — 상품 설명·이야기가 함께 쓴다.
 *
 * Tiptap을 쓴다(명율 `client/src/components/RichTextEditor.tsx`와 같은 선택).
 * 네이버 SmartEditor 2는 jQuery + iframe + 전역 스크립트 구조라 React 19 / Next 16에서
 * 마운트·정리·SSR이 어긋난다 — 공식 React 패키지도 없다.
 *
 * **여기서 나오는 HTML을 그대로 믿지 않는다.** 저장할 때 서버가 살균한다
 * (html-sanitize.service). 화면에서 막는 것은 우회되고, 우회하면 저장형 XSS가 된다.
 */

import * as React from "react"

import Image from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import Underline from "@tiptap/extension-underline"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  UnderlineIcon,
} from "lucide-react"

import { useToast } from "@/components/ui/toast"
import { resizeImageFile, type ImageResizePurpose } from "@/lib/image-resize"
import { cn } from "@/lib/utils"

export type RichTextEditorProps = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  /** 본문 이미지 축소 기준 — 상품 설명과 이야기가 다르다 */
  imagePurpose?: ImageResizePurpose
  /** 이미지 업로드 API. 없으면 이미지 버튼을 숨긴다 */
  uploadEndpoint?: string
}

/**
 * 옛 글은 서식 없는 평문일 수 있다 — 그대로 넣으면 한 줄로 뭉친다.
 * `<`로 시작하지 않으면 평문으로 보고 줄바꿈을 살려 문단으로 감싼다.
 */
function toEditorHtml(value: string): string {
  if (!value) return ""
  if (value.trimStart().startsWith("<")) return value
  return `<p>${value.replace(/\n/g, "<br>")}</p>`
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  imagePurpose = "article",
  uploadEndpoint,
}: RichTextEditorProps) {
  const { showToast } = useToast()
  const [isUploading, setIsUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const editor = useEditor({
    // SSR에서 즉시 렌더하면 서버·클라이언트 HTML이 어긋난다(Tiptap 권장 설정)
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      // 대체텍스트를 반드시 실어 보낸다 — 살균기가 alt를 남기므로 저장까지 살아간다
      Image.configure({ HTMLAttributes: { class: "rounded-[var(--radius)]" } }),
      Placeholder.configure({ placeholder: placeholder ?? "내용을 입력하세요" }),
    ],
    content: toEditorHtml(value),
    onUpdate({ editor: updatedEditor }) {
      const html = updatedEditor.getHTML()
      // Tiptap은 빈 상태를 "<p></p>"로 준다 — 그대로 저장하면 빈 줄이 생긴다
      onChange(html === "<p></p>" ? "" : html)
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[220px] px-3.5 py-3 text-sm leading-[1.8] outline-none [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-extrabold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-primary [&_blockquote]:pl-3 [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-[var(--radius)]",
      },
    },
  })

  async function insertImage(file: File) {
    if (!uploadEndpoint || !editor || isUploading) return
    setIsUploading(true)
    try {
      // 본문 이미지도 올리기 전에 줄인다 — 상품·배너와 같은 규칙(lib/image-resize)
      const resized = await resizeImageFile(file, imagePurpose)
      const formData = new FormData()
      formData.append("files", resized.blob, resized.fileName)
      const response = await fetch(uploadEndpoint, { method: "POST", body: formData })
      const payload = (await response.json()) as { storedPaths?: string[]; message?: string }
      const storedPath = payload.storedPaths?.[0]
      if (!response.ok || !storedPath) {
        showToast(payload.message ?? "이미지를 넣지 못했어요.", { toastVariant: "error" })
        return
      }
      // alt는 파일명으로 시작한다 — 빈 alt로 두면 화면을 못 보는 이용자에게 아무것도 안 남는다.
      // 운영자가 본문에서 고칠 수 있게 뜻이 있는 기본값을 준다
      const defaultAlt = file.name.replace(/\.[^.]+$/, "")
      editor
        .chain()
        .focus()
        .setImage({ src: `/api/uploads/${storedPath}`, alt: defaultAlt })
        .run()
    } catch {
      showToast("이미지를 넣지 못했어요. 다시 시도해 주세요.", { toastVariant: "error" })
    } finally {
      setIsUploading(false)
    }
  }

  if (!editor) return null

  const toolbarButtonClass = (isActive: boolean) =>
    cn(
      "inline-flex size-8 cursor-pointer items-center justify-center rounded-[6px] transition-colors",
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    )

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card focus-within:border-primary">
      {/* 툴바 — 각 버튼에 title과 aria-pressed를 준다(아이콘만으로는 무엇인지 알 수 없다) */}
      <div
        role="toolbar"
        aria-label="본문 서식"
        className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1.5"
      >
        <button
          type="button"
          title="굵게"
          aria-label="굵게"
          aria-pressed={editor.isActive("bold")}
          className={toolbarButtonClass(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="기울임"
          aria-label="기울임"
          aria-pressed={editor.isActive("italic")}
          className={toolbarButtonClass(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="밑줄"
          aria-label="밑줄"
          aria-pressed={editor.isActive("underline")}
          className={toolbarButtonClass(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="size-4" aria-hidden="true" />
        </button>

        <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          title="소제목"
          aria-label="소제목"
          aria-pressed={editor.isActive("heading", { level: 2 })}
          className={toolbarButtonClass(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="작은 제목"
          aria-label="작은 제목"
          aria-pressed={editor.isActive("heading", { level: 3 })}
          className={toolbarButtonClass(editor.isActive("heading", { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="size-4" aria-hidden="true" />
        </button>

        <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          title="글머리 목록"
          aria-label="글머리 목록"
          aria-pressed={editor.isActive("bulletList")}
          className={toolbarButtonClass(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="번호 목록"
          aria-label="번호 목록"
          aria-pressed={editor.isActive("orderedList")}
          className={toolbarButtonClass(editor.isActive("orderedList"))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          title="인용"
          aria-label="인용"
          aria-pressed={editor.isActive("blockquote")}
          className={toolbarButtonClass(editor.isActive("blockquote"))}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-4" aria-hidden="true" />
        </button>

        {uploadEndpoint ? (
          <>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              title="이미지 넣기"
              aria-label="이미지 넣기"
              aria-disabled={isUploading}
              className={toolbarButtonClass(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void insertImage(file)
                event.target.value = ""
              }}
            />
          </>
        ) : null}

        <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          title="서식 지우기"
          aria-label="서식 지우기"
          className={toolbarButtonClass(false)}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <RemoveFormatting className="size-4" aria-hidden="true" />
        </button>

        {isUploading ? (
          <span role="status" className="ml-2 text-[12px] text-muted-foreground">
            이미지 넣는 중…
          </span>
        ) : null}
      </div>

      <EditorContent editor={editor} />
    </div>
  )
}
