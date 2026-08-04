"use client"

// 1:1 문의 화면 — '문의하기 / 문의 내역' 탭.
// 핸드오프 목업의 탭 구조 복원(내역 화면이 없던 동안 작성 전용으로 줄여 뒀었다).

import * as React from "react"

import { QnaForm } from "@/components/store/qna-form"
import { QnaHistory } from "@/components/store/qna-history"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type QnaViewProps = {
  qnaTypeOptions: { code: string; name: string }[]
  /** null = 비회원 — 폼은 게스트 3종 입력, 내역은 연락처+비밀번호 확인 */
  memberName: string | null
}

export function QnaView({ qnaTypeOptions, memberName }: QnaViewProps) {
  return (
    <Tabs defaultValue="write">
      <TabsList variant="underline" aria-label="1:1 문의">
        <TabsTrigger value="write">문의하기</TabsTrigger>
        <TabsTrigger value="history">문의 내역</TabsTrigger>
      </TabsList>

      <TabsContent value="write" className="pt-5">
        <QnaForm qnaTypeOptions={qnaTypeOptions} memberName={memberName} />
      </TabsContent>

      <TabsContent value="history" className="pt-5">
        <QnaHistory isMember={memberName !== null} />
      </TabsContent>
    </Tabs>
  )
}
