import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://form-swarm.ccomet.chatgpt.site"),
  title: "Google Forms 응답 테스트",
  description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
  openGraph: {
    title: "Google Forms 응답 테스트",
    description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
    images: [{
      url: "/og-functional.png",
      width: 1_672,
      height: 941,
      alt: "설문 문항을 응답 그래프로 변환하는 기능 흐름",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Google Forms 응답 테스트",
    description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
    images: ["/og-functional.png"],
  },
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
