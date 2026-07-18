import { describe, expect, it } from "vitest";
import { FormImportError } from "../lib/adapters/google-forms/errors";
import {
  extractPublicLoadData,
  parseGoogleFormHtml,
} from "../lib/adapters/google-forms/parser";
import { validateGoogleFormUrl } from "../lib/adapters/google-forms/url-policy";
import { advancedGoogleFormsFixtureHtml } from "./fixtures/google-forms-advanced";

const option = (label: string, other = false) => [label, null, null, null, other ? 1 : 0];

function singleGridEntry(entryId: number, row: string) {
  const entry: unknown[] = [entryId, [option("열 A"), option("열 B")], 1, [row]];
  entry[11] = [0];
  return entry;
}

function fixtureHtml() {
  const formData: unknown[] = [];
  formData[0] = "fixture description";
  formData[1] = [
    [100, "[섹션 1: 기본] 첫 질문", null, 2, [[200, [option("A"), option("B"), option("", true)], 1]]],
    [101, "두 번째 섹션", "section description", 8, null],
    [102, "척도", null, 5, [[201, [option("1"), option("2"), option("3")], 0, ["낮음", "높음"]]]],
    [
      103,
      "그리드",
      null,
      7,
      [
        singleGridEntry(301, "행 A"),
        singleGridEntry(302, "행 B"),
      ],
    ],
    [104, "별점", null, 18, [[202, [option("1"), option("2"), option("3")], 0]]],
    [105, "새 유형", null, 77, [[203, null, 0]]],
  ];
  formData[8] = "Fixture Form";
  const payload: unknown[] = [];
  payload[1] = formData;
  payload[3] = "Document title";
  payload[14] = "e/example";
  return `<html lang="ko"><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script></html>`;
}

