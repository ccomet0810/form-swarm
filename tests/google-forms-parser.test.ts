import { describe, expect, it } from "vitest";
import { FormImportError } from "../lib/adapters/google-forms/errors";
import {
  extractPublicLoadData,
  parseGoogleFormHtml,
} from "../lib/adapters/google-forms/parser";
import { validateGoogleFormUrl } from "../lib/adapters/google-forms/url-policy";

const option = (label: string, other = false) => [label, null, null, null, other ? 1 : 0];

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
        [301, [option("열 A"), option("열 B")], 1, ["행 A"]],
        [302, [option("열 A"), option("열 B")], 1, ["행 B"]],
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

    expect(form.questions[1].scale).toEqual({ lowLabel: "낮음", highLabel: "높음" });
    expect(form.questions[2].grid).toMatchObject({
      rows: [{ id: "301", label: "행 A" }, { id: "302", label: "행 B" }],
      columns: [{ label: "열 A" }, { label: "열 B" }],
      binding: "google_internal_row_ids",
    });
    expect(form.questions[3].type).toBe("rating");
    expect(form.questions[4].type).toBe("unknown");
    expect(form.diagnostics.unsupportedQuestionCount).toBe(1);
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
