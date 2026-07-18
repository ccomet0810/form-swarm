import type {
  FormQuestion,
  GeneratedResponse,
  ImportedForm,
} from "../domain/form-schema";
import {
  constraintsForQuestion,
  isValidCalendarDate,
} from "./constraints";
import {
  questionIsReached,
  resolveResponseNavigation,
} from "./navigation";

export interface ResponseValidationIssue {
  questionId: string;
  code: "REQUIRED_MISSING" | "INVALID_ANSWER" | "UNSUPPORTED_ANSWER";
  message: string;
}

export interface ResponseValidationResult {
  valid: boolean;
  issues: ResponseValidationIssue[];
}

interface ResponseLike {
  answers: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(answer: unknown): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === "string") return answer.trim().length === 0;
  if (Array.isArray(answer)) return answer.length === 0;
  return isRecord(answer) && Object.keys(answer).length === 0;
}

function matchesTextConstraints(question: FormQuestion, answer: string): boolean {
  const constraints = constraintsForQuestion(question);
  if (constraints.minLength !== undefined && answer.length < constraints.minLength) {
    return false;
  }
  if (constraints.maxLength !== undefined && answer.length > constraints.maxLength) {
    return false;
  }
  if (constraints.textKind === "number") {
    if (!answer.trim() || !Number.isFinite(Number(answer))) return false;
    const value = Number(answer);
    if (constraints.minValue !== undefined && value < constraints.minValue) return false;
    if (constraints.maxValue !== undefined && value > constraints.maxValue) return false;
    if (
      constraints.excludedNumberRange &&
      value >= constraints.excludedNumberRange.min &&
      value <= constraints.excludedNumberRange.max
    ) {
      return false;
    }
  }
  if (constraints.textKind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) {
    return false;
  }
  if (constraints.textKind === "url") {
    try {
      const url = new URL(answer);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    } catch {
      return false;
    }
  }
  if (constraints.pattern) {
    try {
      if (!new RegExp(constraints.pattern).test(answer)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isAllowedChoice(question: FormQuestion, value: string): boolean {
  if (
    question.options.some(
      (option) => !option.isOther && (option.label === value || option.value === value),
    )
  ) {
    return true;
  }
  return question.options.some((option) => option.isOther) && value.trim().length > 0;
}

function matchesCheckboxes(question: FormQuestion, answer: unknown): boolean {
  if (!Array.isArray(answer) || !answer.every((value) => typeof value === "string")) {
    return false;
  }
  if (new Set(answer).size !== answer.length) return false;
  const regular = new Set(
    question.options
      .filter((option) => !option.isOther)
      .flatMap((option) => [option.label, option.value]),
  );
  const customValues = answer.filter((value) => !regular.has(value));
  if (customValues.length > 1 || (customValues.length === 1 && !question.options.some((option) => option.isOther))) {
    return false;
  }
  const constraints = constraintsForQuestion(question);
  if (constraints.minSelections !== undefined && answer.length < constraints.minSelections) {
    return false;
  }
  if (constraints.maxSelections !== undefined && answer.length > constraints.maxSelections) {
    return false;
  }
  if (constraints.exactSelections !== undefined && answer.length !== constraints.exactSelections) {
    return false;
  }
  return true;
}

function gridRowValue(
  answer: Record<string, unknown>,
  row: { id: string; label: string },
): unknown {
  return answer[row.label] ?? answer[row.id];
}

function matchesSingleGrid(question: FormQuestion, answer: unknown): boolean {
  if (!question.grid || !isRecord(answer)) return false;
  const columns = new Set(
    question.grid.columns.flatMap((column) => [column.label, column.id]),
  );
  const values: string[] = [];
  for (const row of question.grid.rows) {
    const value = gridRowValue(answer, row);
    const rowRequired =
      question.grid.requireResponsePerRow ||
      (row as typeof row & { required?: boolean }).required ||
      question.required;
    if (value === undefined || value === "") {
      if (rowRequired) return false;
      continue;
    }
    if (typeof value !== "string" || !columns.has(value)) return false;
    values.push(value);
  }
  const knownRows = new Set(
    question.grid.rows.flatMap((row) => [row.id, row.label]),
  );
  if (Object.keys(answer).some((key) => !knownRows.has(key))) return false;
  if (
    constraintsForQuestion(question).uniqueGridColumns &&
    new Set(values).size !== values.length
  ) {
    return false;
  }
  return true;
}

function matchesCheckboxGrid(question: FormQuestion, answer: unknown): boolean {
  if (!question.grid || !isRecord(answer)) return false;
  const columns = new Set(
    question.grid.columns.flatMap((column) => [column.label, column.id]),
  );
  for (const row of question.grid.rows) {
    const value = gridRowValue(answer, row);
    const rowRequired =
      question.grid.requireResponsePerRow ||
      (row as typeof row & { required?: boolean }).required ||
      question.required;
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      if (rowRequired) return false;
      continue;
    }
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === "string" && columns.has(entry)) ||
      new Set(value).size !== value.length
    ) {
      return false;
    }
  }
  const knownRows = new Set(
    question.grid.rows.flatMap((row) => [row.id, row.label]),
  );
  return !Object.keys(answer).some((key) => !knownRows.has(key));
}

function matchesDate(question: FormQuestion, answer: unknown): boolean {
  const date = (question as FormQuestion & {
    date?: { includeYear?: boolean; includeTime?: boolean };
  }).date;
  let year: number;
  let month: number;
  let day: number;
  let hour: number | undefined;
  let minute: number | undefined;

  if (typeof answer === "string") {
    const match = answer.match(
      /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/,
    );
    if (!match) return false;
    year = match[1] ? Number(match[1]) : 2000;
    month = Number(match[2]);
    day = Number(match[3]);
    hour = match[4] === undefined ? undefined : Number(match[4]);
    minute = match[5] === undefined ? undefined : Number(match[5]);
    if (date?.includeYear !== false && match[1] === undefined) return false;
  } else if (isRecord(answer)) {
    year = answer.year == null ? 2000 : Number(answer.year);
    month = Number(answer.month);
    day = Number(answer.day);
    hour = answer.hour == null ? undefined : Number(answer.hour);
    minute = answer.minute == null ? undefined : Number(answer.minute);
    if (date?.includeYear !== false && answer.year == null) return false;
  } else {
    return false;
  }

  if (!isValidCalendarDate(year, month, day)) return false;
  if (date?.includeTime) {
    return (
      Number.isInteger(hour) &&
      Number.isInteger(minute) &&
      hour! >= 0 &&
      hour! <= 23 &&
      minute! >= 0 &&
      minute! <= 59
    );
  }
  return hour === undefined && minute === undefined;
}

function matchesTime(question: FormQuestion, answer: unknown): boolean {
  let hour: number;
  let minute: number;
  let second: number | undefined;
  if (typeof answer === "string") {
    const match = answer.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (!match) return false;
    hour = Number(match[1]);
    minute = Number(match[2]);
    second = match[3] === undefined ? undefined : Number(match[3]);
  } else if (isRecord(answer)) {
    hour = Number(answer.hour);
    minute = Number(answer.minute);
    second = answer.second == null ? undefined : Number(answer.second);
  } else {
    return false;
  }
  const kind = (question as FormQuestion & {
    time?: { kind?: "time_of_day" | "duration" };
  }).time?.kind;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return false;
  }
  if (second !== undefined && (!Number.isInteger(second) || second < 0 || second > 59)) {
    return false;
  }
  if (kind === "duration") return hour >= 0 && second !== undefined;
  return hour >= 0 && hour <= 23 && second === undefined;
}

