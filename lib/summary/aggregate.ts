import type {
  FormQuestion,
  GeneratedAnswer,
  GeneratedResponse,
} from "../domain/form-schema";

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

function hasAnswer(answer: GeneratedAnswer | undefined): answer is GeneratedAnswer {
  if (answer === undefined) return false;
  if (typeof answer === "string") return answer.trim().length > 0;
  if (Array.isArray(answer)) return answer.length > 0;
  return Object.keys(answer).length > 0;
}

function displayValue(answer: GeneratedAnswer): string {
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.join(", ");

  const temporalKeys = ["year", "month", "day", "hour", "minute", "second"];
  if (Object.keys(answer).some((key) => temporalKeys.includes(key))) {
    const value = answer as Record<string, string | string[]>;
    const date = [value.year, value.month, value.day]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join("-");
    const time = [value.hour, value.minute, value.second]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(":");
    return [date, time].filter(Boolean).join(" ");
  }

  return Object.entries(answer)
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

export function summarizeQuestion(
  question: FormQuestion,
  responses: GeneratedResponse[],
): QuestionSummary {
  const answers = responses
    .map((response) => response.answers[question.id])
    .filter(hasAnswer);
  const responseCount = answers.length;

  if (question.type === "single_choice" || question.type === "dropdown") {
    const labels = question.options
      .filter((option) => !option.isOther)
      .map((option) => option.label);
    return {
      kind: "pie",
      responseCount,
      values: countValues(
        answers.filter((answer): answer is string => typeof answer === "string"),
        responseCount,
        labels,
      ),
    };
  }

  if (question.type === "checkboxes") {
    const selected = answers.flatMap((answer) =>
      Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : [],
    );
    const labels = question.options
      .filter((option) => !option.isOther)
      .map((option) => option.label);
    return {
      kind: "horizontal_bars",
      responseCount,
      values: countValues(selected, responseCount, labels),
    };
  }

  if (question.type === "short_text") {
    return {
      kind: "vertical_bars",
      responseCount,
      values: countValues(
        answers.map(displayValue),
        responseCount,
      ),
    };
  }

  if (question.type === "paragraph") {
    return {
      kind: "text_list",
      responseCount,
      values: [...new Set(answers.map(displayValue))],
    };
  }

  if (question.type === "scale" || question.type === "rating") {
    const labels = question.options.map((option) => option.label);
    const stringAnswers = answers
      .filter((answer): answer is string => typeof answer === "string");
    const numericAnswers = stringAnswers
      .map(Number)
      .filter((value) => Number.isFinite(value));
    return {
      kind: "vertical_bars",
      responseCount,
      values: countValues(stringAnswers, responseCount, labels),
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
      responseCount,
      rows: rows.map((row) => {
        const selected = gridAnswers.flatMap((answer) => {
          const value = answer[row.id] ?? answer[row.label];
          if (Array.isArray(value)) return value;
          return typeof value === "string" && value.length > 0 ? [value] : [];
        });
        return {
          label: row.label,
          values: countValues(selected, responseCount, columns),
        };
      }),
    };
  }

  if (question.type === "date" || question.type === "time") {
    return {
      kind: "temporal",
      responseCount,
      values: countValues(answers.map(displayValue), responseCount),
    };
  }

  return { kind: "unsupported", responseCount };
}
