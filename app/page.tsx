import type { Metadata } from "next";
import { Workbench } from "./components/workbench";

export const metadata: Metadata = {
  title: "FormSwarm — Google Forms 응답 설계 랩",
  description: "Google Forms 구조를 읽어 문항별 생성 규칙과 가상 응답 미리보기를 구성합니다.",
};

export default function Home() {
  return <Workbench />;
}
