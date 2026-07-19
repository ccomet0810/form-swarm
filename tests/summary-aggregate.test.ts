import { describe, expect, it } from "vitest";
import type { FormQuestion, GeneratedResponse } from "../lib/domain/form-schema";
import { summarizeQuestion } from "../lib/summary/aggregate";

function question(overrides: Partial<FormQuestion>): FormQuestion {
  return {
    id: "question-1",
    itemId: "1",
    entryIds: ["10"],
    sectionId: "section-1",
    index: 0,
    title: "질문",
    description: null,
    type: "single_choice",
    required: false,
    options: [],
    rawType: 2,
    ...overrides,
  };
}

function responses(
  values: Array<GeneratedResponse["answers"][string] | undefined>,
): GeneratedResponse[] {
  return values.map((value, index) => {
    const answers: GeneratedResponse["answers"] = {};
    if (value !== undefined) answers["question-1"] = value;
    return { id: `response-${index}`, index, answers };
  });
}

describe("Google-style response summaries", () => {
  it("keeps zero-count radio options in a pie summary", () => {
    const summary = summarizeQuestion(
      question({
        options: [
          { label: "A", value: "A", isOther: false },
          { label: "B", value: "B", isOther: false },
          { label: "C", value: "C", isOther: false },
        ],
      }),
      responses(["A", "A", "B", undefined]),
    );

    expect(summary).toMatchObject({
      kind: "pie",
      responseCount: 3,
      values: [
        { label: "A", count: 2 },
        { label: "B", count: 1 },
        { label: "C", count: 0 },
      ],
    });
  });

  it("groups matching free-text Other answers into pie slices", () => {
    const summary = summarizeQuestion(
      question({
        options: [
          { label: "A", value: "A", isOther: false },
          { label: "기타", value: "__other__", isOther: true },
        ],
      }),
      responses(["A", "직접 입력 A", "직접 입력 A", "직접 입력 B"]),
    );

    expect(summary).toMatchObject({
      kind: "pie",
      responseCount: 4,
      values: [
        { label: "A", count: 1, percentage: 25 },
        { label: "직접 입력 A", count: 2, percentage: 50 },
        { label: "직접 입력 B", count: 1, percentage: 25 },
      ],
    });
  });

  it("uses question respondents as the checkbox percentage denominator", () => {
    const summary = summarizeQuestion(
      question({
        type: "checkboxes",
        rawType: 4,
        options: [
          { label: "A", value: "A", isOther: false },
          { label: "B", value: "B", isOther: false },
        ],
      }),
      responses([["A", "B"], ["A"], undefined]),
    );

    expect(summary).toMatchObject({
      kind: "horizontal_bars",
      responseCount: 2,
      values: [
        { label: "A", count: 2, percentage: 100 },
        { label: "B", count: 1, percentage: 50 },
      ],
    });
  });

  it("includes free-text Other answers in checkbox bars", () => {
    const summary = summarizeQuestion(
      question({
        type: "checkboxes",
        rawType: 4,
        options: [
          { label: "A", value: "A", isOther: false },
          { label: "기타", value: "__other__", isOther: true },
        ],
      }),
      responses([["A", "직접 입력 A"], ["직접 입력 B"]]),
    );

    expect(summary).toMatchObject({
      kind: "horizontal_bars",
      responseCount: 2,
      values: [
        { label: "A", count: 1, percentage: 50 },
        { label: "직접 입력 A", count: 1, percentage: 50 },
        { label: "직접 입력 B", count: 1, percentage: 50 },
      ],
    });
  });

  it("keeps every paragraph response, including duplicate text", () => {
    const summary = summarizeQuestion(
      question({ type: "paragraph", rawType: 1 }),
      responses(["같은 문장", "같은 문장", "다른 문장"]),
    );

    expect(summary).toEqual({
      kind: "text_list",
      responseCount: 3,
      values: ["같은 문장", "같은 문장", "다른 문장"],
    });
  });

  it("keeps an unconstrained short answer as a raw text list", () => {
    const summary = summarizeQuestion(
      question({ type: "short_text", rawType: 0 }),
      responses(["10", "2", "2"]),
    );

    expect(summary).toEqual({
      kind: "text_list",
      responseCount: 3,
      values: ["10", "2", "2"],
    });
  });

  it("groups and numerically sorts a number-validated short answer", () => {
    const summary = summarizeQuestion(
      question({
        type: "short_text",
        rawType: 0,
        validations: [{
          kind: "number_range",
          operator: "between",
          min: 1,
          max: 120,
          errorMessage: null,
          rawCategory: 1,
          rawOperator: 7,
        }],
      }),
      responses(["10", "2", "2.0", "1"]),
    );

    expect(summary).toEqual({
      kind: "vertical_bars",
      responseCount: 4,
      values: [
        { label: "1", count: 1, percentage: 25 },
        { label: "2", count: 2, percentage: 50 },
        { label: "10", count: 1, percentage: 25 },
      ],
    });
  });

  it("does not count recursively empty temporal objects as responses", () => {
    const summary = summarizeQuestion(
      question({
        type: "date",
        rawType: 9,
        date: { includeYear: true, includeTime: false },
      }),
      responses([
        { year: "", month: "", day: "" },
        "2026-11-1",
        "2026-7-2",
        { year: "2026", month: "07", day: "02" },
      ]),
    );

    expect(summary).toEqual({
      kind: "temporal",
      responseCount: 3,
      values: [
        { label: "2026-07-02", count: 2, percentage: 66.7 },
        { label: "2026-11-01", count: 1, percentage: 33.3 },
      ],
    });
  });

  it("sorts time durations numerically without wrapping after 24 hours", () => {
    const summary = summarizeQuestion(
      question({
        type: "time",
        rawType: 10,
        time: { kind: "duration" },
      }),
      responses(["25:2:3", "3:00:00", "25:02:03"]),
    );

    expect(summary).toEqual({
      kind: "temporal",
      responseCount: 3,
      values: [
        { label: "3:00:00", count: 1, percentage: 33.3 },
        { label: "25:02:03", count: 2, percentage: 66.7 },
      ],
    });
  });

  it("uses each grid row's answered count as its percentage denominator", () => {
    const summary = summarizeQuestion(
      question({
        type: "grid_checkbox",
        rawType: 8,
        grid: {
          rows: [
            { id: "row-a", label: "행 A" },
            { id: "row-b", label: "행 B" },
          ],
          columns: [
            { id: "column-a", label: "열 A" },
            { id: "column-b", label: "열 B" },
          ],
          binding: "google_internal_row_ids",
          mode: "multiple",
        },
      }),
      responses([
        { "row-a": "열 A", "row-b": "열 B" },
        { "row-a": "열 B" },
        { "row-b": ["열 A", "열 B"] },
      ]),
    );

    expect(summary).toEqual({
      kind: "grid",
      responseCount: 3,
      rows: [
        {
          label: "행 A",
          answeredCount: 2,
          values: [
            { label: "열 A", count: 1, percentage: 50 },
            { label: "열 B", count: 1, percentage: 50 },
          ],
        },
        {
          label: "행 B",
          answeredCount: 2,
          values: [
            { label: "열 A", count: 1, percentage: 50 },
            { label: "열 B", count: 2, percentage: 100 },
          ],
        },
      ],
    });
  });

  it("keeps zero-count scale points in form order and averages ratings", () => {
    const summary = summarizeQuestion(
      question({
        type: "rating",
        rawType: 18,
        options: ["1", "2", "3", "4", "5"].map((label) => ({
          label,
          value: label,
          isOther: false,
        })),
        rating: { icon: "star", min: 1, max: 5 },
      }),
      responses(["2", "4", "4"]),
    );

    expect(summary).toMatchObject({
      kind: "vertical_bars",
      responseCount: 3,
      average: 10 / 3,
      values: [
        { label: "1", count: 0 },
        { label: "2", count: 1 },
        { label: "3", count: 0 },
        { label: "4", count: 2 },
        { label: "5", count: 0 },
      ],
    });
  });
});