describe("Google Forms public payload parser", () => {
  it("extracts a balanced JSON array even when strings contain brackets", () => {
    const html = '<script>var FB_PUBLIC_LOAD_DATA_ = [null,["text ] ; [ ok"]];</script>';
    expect(extractPublicLoadData(html)[1]).toEqual(["text ] ; [ ok"]);
  });

  it("normalizes sections, entry ids, Other, scale, grid, rating, and unknown types", () => {
    const form = parseGoogleFormHtml({
      html: fixtureHtml(),
      requestedUrl: "https://docs.google.com/forms/d/e/example/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/example/viewform",
      publicId: "example",
      fetchedAt: "2026-07-18T00:00:00.000Z",
    });

    expect(form.title).toBe("Fixture Form");
    expect(form.sections).toHaveLength(2);
    expect(form.sections[0].title).toBe("섹션 1: 기본");
    expect(form.questions).toHaveLength(5);

    const choice = form.questions[0];
    expect(choice.entryIds).toEqual(["200"]);
    expect(choice.required).toBe(true);
    expect(choice.options.at(-1)).toMatchObject({ label: "기타", isOther: true });

    expect(form.questions[1].scale).toEqual({
      min: 1,
      max: 3,
      lowLabel: "낮음",
      highLabel: "높음",
    });
    expect(form.questions[2].grid).toMatchObject({
      rows: [{ id: "301", label: "행 A" }, { id: "302", label: "행 B" }],
      columns: [{ label: "열 A" }, { label: "열 B" }],
      binding: "google_internal_row_ids",
    });
    expect(form.questions[3].type).toBe("rating");
    expect(form.questions[4].type).toBe("unknown");
    expect(form.diagnostics.unsupportedQuestionCount).toBe(1);
  });

  it("preserves the verified 23-question fixture and ordered non-response content", () => {
    const form = parseGoogleFormHtml({
      html: advancedGoogleFormsFixtureHtml(),
      requestedUrl: "https://docs.google.com/forms/d/e/advanced/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/advanced/viewform",
      publicId: "advanced",
      fetchedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(form.title).toBe("Advanced Fixture Form");
    expect(form.questions).toHaveLength(23);
    expect(form.items).toHaveLength(29);
    expect(form.sections).toHaveLength(4);
    expect(form.items?.map((item) => item.kind)).toEqual([
      "question",
      "question",
      "question",
      "text_block",
      "video",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "question",
      "image",
      "question",
      "section",
      "question",
      "section",
      "question",
      "section",
      "question",
    ]);
    expect(form.diagnostics).toMatchObject({
      unsupportedQuestionCount: 0,
      skippedItems: [],
    });
  });

  it("normalizes validation, media, rating, date/time, grid, navigation, and submission metadata", () => {
    const form = parseGoogleFormHtml({
      html: advancedGoogleFormsFixtureHtml(),
      requestedUrl: "https://docs.google.com/forms/d/e/advanced/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/advanced/viewform",
      publicId: "advanced",
    });
    const byItemId = new Map(form.questions.map((question) => [question.itemId, question]));

    expect(byItemId.get("101")?.validations).toEqual([
      {
        kind: "number_range",
        operator: "between",
        min: 1,
        max: 120,
        errorMessage: "1~120만 입력하세요.",
        rawCategory: 1,
        rawOperator: 7,
      },
    ]);
    expect(byItemId.get("102")?.validations).toEqual([
      {
        kind: "text_length",
        operator: "min",
        value: 20,
        errorMessage: "20자 이상 입력하세요.",
        rawCategory: 6,
        rawOperator: 203,
      },
    ]);
    expect(byItemId.get("108")?.validations).toEqual([
      {
        kind: "selection_count",
        operator: "min",
        value: 2,
        errorMessage: "2개 이상",
        rawCategory: 7,
        rawOperator: 200,
      },
    ]);

    const imageChoice = byItemId.get("103")!;
    expect(imageChoice.options.slice(0, 2).map((option) => option.image)).toEqual([
      expect.objectContaining({
        sourceId: "option-image-one",
        url: "https://docs.google.com/forms-images-rt/option-one=w260",
        width: 260,
        height: 461,
      }),
      expect.objectContaining({
        sourceId: "option-image-two",
        url: "https://docs.google.com/forms-images-rt/option-two=w260",
        width: 260,
        height: 461,
      }),
    ]);
    const standalone = form.items?.find((item) => item.kind === "image");
    expect(standalone).toMatchObject({
      kind: "image",
      title: "독립 이미지",
      image: {
        sourceId: "standalone-image",
        url: "https://docs.google.com/forms-images-rt/standalone=w2252",
        altText: "독립 이미지 대체 텍스트",
        width: 2252,
        height: 4000,
        alignment: 0,
      },
    });
    expect(byItemId.get("122")?.images).toEqual([
      expect.objectContaining({
        sourceId: "question-image",
        url: "https://docs.google.com/forms-images-rt/question=w740",
        altText: "문항 이미지 대체 텍스트",
      }),
    ]);
    expect(form.items?.find((item) => item.kind === "video")).toMatchObject({
      kind: "video",
      video: {
        provider: "youtube",
        videoId: "jNQXAC9IVRw",
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        width: 320,
        height: 180,
      },
    });

    expect(byItemId.get("110")?.scale).toEqual({
      min: 0,
      max: 10,
      lowLabel: null,
      highLabel: null,
    });
    expect(byItemId.get("112")?.rating).toEqual({ icon: "star", min: 1, max: 5 });
    expect(byItemId.get("113")?.rating).toEqual({ icon: "heart", min: 1, max: 10 });
    expect(byItemId.get("114")?.rating).toEqual({ icon: "thumbs_up", min: 1, max: 3 });

    expect(byItemId.get("115")).toMatchObject({
      type: "grid_single",
      entryIds: ["2151", "2152", "2153"],
      grid: {
        mode: "single",
        requireResponsePerRow: true,
        limitOneResponsePerColumn: true,
        rows: [
          { id: "2151", entryId: "2151", label: "행 1", required: true },
          { id: "2152", entryId: "2152", label: "행 2", required: true },
          { id: "2153", entryId: "2153", label: "행 3", required: true },
        ],
      },
    });
    expect(byItemId.get("117")).toMatchObject({
      type: "grid_checkbox",
      grid: {
        mode: "multiple",
        requireResponsePerRow: true,
        limitOneResponsePerColumn: false,
      },
    });
    expect(byItemId.get("118")?.date).toEqual({ includeYear: false, includeTime: false });
    expect(byItemId.get("119")?.date).toEqual({ includeYear: true, includeTime: true });
    expect(byItemId.get("120")?.time).toEqual({ kind: "time_of_day" });
    expect(byItemId.get("121")?.time).toEqual({ kind: "duration" });

    expect(byItemId.get("125")?.options.map((option) => option.branchTarget)).toEqual([
      { kind: "section", sectionItemId: "126" },
      { kind: "section", sectionItemId: "128" },
    ]);
    expect(form.sections.map((section) => section.navigation)).toEqual([
      { kind: "next" },
      { kind: "next" },
      { kind: "submit" },
      { kind: "next" },
    ]);
    expect(form.sections[2].questionIds).toEqual(["question-127"]);
    expect(form.sections[3].questionIds).toEqual(["question-129"]);

    expect(form.submission).toEqual({
      actionUrl: "https://docs.google.com/forms/d/e/advanced/formResponse",
      fvv: "1",
      fbzx: "fixture-seed",
      pageHistory: "0",
      partialResponse: '[null,null,"fixture-seed"]',
    });
  });

  it("fails closed when the internal payload marker is absent", () => {
    expect(() => extractPublicLoadData("<html></html>")).toThrowError(FormImportError);
  });

  it("fails recognized but malformed questions closed and excludes duplicate entry ids", () => {
    const formData: unknown[] = [];
    formData[1] = [
      [1, "첫 선택", null, 2, [[500, [option("A")], 1]]],
      [2, "중복 단답", null, 0, [[500, null, 0]]],
      [3, "선택지 없는 선택", null, 2, [[501, [], 1]]],
      [4, "정상 단답", null, 0, [[502, null, 0]]],
    ];
    formData[8] = "Malformed Fixture";
    const payload: unknown[] = [];
    payload[1] = formData;

    const form = parseGoogleFormHtml({
      html: `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script>`,
      requestedUrl: "https://docs.google.com/forms/d/e/example/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/example/viewform",
      publicId: "example",
    });

    expect(form.questions.map((question) => question.type)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "short_text",
    ]);
    expect(form.diagnostics.unsupportedQuestionCount).toBe(3);
    expect(form.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("내부 구조"),
        expect.stringContaining("중복 입력 ID"),
      ]),
    );
  });

  it("fails unsupported validation, malformed date, inconsistent grid mode, and invalid branch targets closed", () => {
    const firstGridEntry: unknown[] = [603, [option("A")], 1, ["행 1"]];
    firstGridEntry[11] = [0];
    const secondGridEntry: unknown[] = [604, [option("A")], 1, ["행 2"]];
    secondGridEntry[11] = [1];
    const malformedDateEntry: unknown[] = [602, null, 0];
    malformedDateEntry[7] = [2, 1];
    const formData: unknown[] = [];
    formData[1] = [
      [1, "지원하지 않는 검증", null, 0, [[601, null, 1, null, [[99, 99, ["1"]]]]]],
      [2, "잘못된 날짜", null, 9, [malformedDateEntry]],
      [3, "혼합 그리드", null, 7, [firstGridEntry, secondGridEntry]],
      [4, "없는 섹션 분기", null, 2, [[605, [["A", null, 999, null, 0]], 1]]],
    ];
    formData[8] = "Fail Closed Fixture";
    const payload: unknown[] = [];
    payload[1] = formData;

    const form = parseGoogleFormHtml({
      html: `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script>`,
      requestedUrl: "https://docs.google.com/forms/d/e/example/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/example/viewform",
      publicId: "example",
    });

    expect(form.questions.map((question) => question.type)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(form.diagnostics.unsupportedQuestionCount).toBe(4);
    expect(form.diagnostics.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("내부 구조"),
        expect.stringContaining("분기 또는 섹션 이동"),
      ]),
    );
  });

  it("skips file upload explicitly without treating content blocks as questions", () => {
    const formData: unknown[] = [];
    formData[1] = [
      [10, "업로드", null, 13, [[700, null, 1]]],
      [11, "설명", "콘텐츠", 6, null],
      [12, "정상 단답", null, 0, [[701, null, 0]]],
    ];
    formData[8] = "Upload Fixture";
    const payload: unknown[] = [];
    payload[1] = formData;

    const form = parseGoogleFormHtml({
      html: `<script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script>`,
      requestedUrl: "https://docs.google.com/forms/d/e/example/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/example/viewform",
      publicId: "example",
    });

    expect(form.questions).toHaveLength(1);
    expect(form.items?.map((item) => item.kind)).toEqual(["text_block", "question"]);
    expect(form.diagnostics.unsupportedQuestionCount).toBe(0);
    expect(form.diagnostics.skippedItems).toEqual([
      { itemId: "10", rawType: 13, title: "업로드", reason: "file_upload" },
    ]);
    expect(form.diagnostics.warnings).toContain(
      "1개 파일 업로드 문항은 명시적으로 제외했습니다.",
    );
  });

  it("leaves media URLs empty when rendered images cannot be paired unambiguously", () => {
    const formData: unknown[] = [];
    formData[1] = [
      [
        1,
        "이미지 선택",
        null,
        2,
        [[801, [["A", null, null, null, 0, ["source-a", null, [260, 400, 0]]]], 0]],
      ],
    ];
    formData[8] = "Media Mismatch";
    const payload: unknown[] = [];
    payload[1] = formData;
    const html = `<img src="https://docs.google.com/forms-images-rt/first=w260"><img src="https://docs.google.com/forms-images-rt/second=w260"><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(payload)};</script>`;

    const form = parseGoogleFormHtml({
      html,
      requestedUrl: "https://docs.google.com/forms/d/e/example/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/example/viewform",
      publicId: "example",
    });

    expect(form.questions[0].options[0].image?.url).toBeNull();
    expect(form.diagnostics.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("렌더링 URL")]),
    );
  });
});

describe("Google Forms URL policy", () => {
  it("accepts responder and short links", () => {
    expect(validateGoogleFormUrl("https://docs.google.com/forms/d/e/abc_123/viewform").kind).toBe("public_form");
    expect(validateGoogleFormUrl("https://forms.gle/abc123").kind).toBe("short_link");
  });

  it("rejects non-Google and lookalike hosts", () => {
    expect(() => validateGoogleFormUrl("https://docs.google.com.evil.example/forms/d/e/id/viewform")).toThrowError(FormImportError);
    expect(() => validateGoogleFormUrl("http://docs.google.com/forms/d/e/id/viewform")).toThrowError(FormImportError);
    expect(() => validateGoogleFormUrl("https://docs.google.com:444/forms/d/e/id/viewform")).toThrowError(FormImportError);
  });

  it("strips prefill query parameters and fragments", () => {
    const validated = validateGoogleFormUrl(
      "https://docs.google.com/forms/d/e/id/viewform?entry.123=person%40example.com#response=1",
    );
    expect(validated.url.search).toBe("");
    expect(validated.url.hash).toBe("");
  });
});
