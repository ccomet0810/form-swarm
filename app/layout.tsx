import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Google Forms 응답 테스트",
  description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
