"use client"

// 개발 전용 컴포넌트 전시장 — 1주차 ③ 코어 UI 16종의 변형·상태를 한 화면에서 확인한다.
// /dev/tokens(토큰 견본)와 짝. 프로덕션 빌드에서는 404.

import { notFound } from "next/navigation"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToastProvider, useToast } from "@/components/ui/toast"

const THEME_PRESETS = [
  { themeValue: "", themeLabel: "솔 그린 (기본)" },
  { themeValue: "coral", themeLabel: "감귤 코랄" },
  { themeValue: "grape", themeLabel: "자두 그레이프" },
] as const

function DemoSection({
  sectionTitle,
  sectionNote,
  children,
}: {
  sectionTitle: string
  sectionNote?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2.5">
        <h2 className="font-heading text-[17px] font-extrabold">{sectionTitle}</h2>
        {sectionNote && (
          <span className="text-[13px] text-muted-foreground">{sectionNote}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function ToastDemoButtons() {
  const { showToast } = useToast()

  return (
    <div className="flex flex-wrap gap-2.5">
      <Button
        size="sm-44"
        onClick={() => showToast("장바구니에 담았어요")}
      >
        성공 토스트
      </Button>
      <Button
        size="sm-44"
        variant="outline"
        onClick={() =>
          showToast("재고가 2개 남았어요. 수량을 조정해 주세요", {
            toastVariant: "error",
          })
        }
      >
        오류 토스트
      </Button>
      <Button
        size="sm-44"
        variant="outline"
        onClick={() =>
          showToast("배송지가 기본 주소로 설정됐어요", { toastVariant: "info" })
        }
      >
        정보 토스트
      </Button>
      <Button
        size="sm-44"
        variant="destructive-outline"
        onClick={() =>
          showToast("상품을 삭제했어요", {
            undoAction: {
              onUndo: () => showToast("삭제를 취소했어요", { toastVariant: "info" }),
            },
          })
        }
      >
        실행취소 토스트
      </Button>
    </div>
  )
}

export default function ComponentsDemoPage() {
  if (process.env.NODE_ENV === "production") notFound()

  const [activeTheme, setActiveTheme] = React.useState("")

  const applyTheme = (themeValue: string) => {
    setActiveTheme(themeValue)
    if (themeValue) document.documentElement.dataset.theme = themeValue
    else delete document.documentElement.dataset.theme
  }

  return (
    <ToastProvider>
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 px-4 py-10 md:px-10">
        <header className="flex flex-col gap-3">
          <h1 className="font-heading text-[26px] font-extrabold">
            코어 컴포넌트 전시장
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            1주차 ③ 산출물 16종의 변형·상태 확인용 개발 페이지.{" "}
            <a href="/dev/tokens" className="font-bold text-primary underline">
              토큰 견본 →
            </a>
          </p>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="리스킨 테마 전환">
            {THEME_PRESETS.map((preset) => (
              <Button
                key={preset.themeValue}
                variant="toggle"
                size="admin-pill-36"
                aria-pressed={activeTheme === preset.themeValue}
                onClick={() => applyTheme(preset.themeValue)}
              >
                {preset.themeLabel}
              </Button>
            ))}
          </div>
        </header>

        <Separator />

        <DemoSection sectionTitle="Button" sectionNote="변형 9종 × 크기 15종 중 대표 조합">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="lg-52">결제하기</Button>
            <Button variant="primary-outline" size="md-48">장바구니 담기</Button>
            <Button variant="outline" size="md-48">배송지 변경</Button>
            <Button variant="ghost" size="md-48">취소</Button>
            <Button variant="destructive" size="md-48">삭제</Button>
            <Button variant="destructive-outline" size="md-48">반품 신청</Button>
            <Button variant="neutral-solid" size="md-48">주소 찾기</Button>
            <Button variant="soft" size="md-48">담기</Button>
            <Button size="md-48" disabled>품절</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="toggle" size="sm-46" aria-pressed>24개입 (선택됨)</Button>
            <Button variant="toggle" size="sm-46">12개입</Button>
            <Button variant="toggle" size="sm-46" disabled>선물 포장 품절</Button>
            <Button variant="primary" size="admin-42">저장</Button>
            <Button variant="outline" size="admin-38">엑셀 다운로드</Button>
          </div>
        </DemoSection>

        <DemoSection sectionTitle="Input · Textarea · Label" sectionNote="크기 프리셋 + 오류 상태(aria-invalid)">
          <div className="grid max-w-[520px] gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="demo-id" required>아이디</Label>
              <Input id="demo-id" size="auth" placeholder="아이디를 입력해 주세요" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-email">이메일</Label>
              <Input
                id="demo-email"
                size="form"
                aria-invalid
                defaultValue="parasol@"
                aria-describedby="demo-email-error"
              />
              <p id="demo-email-error" className="text-[13px] font-semibold text-destructive">
                이메일 형식이 올바르지 않아요. @ 뒤를 확인해 주세요.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="demo-memo">배송 메모</Label>
              <Textarea id="demo-memo" size="compact" placeholder="문 앞에 놓아주세요 등" />
            </div>
            <Input size="admin" placeholder="관리자 42px 인풋" />
          </div>
        </DemoSection>

        <DemoSection sectionTitle="Select" sectionNote="정렬(스토어프론트) · 폼(관리자) 프리셋">
          <div className="flex flex-wrap gap-3">
            <Select defaultValue="latest">
              <SelectTrigger selectPreset="storefrontSort" className="w-[140px]" aria-label="정렬 기준">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">최신순</SelectItem>
                <SelectItem value="price-low">낮은 가격순</SelectItem>
                <SelectItem value="price-high">높은 가격순</SelectItem>
                <SelectItem value="popular">인기순</SelectItem>
              </SelectContent>
            </Select>
            <Select>
              <SelectTrigger className="w-[220px]" aria-label="카테고리 선택">
                <SelectValue placeholder="카테고리를 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cookie">쿠키·구움과자</SelectItem>
                <SelectItem value="coffee">원두·커피</SelectItem>
                <SelectItem value="gift">선물세트</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DemoSection>

        <DemoSection sectionTitle="Badge" sectionNote="상태는 항상 색 + 텍스트 병기 (KWCAG)">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>판매중</Badge>
            <Badge badgeTone="muted">숨김</Badge>
            <Badge badgeTone="destructive">품절</Badge>
            <Badge badgeTone="primary">배송중</Badge>
            <Badge badgeTone="info">배송준비</Badge>
            <Badge badgeTone="accent">NEW</Badge>
            <Badge badgeTone="pos">+12.4%</Badge>
            <Badge badgeTone="warn">답변대기</Badge>
          </div>
        </DemoSection>

        <DemoSection sectionTitle="Card" sectionNote="default(무반응) · interactive(상승 hover)">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>통밀 오트 쿠키 세트</CardTitle>
                <CardDescription>볕든 공방 · 24개입</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-[17px] font-extrabold">₩11,700</span>
              </CardContent>
            </Card>
            <Card variant="interactive">
              <CardHeader>
                <CardTitle>인터랙티브 카드</CardTitle>
                <CardDescription>hover 시 상승 + 테두리 강조</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                인덱스·이야기 카드 계열
              </CardContent>
            </Card>
          </div>
        </DemoSection>

        <DemoSection sectionTitle="Tabs" sectionNote="underline(상품상세) · pill-admin(관리자 필터)">
          <Tabs defaultValue="detail">
            <TabsList variant="underline">
              <TabsTrigger value="detail">상세설명</TabsTrigger>
              <TabsTrigger value="review">리뷰</TabsTrigger>
              <TabsTrigger value="qna">문의</TabsTrigger>
              <TabsTrigger value="shipping">배송안내</TabsTrigger>
            </TabsList>
            <TabsContent value="detail" className="py-4 text-sm text-muted-foreground">
              상세설명 탭 콘텐츠 (키보드 ←/→ 로 탭 이동)
            </TabsContent>
            <TabsContent value="review" className="py-4 text-sm text-muted-foreground">리뷰 탭</TabsContent>
            <TabsContent value="qna" className="py-4 text-sm text-muted-foreground">문의 탭</TabsContent>
            <TabsContent value="shipping" className="py-4 text-sm text-muted-foreground">배송안내 탭</TabsContent>
          </Tabs>
          <Tabs defaultValue="all">
            <TabsList variant="pill-admin">
              <TabsTrigger value="all">전체</TabsTrigger>
              <TabsTrigger value="paid">결제완료</TabsTrigger>
              <TabsTrigger value="shipping">배송중</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="pt-2 text-sm text-muted-foreground">전체 목록</TabsContent>
            <TabsContent value="paid" className="pt-2 text-sm text-muted-foreground">결제완료 목록</TabsContent>
            <TabsContent value="shipping" className="pt-2 text-sm text-muted-foreground">배송중 목록</TabsContent>
          </Tabs>
        </DemoSection>

        <DemoSection sectionTitle="Table" sectionNote="관리자 목록 규격">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품명</TableHead>
                <TableHead>재고</TableHead>
                <TableHead>상태</TableHead>
                <TableHead className="text-right">가격</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>통밀 오트 쿠키 세트</TableCell>
                <TableCell>128</TableCell>
                <TableCell><Badge>판매중</Badge></TableCell>
                <TableCell className="text-right">₩11,700</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>수제 딸기잼</TableCell>
                <TableCell>0</TableCell>
                <TableCell><Badge badgeTone="destructive">품절</Badge></TableCell>
                <TableCell className="text-right">₩8,900</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DemoSection>

        <DemoSection sectionTitle="Dialog · Sheet" sectionNote="파괴적 동작만 확인 모달, ESC·포커스 트랩 내장">
          <div className="flex flex-wrap gap-2.5">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive-outline" size="md-48">삭제 확인 모달</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>상품을 삭제할까요?</DialogTitle>
                  <DialogDescription>
                    이 상품을 장바구니에서 삭제합니다. 삭제 후 실행취소 토스트로 되돌릴 수 있어요.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" size="md-48" className="flex-1">취소</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive" size="md-48" className="flex-1">삭제</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="md-48">바텀시트 (옵션 선택)</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>옵션 선택</SheetTitle>
                  <SheetDescription>구성을 선택해 주세요</SheetDescription>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-2">
                  <Button variant="toggle" size="sm-46" aria-pressed>24개입 세트 ₩11,700</Button>
                  <Button variant="toggle" size="sm-46">12개입 ₩6,500</Button>
                </SheetBody>
                <SheetFooter>
                  <Button size="lg-52" className="w-full">장바구니 담기</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="md-48">좌측 드로어 (모바일 GNB)</Button>
              </SheetTrigger>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>메뉴</SheetTitle>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-3 text-[15px] font-bold">
                  <span>쿠키·구움과자</span>
                  <span>원두·커피</span>
                  <span>선물세트</span>
                </SheetBody>
              </SheetContent>
            </Sheet>
          </div>
        </DemoSection>

        <DemoSection sectionTitle="Toast" sectionNote="4종 · 자동 소멸 2.6s(실행취소 4s) · hover/포커스 시 정지">
          <ToastDemoButtons />
        </DemoSection>

        <DemoSection sectionTitle="Skeleton · Spinner" sectionNote="로딩 상태">
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex w-[280px] gap-3">
              <Skeleton className="size-16 shrink-0" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Spinner />
              <span className="text-xs text-muted-foreground">불러오는 중…</span>
            </div>
          </div>
        </DemoSection>

        <DemoSection sectionTitle="EmptyState" sectionNote="오류·빈 상태 공통 골격 (section 티어)">
          <EmptyState
            size="section"
            stateTone="brand"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
                <path d="M9 7V5a3 3 0 0 1 6 0v2" />
              </svg>
            }
            title="장바구니가 비어 있어요"
            description="마음에 드는 상품을 담아보세요. 3만원 이상 구매 시 무료배송이에요."
            actions={[{ label: "상품 보러 가기", actionVariant: "primary" }]}
          />
        </DemoSection>
      </div>
    </ToastProvider>
  )
}
