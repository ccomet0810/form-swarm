import type {
  FormQuestion,
  GeneratedAnswer,
  GeneratedResponse,
} from "../domain/form-schema";
import { constraintsForQuestion } from "../generator/constraints";

export interface SummaryValue {
  label: string;
  count: number;
  percentage: number;
}

export type QuestionSummary =
  | {
      kind: "pie" | "horizontal_bars" | "vertical_bars" | "temporal";
      responseCount: number;
      values: SummaryValue[];
      average?: number;
    }
  | {
      kind: "text_list";
      responseCount: number;
      values: string[];
    }
  | {
      kind: "grid";
      responseCount: number;
      rows: Array<{
        label: string;
        answeredCount: number;
        values: SummaryValue[];
      }>;
    }
  | {
      kind: "unsupported";
      responseCount: number;
    };

function isRecord(
  answer: GeneratedAnswer,
): answer is Record<string, string | string[]> {
  return typeof answer === "object" && !Array.isArray(answer);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (value !== null && typeof value === "object") {
    return Object.values(value).some(hasMeaningfulValue);
  }
  return false;
}

function hasAnswer(answer: GeneratedAnswer | undefined): answer is GeneratedAnswer {
  return answer !== undefined && hasMeaningfulValue(answer);
}

function displayValue(answer: GeneratedAnswer): string {
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.join(", ");

  return Object.entries(answer)
    .filter(([, value]) => hasMeaningfulValue(value))
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join(" · ");
}

function percentage(count: number, responseCount: number): number {
  if (responseCount === 0) return 0;
  return Math.round((count / responseCount) * 1_000) / 10;
}

function countValues(
  answers: string[],
  responseCount: number,
  initialLabels: string[] = [],
): SummaryValue[] {
  const counts = new Map<string, number>(initialLabels.map((label) => [label, 0]));
  for (const answer of answers) {
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({
    label,
    count,
    percentage: percentage(count, responseCount),
  }));
}

function canonicalOptionLabel(question: FormQuestion, answer: string): string {
  const option = question.options.find(
    (candidate) => candidate.value === answer || candidate.label === answer,
  );
  return option?.label ?? answer;
}

function canonicalGridColumnLabel(question: FormQuestion, answer: string): string {
  const column = question.grid?.columns.find(
    (candidate) => candidate.id === answer || candidate.label === answer,
  );
  return column?.label ?? answer;
}

function uniqueSelections(answer: GeneratedAnswer): string[] {
  const values = Array.isArray(answer)
    ? answer
    : typeof answer === "string"
      ? [answer]
      : [];
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function numericLabel(value: string): string {
  const number = Number(value.trim());
  return Number.isFinite(number) ? String(number) : value;
}

function compareNumericLabels(left: SummaryValue, right: SummaryValue): number {
  const leftNumber = Number(left.label);
  const rightNumber = Number(right.label);
  const leftIsNumber = Number.isFinite(leftNumber);
  const rightIsNumber = Number.isFinite(rightNumber);
  if (leftIsNumber && rightIsNumber) return leftNumber - rightNumber;
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;
  return left.label.localeCompare(right.label);
}

interface TemporalDisplayValue {
  label: string;
  sortKey: number;
}

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function padded(value: string | number, length = 2): string {
  return String(value).padStart(length, "0");
}

function normalizedDateValue(
  question: FormQuestion,
  answer: GeneratedAnswer,
): TemporalDisplayValue {
  let source: string;
  if (typeof answer === "string") {
    source = answer.trim();
  } else if (isRecord(answer)) {
    const year = scalar(answer.year);
    const month = scalar(answer.month);
    const day = scalar(answer.day);
    const hour = scalar(answer.hour);
    const minute = scalar(answer.minute);
    const date = [year, month, day].filter(Boolean).join("-");
    source = `${date}${hour && minute ? `T${hour}:${minute}` : ""}`;
  } else {
    source = displayValue(answer).trim();
  }

  const withYear = source.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?$/,
  );
  const withoutYear = source.match(
    /^(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2}))?$/,
  );
  const match = withYear ?? withoutYear;
  if (!match) return { label: source, sortKey: Number.POSITIVE_INFINITY };

  const hasYear = Boolean(withYear);
  const year = hasYear ? Number(match[1]) : 0;
  const month = Number(match[hasYear ? 2 : 1]);
  const day = Number(match[hasYear ? 3 : 2]);
  const hourText = match[hasYear ? 4 : 3];
  const minuteText = match[hasYear ? 5 : 4];
  const hour = hourText === undefined ? 0 : Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  const dateLabel = hasYear
    ? `${padded(year, 4)}-${padded(month)}-${padded(day)}`
    : `${padded(month)}-${padded(day)}`;
  const includeTime = question.date?.includeTime || hourText !== undefined;
  return {
    label: includeTime
      ? `${dateLabel} ${padded(hour)}:${padded(minute)}`
      : dateLabel,
    sortKey:
      year * 100_000_000 + month * 1_000_000 + day * 10_000 + hour * 100 + minute,
  };
}

