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
      url: "/og-brutalist-v2.png",
      width: 1_672,
      height: 941,
      alt: "FormSwarm 흑백 브루탈리즘 분석 및 응답 미리보기 화면",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Google Forms 응답 테스트",
    description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
    images: ["/og-brutalist-v2.png"],
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
