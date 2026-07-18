import { describe, expect, it } from "vitest";
import type {
  FormQuestion,
  GenerationRule,
  ImportedForm,
} from "../lib/domain/form-schema";
import { generateResponses } from "../lib/generator/engine";
import { createDefaultRules } from "../lib/generator/rules";
import { validateGeneratedResponse } from "../lib/generator/validation";

function question(
  value: Partial<FormQuestion> & Pick<FormQuestion, "id" | "type" | "sectionId">,
): FormQuestion {
  const { id, type, sectionId, ...rest } = value;
  return {
    id,
    itemId: value.itemId ?? id.replace("q", "item"),
    entryIds: value.entryIds ?? [id.replace("q", "entry")],
    sectionId,
    index: value.index ?? 0,
    title: value.title ?? id,
    description: null,
    type,
    required: value.required ?? true,
    options: value.options ?? [],
    rawType: value.rawType ?? 0,
    ...rest,
  };
}

const advancedForm = {
  schemaVersion: "1.0",
  parserVersion: "advanced-test",
  source: {
    requestedUrl: "https://docs.google.com/forms/d/e/advanced/viewform",
    canonicalUrl: "https://docs.google.com/forms/d/e/advanced/viewform",
    publicId: "advanced",
    fetchedAt: "2026-07-19T00:00:00.000Z",
  },
  title: "Advanced generator fixture",
  description: null,
  locale: "ko",
  sections: [
    {
      id: "section-1",
      itemId: null,
      index: 0,
      title: "기본",
      description: null,
      questionIds: [
        "q-number",
        "q-checkbox",
        "q-grid-single",
        "q-grid-checkbox",
        "q-date",
        "q-date-time",
        "q-time",
        "q-duration",
        "q-branch",
      ],
    },
    {
      id: "section-a",
      itemId: "section-item-a",
      index: 1,
      title: "A",
      description: null,
      questionIds: ["q-a"],
      navigation: { kind: "submit" },
    },
    {
      id: "section-b",
      itemId: "section-item-b",
      index: 2,
      title: "B",
      description: null,
      questionIds: ["q-b"],
      navigation: { kind: "submit" },
    },
  ],
  questions: [
    question({
      id: "q-number",
      type: "short_text",
      sectionId: "section-1",
      validations: [
        {
          kind: "number_range",
          operator: "between",
          min: 1,
          max: 120,
          errorMessage: null,
          rawCategory: 1,
          rawOperator: 7,
        },
      ],
    }),
    question({
      id: "q-checkbox",
      type: "checkboxes",
      sectionId: "section-1",
      options: [
        { label: "X", value: "X", isOther: false },
        { label: "Y", value: "Y", isOther: false },
        { label: "Z", value: "Z", isOther: false },
        { label: "기타", value: "__other__", isOther: true },
      ],
      validations: [
        {
          kind: "selection_count",
          operator: "min",
          value: 2,
          errorMessage: null,
          rawCategory: 7,
          rawOperator: 200,
        },
      ],
    }),
    question({
      id: "q-grid-single",
      type: "grid_single",
      sectionId: "section-1",
      entryIds: ["row-entry-1", "row-entry-2"],
      grid: {
        rows: [
          { id: "r1", label: "행 1", entryId: "row-entry-1", required: true },
          { id: "r2", label: "행 2", entryId: "row-entry-2", required: true },
        ],
        columns: [
          { id: "c1", label: "열 1" },
          { id: "c2", label: "열 2" },
        ],
        binding: "google_internal_row_ids",
        mode: "single",
        requireResponsePerRow: true,
        limitOneResponsePerColumn: true,
      },
    }),
    question({
      id: "q-grid-checkbox",
      type: "grid_checkbox",
      sectionId: "section-1",
      entryIds: ["multi-row-1", "multi-row-2"],
      grid: {
        rows: [
          { id: "mr1", label: "다중 행 1", entryId: "multi-row-1", required: true },
          { id: "mr2", label: "다중 행 2", entryId: "multi-row-2", required: true },
        ],
        columns: [
          { id: "mc1", label: "다중 열 1" },
          { id: "mc2", label: "다중 열 2" },
          { id: "mc3", label: "다중 열 3" },
        ],
        binding: "google_internal_row_ids",
        mode: "multiple",
        requireResponsePerRow: true,
        limitOneResponsePerColumn: false,
      },
    }),
    question({
      id: "q-date",
      type: "date",
      sectionId: "section-1",
      date: { includeYear: false, includeTime: false },
    }),
    question({
      id: "q-date-time",
      type: "date",
      sectionId: "section-1",
      date: { includeYear: true, includeTime: true },
    }),
    question({
      id: "q-time",
      type: "time",
      sectionId: "section-1",
      time: { kind: "time_of_day" },
    }),
    question({
      id: "q-duration",
      type: "time",
      sectionId: "section-1",
      time: { kind: "duration" },
    }),
    question({
      id: "q-branch",
      type: "single_choice",
      sectionId: "section-1",
      options: [
        {
          label: "A",
          value: "A",
          isOther: false,
          branchTarget: { kind: "section", sectionItemId: "section-item-a" },
        },
        {
          label: "B",
          value: "B",
          isOther: false,
          branchTarget: { kind: "section", sectionItemId: "section-item-b" },
        },
      ],
    }),
    question({ id: "q-a", type: "short_text", sectionId: "section-a" }),
    question({ id: "q-b", type: "paragraph", sectionId: "section-b" }),
  ],
  diagnostics: { warnings: [], unsupportedQuestionCount: 0 },
} satisfies ImportedForm;

