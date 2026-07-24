import type { Metadata } from "next";
import { fontBody, fontDisplay, fontDisplayGrape } from "./fonts";
import "./globals.css";

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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
