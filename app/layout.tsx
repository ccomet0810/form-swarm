import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://form-swarm.ccomet.chatgpt.site"),
  title: "FORM SWARM — Google Forms 응답 테스트",
  description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
  openGraph: {
    title: "FORM SWARM — Google Forms 응답 테스트",
    description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
    images: [{
      url: "/og-form-swarm.png",
      width: 1_672,
      height: 941,
      alt: "FORM SWARM 흑백 브루탈리즘 워드마크와 폼 분석 패널",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FORM SWARM — Google Forms 응답 테스트",
    description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
    images: ["/og-form-swarm.png"],
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
