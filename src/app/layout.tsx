import type { Metadata } from "next";
import { fontBody, fontDisplay, fontDisplayGrape } from "./fonts";
import "./globals.css";
import { DemoNotice } from "@/components/layout/DemoNotice";
import { TRPCReactProvider } from "@/trpc/client";

export const metadata: Metadata = {
  title: "PaRaSOL",
  description: "장애인 생산품 브랜드 커머스 — PaRaSOL",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontDisplayGrape.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* 스토어·관리자 모든 화면 위에 붙도록 루트에 둔다 */}
        <DemoNotice />
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
