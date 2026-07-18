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

  it("deduplicates paragraph display values but keeps the response count", () => {
    const summary = summarizeQuestion(
      question({ type: "paragraph", rawType: 1 }),
      responses(["같은 문장", "같은 문장", "다른 문장"]),
    );

    expect(summary).toEqual({
      kind: "text_list",
      responseCount: 3,
      values: ["같은 문장", "다른 문장"],
    });
  });
});
