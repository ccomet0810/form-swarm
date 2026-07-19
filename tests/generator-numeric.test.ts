import { describe, expect, it } from "vitest";
import type {
  FormQuestion,
  FormValidation,
  ImportedForm,
} from "../lib/domain/form-schema";
import { generateResponses } from "../lib/generator/engine";
import { createDefaultRules } from "../lib/generator/rules";
import { validateGeneratedResponse } from "../lib/generator/validation";

function numericQuestion(
  id: string,
  validation: Extract<FormValidation, { kind: "number_range" }>,
): FormQuestion {
  return {
    id,
    itemId: `item-${id}`,
    entryIds: [`entry-${id}`],
    sectionId: "section-1",
    index: 0,
    title: id,
    description: null,
    type: "short_text",
    required: true,
    options: [],
    validations: [validation],
    rawType: 0,
  };
}

function oneSidedNumericQuestion(
  id: string,
  bounds: { minValue?: number; maxValue?: number },
): FormQuestion {
  return {
    ...numericQuestion(id, between(0, 0)),
    validations: [],
    numberValidation: { kind: "number", ...bounds },
  } as FormQuestion;
}

function formWith(...questions: FormQuestion[]): ImportedForm {
  return {
    schemaVersion: "1.0",
    parserVersion: "numeric-test",
    source: {
      requestedUrl: "https://docs.google.com/forms/d/e/numeric/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/numeric/viewform",
      publicId: "numeric",
      fetchedAt: "2026-07-19T00:00:00.000Z",
    },
    title: "Numeric generator fixture",
    description: null,
    locale: "ko",
    sections: [{
      id: "section-1",
      itemId: null,
      index: 0,
      title: "기본",
      description: null,
      questionIds: questions.map((question) => question.id),
    }],
    questions: questions.map((question, index) => ({ ...question, index })),
    diagnostics: { warnings: [], unsupportedQuestionCount: 0 },
  };
}

function between(min: number, max: number): Extract<FormValidation, { kind: "number_range" }> {
  return {
    kind: "number_range",
    operator: "between",
    min,
    max,
    errorMessage: null,
    rawCategory: 1,
    rawOperator: 7,
  };
}

function notBetween(min: number, max: number): Extract<FormValidation, { kind: "number_range" }> {
  return {
    ...between(min, max),
    operator: "not_between",
    rawOperator: 8,
  };
}