function normalizedTimeValue(
  question: FormQuestion,
  answer: GeneratedAnswer,
): TemporalDisplayValue {
  let source: string;
  if (typeof answer === "string") {
    source = answer.trim();
  } else if (isRecord(answer)) {
    const hour = scalar(answer.hour);
    const minute = scalar(answer.minute);
    const second = scalar(answer.second);
    source = [hour, minute, second].filter(Boolean).join(":");
  } else {
    source = displayValue(answer).trim();
  }

  const match = source.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return { label: source, sortKey: Number.POSITIVE_INFINITY };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  const isDuration = question.time?.kind === "duration";
  return {
    label: isDuration
      ? `${hour}:${padded(minute)}:${padded(second)}`
      : `${padded(hour)}:${padded(minute)}`,
    sortKey: hour * 3_600 + minute * 60 + second,
  };
}

function countTemporalValues(
  question: FormQuestion,
  answers: GeneratedAnswer[],
): SummaryValue[] {
  const counts = new Map<string, { count: number; sortKey: number }>();
  for (const answer of answers) {
    const normalized = question.type === "date"
      ? normalizedDateValue(question, answer)
      : normalizedTimeValue(question, answer);
    const current = counts.get(normalized.label);
    counts.set(normalized.label, {
      count: (current?.count ?? 0) + 1,
      sortKey: Math.min(current?.sortKey ?? normalized.sortKey, normalized.sortKey),
    });
  }

  return [...counts.entries()]
    .sort(([leftLabel, left], [rightLabel, right]) => {
      if (left.sortKey !== right.sortKey) return left.sortKey - right.sortKey;
      return leftLabel.localeCompare(rightLabel);
    })
    .map(([label, value]) => ({
      label,
      count: value.count,
      percentage: percentage(value.count, answers.length),
    }));
}

export function summarizeQuestion(
  question: FormQuestion,
  responses: GeneratedResponse[],
): QuestionSummary {
  const answers = responses
    .map((response) => response.answers[question.id])
    .filter(hasAnswer);

  if (question.type === "single_choice" || question.type === "dropdown") {
    const stringAnswers = answers.filter(
      (answer): answer is string => typeof answer === "string",
    );
    const labels = question.options
      .filter((option) => !option.isOther)
      .map((option) => option.label);
    return {
      kind: "pie",
      responseCount: stringAnswers.length,
      values: countValues(
        stringAnswers.map((answer) => canonicalOptionLabel(question, answer)),
        stringAnswers.length,
        labels,
      ),
    };
  }

  if (question.type === "checkboxes") {
    const answerSets = answers
      .map(uniqueSelections)
      .filter((answer) => answer.length > 0);
    const selected = answerSets.flatMap((answer) =>
      answer.map((value) => canonicalOptionLabel(question, value)),
    );
    const labels = question.options
      .filter((option) => !option.isOther)
      .map((option) => option.label);
    return {
      kind: "horizontal_bars",
      responseCount: answerSets.length,
      values: countValues(selected, answerSets.length, labels),
    };
  }

  if (question.type === "short_text") {
    const values = answers.map(displayValue);
    if (constraintsForQuestion(question).textKind !== "number") {
      return {
        kind: "text_list",
        responseCount: values.length,
        values,
      };
    }

    const numericValues = values.map(numericLabel);
    return {
      kind: "vertical_bars",
      responseCount: numericValues.length,
      values: countValues(numericValues, numericValues.length).sort(compareNumericLabels),
    };
  }

  if (question.type === "paragraph") {
    const values = answers.map(displayValue);
    return {
      kind: "text_list",
      responseCount: values.length,
      values,
    };
  }

  if (question.type === "scale" || question.type === "rating") {
    const labels = question.options.map((option) => option.label);
    const stringAnswers = answers
      .filter((answer): answer is string => typeof answer === "string")
      .map((answer) => canonicalOptionLabel(question, answer));
    const numericAnswers = stringAnswers
      .map(Number)
      .filter((value) => Number.isFinite(value));
    return {
      kind: "vertical_bars",
      responseCount: stringAnswers.length,
      values: countValues(stringAnswers, stringAnswers.length, labels),
      ...(question.type === "rating" && numericAnswers.length > 0
        ? {
            average:
              numericAnswers.reduce((sum, value) => sum + value, 0) /
              numericAnswers.length,
          }
        : {}),
    };
  }

  if (question.type === "grid_single" || question.type === "grid_checkbox") {
    const gridAnswers = answers.filter(isRecord);
    const rows = question.grid?.rows ?? [];
    const columns = question.grid?.columns.map((column) => column.label) ?? [];
    return {
      kind: "grid",
      responseCount: gridAnswers.length,
      rows: rows.map((row) => {
        const rowSelections = gridAnswers
          .map((answer) =>
            answer[row.id] ??
            (row.entryId ? answer[row.entryId] : undefined) ??
            answer[row.label],
          )
          .filter((answer): answer is string | string[] => answer !== undefined)
          .map((answer) => uniqueSelections(answer))
          .filter((answer) => answer.length > 0);
        const selected = rowSelections.flatMap((answer) =>
          answer.map((value) => canonicalGridColumnLabel(question, value)),
        );
        return {
          label: row.label,
          answeredCount: rowSelections.length,
          values: countValues(selected, rowSelections.length, columns),
        };
      }),
    };
  }

  if (question.type === "date" || question.type === "time") {
    return {
      kind: "temporal",
      responseCount: answers.length,
      values: countTemporalValues(question, answers),
    };
  }

  return { kind: "unsupported", responseCount: answers.length };
}
