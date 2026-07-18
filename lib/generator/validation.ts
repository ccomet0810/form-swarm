import type {
  FormQuestion,
  GeneratedAnswer,
  GeneratedResponse,
  ImportedForm,
} from "../domain/form-schema";

export interface ResponseValidationIssue {
  questionId: string;
  code: "REQUIRED_MISSING" | "INVALID_ANSWER" | "UNSUPPORTED_ANSWER";
  message: string;
}

export interface ResponseValidationResult {
  valid: boolean;
  issues: ResponseValidationIssue[];
}

function isMissing(answer: GeneratedAnswer | undefined): boolean {
  if (answer === undefined) return true;
  if (typeof answer === "string") return answer.trim().length === 0;
  if (Array.isArray(answer)) return answer.length === 0;
  return Object.keys(answer).length === 0;
}

function answerMatchesQuestion(
  question: FormQuestion,
  answer: GeneratedAnswer,
): boolean {
  if (question.type === "short_text" || question.type === "paragraph") {
    return typeof answer === "string";
  }

  const allowedOptions = new Set(
    question.options.filter((option) => !option.isOther).map((option) => option.label),
  );

  if (
    question.type === "single_choice" ||
    question.type === "dropdown" ||
    question.type === "scale" ||
    question.type === "rating"
  ) {
    return typeof answer === "string" && allowedOptions.has(answer);
  }

  if (question.type === "checkboxes") {
    return (
      Array.isArray(answer) &&
      new Set(answer).size === answer.length &&
      answer.every((value) => allowedOptions.has(value))
    );
  }

  if (question.type === "grid_single" && question.grid) {
    if (typeof answer !== "object" || Array.isArray(answer)) return false;
    const rowLabels = new Set(question.grid.rows.map((row) => row.label));
    const columnLabels = new Set(question.grid.columns.map((column) => column.label));
    const entries = Object.entries(answer);
    if (entries.some(([row, column]) => !rowLabels.has(row) || !columnLabels.has(column))) {
      return false;
    }
    return !question.required || entries.length === question.grid.rows.length;
  }

  return false;
}

export function validateGeneratedResponse(
  form: ImportedForm,
  response: GeneratedResponse,
): ResponseValidationResult {
  const issues: ResponseValidationIssue[] = [];

  for (const question of form.questions) {
    const answer = response.answers[question.id];
    if (isMissing(answer)) {
      if (question.required) {
        issues.push({
          questionId: question.id,
          code: "REQUIRED_MISSING",
          message: `필수 문항 “${question.title}”의 응답이 없습니다.`,
        });
      }
      continue;
    }

    if (question.type === "unknown") {
      issues.push({
        questionId: question.id,
        code: "UNSUPPORTED_ANSWER",
        message: `미지원 문항 “${question.title}”에는 응답을 만들 수 없습니다.`,
      });
      continue;
    }

    if (!answerMatchesQuestion(question, answer!)) {
      issues.push({
        questionId: question.id,
        code: "INVALID_ANSWER",
        message: `“${question.title}”의 응답이 허용된 구조 또는 선택지와 맞지 않습니다.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
