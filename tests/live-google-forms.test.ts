import { describe, expect, it } from "vitest";
import { importGoogleForm } from "../lib/application/import-google-form";

const LIVE = process.env.LIVE_GOOGLE_FORMS_TEST === "1";
const FORM_ONE = "https://docs.google.com/forms/d/e/1FAIpQLSeoFC1jW6yqDNDx-RbAam_GfT7kBgrKwVDMFa9-wUEfFlDTdA/viewform";
const FORM_TWO = "https://docs.google.com/forms/d/e/1FAIpQLSf4Wnw-bPB2CLK1Aj-YBXS1kZoZFiUEzWNjRmKNZjali6c85g/viewform";

describe.skipIf(!LIVE)("read-only live Google Forms fixtures", () => {
  it("parses the onboarding form including grid and rating", async () => {
    const form = await importGoogleForm(FORM_ONE);
    expect(form.title).toBe("신입 사원 온보딩 경험 평가");
    expect(form.sections).toHaveLength(3);
    expect(form.questions).toHaveLength(9);
    expect(form.questions.filter((question) => question.required)).toHaveLength(0);
    expect(form.questions.some((question) => question.type === "grid_single")).toBe(true);
    expect(form.questions.some((question) => question.type === "rating")).toBe(true);
    expect(form.questions.flatMap((question) => question.entryIds)).toContain("585198299");
  }, 20_000);

  it("parses the handwriting survey including cover page, Other, and required flags", async () => {
    const form = await importGoogleForm(FORM_TWO);
    expect(form.title).toBe("AI 기반 손글씨 폰트 생성 서비스 설문 조사");
    expect(form.sections).toHaveLength(6);
    expect(form.sections[0].questionIds).toHaveLength(0);
    expect(form.questions).toHaveLength(13);
    expect(form.questions.filter((question) => question.required)).toHaveLength(8);
    expect(form.questions.filter((question) => question.type === "single_choice")).toHaveLength(6);
    expect(form.questions.filter((question) => question.type === "checkboxes")).toHaveLength(5);
    expect(form.questions.some((question) => question.options.some((option) => option.isOther))).toBe(true);
    expect(form.questions.flatMap((question) => question.entryIds)).toContain("1766287717");
  }, 20_000);
});
