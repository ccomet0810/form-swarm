import type {
  FormQuestion,
  GenerationRule,
  ImportedForm,
  OtherAnswerGenerationRule,
} from "../domain/form-schema";
import { constraintsForQuestion } from "./constraints";

function textSamples(): string[] {
  return [];
}

function otherRule(question: FormQuestion): OtherAnswerGenerationRule | undefined {
  if (!question.options.some((option) => option.isOther)) return undefined;
  return {
    // Generating an opaque placeholder as an Other response is surprising and
    // produces low-quality form data. The user explicitly enables this after
    // supplying the texts that may be sampled.
    enabled: false,
    probability: 0.15,
    samples: [],
  };
}

export function defaultRuleForQuestion(question: FormQuestion): GenerationRule {
  if (
    question.type === "short_text" ||
    question.type === "paragraph" ||
    question.type === "date" ||
    question.type === "time"
  ) {
    return {
      questionId: question.id,
      enabled: true,
      kind: "text",
      mode: "sample_pool",
      samples: textSamples(),
    };
  }

  if (question.type === "checkboxes") {
    const constraints = constraintsForQuestion(question);
    const selectableCount = Math.max(
      1,
      question.options.filter((option) => !option.isOther).length,
    );
    return {
      questionId: question.id,
      enabled: true,
      kind: "checkboxes",
      minSelections: Math.max(
        question.required ? 1 : 0,
        constraints.minSelections ?? 0,
      ),
      maxSelections: Math.min(
        constraints.maxSelections ?? 3,
        selectableCount,
      ),
      other: otherRule(question),
    };
  }

  if (question.type === "grid_single" || question.type === "grid_checkbox") {
    return {
      questionId: question.id,
      enabled: true,
      kind: "grid",
      mode: "uniform",
    };
  }

  if (
    question.type === "single_choice" ||
    question.type === "dropdown" ||
    question.type === "scale" ||
    question.type === "rating"
  ) {
    return {
      questionId: question.id,
      enabled: true,
      kind: "choice",
      mode:
        question.type === "scale" || question.type === "rating"
          ? "middle_weighted"
          : "uniform",
      other: otherRule(question),
    };
  }

  return { questionId: question.id, enabled: false, kind: "unsupported" };
}

export function createDefaultRules(form: ImportedForm): GenerationRule[] {
  return form.questions.map((question) => ({
    ...defaultRuleForQuestion(question),
    // Optional questions are occasionally left unanswered, as real response
    // sets are. This is an internal deterministic rule, not a seed/UI setting.
    omitProbability: question.required ? 0 : 0.15,
  }));
}
