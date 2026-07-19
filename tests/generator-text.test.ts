import { describe, expect, it } from "vitest";
import type { FormQuestion, ImportedForm } from "../lib/domain/form-schema";
import { generateResponses } from "../lib/generator/engine";
import { createDefaultRules } from "../lib/generator/rules";
import { matchesTextConstraints, validateGeneratedResponse } from "../lib/generator/validation";

function formWith(question: FormQuestion): ImportedForm {
  return {
    schemaVersion: "1.0",
    parserVersion: "text-test",
    source: {
      requestedUrl: "https://docs.google.com/forms/d/e/text/viewform",
      canonicalUrl: "https://docs.google.com/forms/d/e/text/viewform",
      publicId: "text",
      fetchedAt: "2026-07-19T00:00:00.000Z",
    },
    title: "Text generator fixture",
    description: null,
    locale: "ko",
    sections: [{
      id: "section-1",
      itemId: null,
      index: 0,
      title: "기본",
      description: null,
      questionIds: [question.id],
    }],
    questions: [question],
    diagnostics: { warnings: [], unsupportedQuestionCount: 0 },
  };
}

describe("text response generation", () => {
  it("uses Unicode characters consistently for validation and maximum-length clipping", () => {
    const question: FormQuestion = {
      id: "q-emoji",
      itemId: "item-q-emoji",
      entryIds: ["entry-q-emoji"],
      sectionId: "section-1",
      index: 0,
      title: "한 글자 응답",
      description: null,
      type: "short_text",
      required: true,
      options: [],
      validations: [{
        kind: "text_length",
        operator: "max",
        value: 1,
        errorMessage: null,
        rawCategory: 6,
        rawOperator: 204,
      }],
      rawType: 0,
    };
    const form = formWith(question);
    const baseRule = createDefaultRules(form)[0];
    if (baseRule.kind !== "text") throw new Error("Expected a text rule");

    expect(matchesTextConstraints(question, "😀")).toBe(true);
    expect(matchesTextConstraints(question, "😀x")).toBe(false);

    const [response] = generateResponses({
      form,
      rules: [{ ...baseRule, mode: "sequence", samples: ["😀x"] }],
      count: 1,
      seed: "unicode-length",
    });

    expect(response.answers[question.id]).toBe("😀");
    expect(validateGeneratedResponse(form, response)).toEqual({ valid: true, issues: [] });
  });
});