describe("advanced deterministic response generation", () => {
  it("generates constrained values, both grid modes, structured time values, and only the reached branch", () => {
    const rules = createDefaultRules(advancedForm);
    const first = generateResponses({ form: advancedForm, rules, count: 12 });
    const second = generateResponses({ form: advancedForm, rules, count: 12 });
    expect(second).toEqual(first);

    for (const response of first) {
      expect(Number(response.answers["q-number"])).toBeGreaterThanOrEqual(1);
      expect(Number(response.answers["q-number"])).toBeLessThanOrEqual(120);
      expect(response.answers["q-checkbox"]).toEqual(expect.any(Array));
      expect((response.answers["q-checkbox"] as string[]).length).toBeGreaterThanOrEqual(2);

      const singleGrid = response.answers["q-grid-single"] as Record<string, string>;
      expect(new Set(Object.values(singleGrid)).size).toBe(2);
      const checkboxGrid = response.answers["q-grid-checkbox"] as unknown as Record<string, string[]>;
      expect(Object.values(checkboxGrid)).toHaveLength(2);
      expect(Object.values(checkboxGrid).every((values) => values.length >= 1)).toBe(true);

      expect(response.answers["q-date"]).toMatch(/^\d{2}-\d{2}$/);
      expect(response.answers["q-date-time"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      expect(response.answers["q-time"]).toMatch(/^\d{2}:\d{2}$/);
      expect(response.answers["q-duration"]).toMatch(/^\d+:\d{2}:\d{2}$/);

      const branch = response.answers["q-branch"];
      expect(branch === "A" ? response.answers["q-a"] : response.answers["q-b"]).toBeTypeOf("string");
      expect(branch === "A" ? response.answers["q-b"] : response.answers["q-a"]).toBeUndefined();
      expect(response.visitedSectionIds).toEqual(
        branch === "A" ? ["section-1", "section-a"] : ["section-1", "section-b"],
      );
      expect(validateGeneratedResponse(advancedForm, response)).toEqual({
        valid: true,
        issues: [],
      });
    }
  });

  it("supports deterministic optional omission without exposing a seed setting", () => {
    const optionalForm: ImportedForm = {
      ...advancedForm,
      sections: [
        {
          id: "section-1",
          itemId: null,
          index: 0,
          title: "기본",
          description: null,
          questionIds: ["q-optional"],
        },
      ],
      questions: [
        question({
          id: "q-optional",
          type: "short_text",
          sectionId: "section-1",
          required: false,
        }),
      ],
    };
    const rule = createDefaultRules(optionalForm)[0] as GenerationRule & {
      omitProbability: number;
    };
    rule.omitProbability = 1;
    const responses = generateResponses({
      form: optionalForm,
      rules: [rule],
      count: 3,
    });
    expect(responses.map((response) => response.answers)).toEqual([{}, {}, {}]);
  });

  it("rejects constraint violations, duplicate grid columns, and a missing reached branch answer", () => {
    const invalid = {
      id: "invalid",
      index: 0,
      answers: {
        "q-number": "121",
        "q-checkbox": ["X"],
        "q-grid-single": { "행 1": "열 1", "행 2": "열 1" },
        "q-grid-checkbox": {
          "다중 행 1": ["다중 열 1"],
          "다중 행 2": ["다중 열 2"],
        },
        "q-date": "07-19",
        "q-date-time": "2026-07-19T14:30",
        "q-time": "14:30",
        "q-duration": "1:02:03",
        "q-branch": "A",
      },
    };
    const result = validateGeneratedResponse(advancedForm, invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => [issue.questionId, issue.code])).toEqual([
      ["q-number", "INVALID_ANSWER"],
      ["q-checkbox", "INVALID_ANSWER"],
      ["q-grid-single", "INVALID_ANSWER"],
      ["q-a", "REQUIRED_MISSING"],
    ]);
    expect(result.issues.some((issue) => issue.questionId === "q-b")).toBe(false);
  });
});
