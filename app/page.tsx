import type { Metadata } from "next";
import { Workbench } from "./components/workbench";

export const metadata: Metadata = {
  title: "Google Forms 응답 테스트",
  description: "Google Forms 구조 분석, 가상 응답 생성 및 제출 테스트 도구",
};

export default function Home() {
  return <Workbench />;
}
