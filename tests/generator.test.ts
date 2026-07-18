import { describe, expect, it } from "vitest";
import type { ImportedForm } from "../lib/domain/form-schema";
import { generateResponses } from "../lib/generator/engine";
import { createDefaultRules } from "../lib/generator/rules";
import { validateGeneratedResponse } from "../lib/generator/validation";

const form: ImportedForm = {
  schemaVersion: "1.0",
  parserVersion: "test",
  source: {
    requestedUrl: "https://docs.google.com/forms/d/e/test/viewform",
    canonicalUrl: "https://docs.google.com/forms/d/e/test/viewform",
    publicId: "test",
    fetchedAt: "2026-07-18T00:00:00.000Z",
  },
  title: "Generator Fixture",
  description: null,
  locale: "ko",
  sections: [{ id: "section-1", itemId: null, index: 0, title: "기본", description: null, questionIds: ["q1", "q2", "q3"] }],
  questions: [
    {
      id: "q1", itemId: "1", entryIds: ["11"], sectionId: "section-1", index: 0,
      title: "선택", description: null, type: "single_choice", required: true, rawType: 2,
      options: [
        { label: "A", value: "A", isOther: false },
        { label: "B", value: "B", isOther: false },
        { label: "C", value: "C", isOther: false },
      ],
    },
    {
      id: "q2", itemId: "2", entryIds: ["12"], sectionId: "section-1", index: 1,
      title: "다중", description: null, type: "checkboxes", required: true, rawType: 4,
      options: [
        { label: "X", value: "X", isOther: false },
        { label: "Y", value: "Y", isOther: false },
        { label: "Z", value: "Z", isOther: false },
      ],
    },
    {
      id: "q3", itemId: "3", entryIds: ["13"], sectionId: "section-1", index: 2,
      title: "설명", description: null, type: "paragraph", required: false, rawType: 1,
      options: [],
    },
  ],
  diagnostics: { warnings: [], unsupportedQuestionCount: 0 },
};

describe("seeded response generator", () => {
  it("is deterministic and keeps required answers inside the allowed domain", () => {
    const rules = createDefaultRules(form);
    const first = generateResponses({ form, rules, count: 20, seed: "stable-seed" });
    const second = generateResponses({ form, rules, count: 20, seed: "stable-seed" });

    expect(second).toEqual(first);
    expect(first).toHaveLength(20);
    for (const response of first) {
      expect(["A", "B", "C"]).toContain(response.answers.q1);
      expect(response.answers.q2).toBeInstanceOf(Array);
      expect((response.answers.q2 as string[]).length).toBeGreaterThanOrEqual(1);
      expect((response.answers.q2 as string[]).length).toBeLessThanOrEqual(3);
      expect(response.answers.q3).toBeTypeOf("string");
    }
  });

  it("caps large batches at the application safety limit", () => {
    const responses = generateResponses({
      form,
      rules: createDefaultRules(form),
      count: 10_000,
      seed: "limit",
    });
    expect(responses).toHaveLength(500);
  });

  it("reports missing required answers and rejects values outside the schema", () => {
    const missing = { id: "missing", index: 0, answers: {} };
    const invalid = {
      id: "invalid",
      index: 0,
      answers: { q1: "not-an-option", q2: ["X"], q3: "ok" },
    };

    expect(validateGeneratedResponse(form, missing)).toMatchObject({
      valid: false,
      issues: [
        { questionId: "q1", code: "REQUIRED_MISSING" },
        { questionId: "q2", code: "REQUIRED_MISSING" },
      ],
    });
    expect(validateGeneratedResponse(form, invalid)).toMatchObject({
      valid: false,
      issues: [{ questionId: "q1", code: "INVALID_ANSWER" }],
    });
  });
});