describe("numeric response generation", () => {
  it("preserves valid AI or manual samples and replaces only candidates outside validation", () => {
    const form = formWith(numericQuestion("q-sampled", between(1, 120)));
    const baseRule = createDefaultRules(form)[0];
    if (baseRule.kind !== "text") throw new Error("Expected a text rule");

    for (const mode of ["sequence", "sample_pool"] as const) {
      const responses = generateResponses({
        form,
        rules: [{ ...baseRule, mode, samples: ["73"] }],
        count: 4,
        seed: `valid-${mode}`,
      });
      expect(responses.map((response) => response.answers["q-sampled"])).toEqual([
        "73",
        "73",
        "73",
        "73",
      ]);
    }

    const invalidResponses = generateResponses({
      form,
      rules: [{ ...baseRule, mode: "sequence", samples: ["999"] }],
      count: 8,
      seed: "invalid-sequence",
    });
    expect(invalidResponses.every((response) => {
      const value = Number(response.answers["q-sampled"]);
      return value >= 1 && value <= 120 && value !== 999;
    })).toBe(true);
    expect(invalidResponses.every((response) => validateGeneratedResponse(form, response).valid)).toBe(true);
  });

  it("samples seeded random integers from an inclusive range instead of walking it sequentially", () => {
    const form = formWith(numericQuestion("q-integer", between(1, 120)));
    const input = {
      form,
      rules: createDefaultRules(form),
      count: 24,
      seed: "integer-range",
    };
    const first = generateResponses(input);
    const second = generateResponses(input);
    const values = first.map((response) => Number(response.answers["q-integer"]));

    expect(second).toEqual(first);
    expect(values).not.toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(new Set(values).size).toBeGreaterThan(1);
    for (const [index, value] of values.entries()) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(120);
      expect(validateGeneratedResponse(form, first[index])).toEqual({ valid: true, issues: [] });
    }

    for (const boundary of ["1", "120"]) {
      expect(validateGeneratedResponse(form, {
        id: `boundary-${boundary}`,
        index: 0,
        answers: { "q-integer": boundary },
      }).valid).toBe(true);
    }
    for (const outside of ["0", "121"]) {
      expect(validateGeneratedResponse(form, {
        id: `outside-${outside}`,
        index: 0,
        answers: { "q-integer": outside },
      }).valid).toBe(false);
    }
  });

  it("samples decimals when the inclusive bounds are decimal and preserves an exact decimal range", () => {
    const form = formWith(
      numericQuestion("q-decimal", between(0.25, 0.75)),
      numericQuestion("q-exact", between(3.5, 3.5)),
    );
    const responses = generateResponses({
      form,
      rules: createDefaultRules(form),
      count: 20,
      seed: "decimal-range",
    });
    const values = responses.map((response) => Number(response.answers["q-decimal"]));

    expect(values.every((value) => value >= 0.25 && value <= 0.75)).toBe(true);
    expect(values.every((value) => !Number.isInteger(value))).toBe(true);
    expect(responses.map((response) => response.answers["q-exact"])).toEqual(
      Array.from({ length: 20 }, () => "3.5"),
    );
    expect(responses.every((response) => validateGeneratedResponse(form, response).valid)).toBe(true);
  });

  it("treats a not-between interval as closed and samples random integers outside both endpoints", () => {
    const form = formWith(numericQuestion("q-excluded", notBetween(10, 20)));
    const responses = generateResponses({
      form,
      rules: createDefaultRules(form),
      count: 40,
      seed: "excluded-range",
    });
    const values = responses.map((response) => Number(response.answers["q-excluded"]));

    expect(values.every(Number.isInteger)).toBe(true);
    expect(values.every((value) => value < 10 || value > 20)).toBe(true);
    expect(values.some((value) => value < 10)).toBe(true);
    expect(values.some((value) => value > 20)).toBe(true);
    expect(responses.every((response) => validateGeneratedResponse(form, response).valid)).toBe(true);

    for (const excluded of ["10", "15", "20"]) {
      expect(validateGeneratedResponse(form, {
        id: `excluded-${excluded}`,
        index: 0,
        answers: { "q-excluded": excluded },
      }).valid).toBe(false);
    }
    for (const allowed of ["9", "21"]) {
      expect(validateGeneratedResponse(form, {
        id: `allowed-${allowed}`,
        index: 0,
        answers: { "q-excluded": allowed },
      }).valid).toBe(true);
    }
  });

  it("keeps legacy one-sided numeric constraints on the valid side of their boundary", () => {
    const form = formWith(
      oneSidedNumericQuestion("q-minimum", { minValue: 25 }),
      oneSidedNumericQuestion("q-maximum", { maxValue: -25 }),
    );
    const responses = generateResponses({
      form,
      rules: createDefaultRules(form),
      count: 20,
      seed: "one-sided-ranges",
    });

    for (const response of responses) {
      const minimum = Number(response.answers["q-minimum"]);
      const maximum = Number(response.answers["q-maximum"]);
      expect(Number.isInteger(minimum)).toBe(true);
      expect(Number.isInteger(maximum)).toBe(true);
      expect(minimum).toBeGreaterThanOrEqual(25);
      expect(minimum).toBeLessThanOrEqual(125);
      expect(maximum).toBeGreaterThanOrEqual(-125);
      expect(maximum).toBeLessThanOrEqual(-25);
      expect(validateGeneratedResponse(form, response).valid).toBe(true);
    }
  });
});