function answerMatchesQuestion(question: FormQuestion, answer: unknown): boolean {
  if (question.type === "short_text" || question.type === "paragraph") {
    return typeof answer === "string" && matchesTextConstraints(question, answer);
  }
  if (
    question.type === "single_choice" ||
    question.type === "dropdown" ||
    question.type === "scale" ||
    question.type === "rating"
  ) {
    return typeof answer === "string" && isAllowedChoice(question, answer);
  }
  if (question.type === "checkboxes") return matchesCheckboxes(question, answer);
  if (question.type === "grid_single") return matchesSingleGrid(question, answer);
  if (question.type === "grid_checkbox") return matchesCheckboxGrid(question, answer);
  if (question.type === "date") return matchesDate(question, answer);
  if (question.type === "time") return matchesTime(question, answer);
  return false;
}

export function validateGeneratedResponse(
  form: ImportedForm,
  response: GeneratedResponse | ResponseLike,
): ResponseValidationResult {
  const issues: ResponseValidationIssue[] = [];
  const answers = (response as ResponseLike).answers;
  const navigation = resolveResponseNavigation(form, answers);

  for (const question of form.questions) {
    if (!questionIsReached(question, navigation)) continue;
    const answer = answers[question.id];
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

    if (!answerMatchesQuestion(question, answer)) {
      issues.push({
        questionId: question.id,
        code: "INVALID_ANSWER",
        message: `“${question.title}”의 응답이 허용된 구조, 선택지 또는 검증 조건과 맞지 않습니다.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
