import { describe, expect, it } from "vitest";
import type {
  FormQuestion,
  GenerationRule,
  ImportedForm,
} from "../lib/domain/form-schema";
import { generateResponses } from "../lib/generator/engine";
import { destinationForChoice } from "../lib/generator/navigation";
import { createDefaultRules } from "../lib/generator/rules";
import { validateGeneratedResponse } from "../lib/generator/validation";

function choiceQuestion(
  id: string,
  type: "single_choice" | "dropdown" | "checkboxes",
): FormQuestion {
  return {
    id,
    itemId: `item-${id}`,
    entryIds: [`entry-${id}`],
    sectionId: "section-1",
    index: 0,
    title: id,
    description: null,
    type,
    required: true,
    options: [
      { label: "A", value: "A", isOther: false },
      { label: "B", value: "B", isOther: false },
      { label: "기타", value: "__other__", isOther: true },
    ],
    rawType: type === "checkboxes" ? 4 : type === "dropdown" ? 3 : 2,
  };
}

const questions = [
  choiceQuestion("single", "single_choice"),
  choiceQuestion("dropdown", "dropdown"),
  choiceQuestion("checkboxes", "checkboxes"),
];

const form: ImportedForm = {
  schemaVersion: "1.0",
  parserVersion: "other-test",
  source: {
    requestedUrl: "https://docs.google.com/forms/d/e/other-test/viewform",
    canonicalUrl: "https://docs.google.com/forms/d/e/other-test/viewform",
    publicId: "other-test",
    fetchedAt: "2026-07-19T00:00:00.000Z",
  },
  title: "Other generation fixture",
  description: null,
  locale: "ko",
  sections: [
    {
      id: "section-1",
      itemId: null,
      index: 0,
      title: "기본",
      description: null,
      questionIds: questions.map((question) => question.id),
    },
  ],
  questions,
  diagnostics: { warnings: [], unsupportedQuestionCount: 0 },
};

function enableOther(rule: GenerationRule): GenerationRule {
  if (rule.kind !== "choice" && rule.kind !== "checkboxes") return rule;
  return {
    ...rule,
    ...(rule.kind === "checkboxes"
      ? { minSelections: 2, maxSelections: 2 }
      : {}),
    other: {
      enabled: true,
      probability: 1,
      // Normalization must keep only two safe custom values.
      samples: [" 직접 입력 A ", "직접 입력 B", "직접 입력 B", "", "A"],
    },
  } as GenerationRule;
}

describe("Google Forms Other answer generation", () => {
  it("does not invent an Other text until the user enables a non-empty pool", () => {
    const rules = createDefaultRules(form);
    for (const rule of rules) {
      if (rule.kind === "choice" || rule.kind === "checkboxes") {
        expect(rule.other).toEqual({
          enabled: false,
          probability: 0.15,
          samples: [],
        });
      }
    }

    const responses = generateResponses({
      form,
      rules,
      count: 40,
      seed: "other-disabled",
    });
    for (const response of responses) {
      expect(["A", "B"]).toContain(response.answers.single);
      expect(["A", "B"]).toContain(response.answers.dropdown);
      expect(response.answers.checkboxes).toEqual(
        expect.arrayContaining([expect.stringMatching(/^[AB]$/)]),
      );
    }
  });

  it("samples user-supplied Other text for single choice, dropdown, and checkboxes", () => {
    const rules = createDefaultRules(form).map(enableOther);
    const first = generateResponses({
      form,
      rules,
      count: 24,
      seed: "other-enabled",
    });
    const second = generateResponses({
      form,
      rules,
      count: 24,
      seed: "other-enabled",
    });
    expect(second).toEqual(first);

    for (const response of first) {
      expect(["직접 입력 A", "직접 입력 B"]).toContain(
        response.answers.single,
      );
      expect(["직접 입력 A", "직접 입력 B"]).toContain(
        response.answers.dropdown,
      );
      const checkboxAnswers = response.answers.checkboxes as string[];
      expect(checkboxAnswers).toHaveLength(2);
      expect(
        checkboxAnswers.filter((value) => value.startsWith("직접 입력")),
      ).toHaveLength(1);
      expect(validateGeneratedResponse(form, response)).toEqual({
        valid: true,
        issues: [],
      });
    }
  });

  it("supports a fixed Other choice and rejects more than one custom checkbox value", () => {
    const singleRule = enableOther(createDefaultRules(form)[0]);
    if (singleRule.kind !== "choice") throw new Error("choice rule expected");
    const response = generateResponses({
      form: { ...form, questions: [questions[0]], sections: [{ ...form.sections[0], questionIds: ["single"] }] },
      rules: [{ ...singleRule, mode: "fixed", fixedValue: "__other__" }],
      count: 1,
      seed: "fixed-other",
    })[0];
    expect(["직접 입력 A", "직접 입력 B"]).toContain(response.answers.single);

    const invalid = validateGeneratedResponse(form, {
      id: "invalid-other",
      index: 0,
      answers: {
        single: "직접 입력 A",
        dropdown: "직접 입력 A",
        checkboxes: ["직접 입력 A", "직접 입력 B"],
      },
    });
    expect(invalid.issues).toContainEqual(
      expect.objectContaining({
        questionId: "checkboxes",
        code: "INVALID_ANSWER",
      }),
    );
  });

  it("uses the Other option's section branch for custom text", () => {
    const branchedQuestion: FormQuestion = {
      ...questions[0],
      options: questions[0].options.map((option) =>
        option.isOther
          ? {
              ...option,
              branchTarget: {
                kind: "section" as const,
                sectionItemId: "other-section",
              },
            }
          : option,
      ),
    };
    expect(destinationForChoice(branchedQuestion, "직접 입력 A")).toBe(
      "other-section",
    );
  });
});
