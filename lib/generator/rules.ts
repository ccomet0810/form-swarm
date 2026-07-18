import type {
  FormQuestion,
  GenerationRule,
  ImportedForm,
} from "../domain/form-schema";

function textSamples(question: FormQuestion): string[] {
  const text = `${question.title} ${question.description ?? ""}`;
  if (/전화|연락처|휴대폰/.test(text)) {
    return ["010-0000-0001", "010-0000-0002", "010-0000-0003"];
  }
  if (question.type === "paragraph") {
    return [
      "전반적으로 만족했으며 안내가 조금 더 구체적이면 좋겠습니다.",
      "사용 과정은 이해하기 쉬웠고 결과도 기대한 수준이었습니다.",
      "핵심 단계는 좋았지만 초반 설명을 보강하면 더 편리할 것 같습니다.",
    ];
  }
  return ["샘플 응답 A", "샘플 응답 B", "샘플 응답 C"];
}

export function defaultRuleForQuestion(question: FormQuestion): GenerationRule {
  if (question.type === "short_text" || question.type === "paragraph") {
    return {
      questionId: question.id,
      enabled: true,
      kind: "text",
      mode: "sample_pool",
      samples: textSamples(question),
    };
  }

  if (question.type === "checkboxes") {
    const selectableCount = Math.max(
      1,
      question.options.filter((option) => !option.isOther).length,
    );
    return {
      questionId: question.id,
      enabled: true,
      kind: "checkboxes",
      minSelections: question.required ? 1 : 0,
      maxSelections: Math.min(3, selectableCount),
    };
  }

  if (question.type === "grid_single") {
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
    };
  }

  return { questionId: question.id, enabled: false, kind: "unsupported" };
}

export function createDefaultRules(form: ImportedForm): GenerationRule[] {
  return form.questions.map(defaultRuleForQuestion);
}
