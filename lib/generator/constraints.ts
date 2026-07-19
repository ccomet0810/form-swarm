import type { FormQuestion } from "../domain/form-schema";

type UnknownRecord = Record<string, unknown>;

export interface NormalizedQuestionConstraints {
  textKind: "plain" | "number" | "email" | "url";
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  minSelections?: number;
  maxSelections?: number;
  exactSelections?: number;
  excludedNumberRange?: { min: number; max: number };
  uniqueGridColumns: boolean;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function finite(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function firstNumber(
  sources: Array<UnknownRecord | null>,
  keys: string[],
): number | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = finite(source[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function firstString(
  sources: Array<UnknownRecord | null>,
  keys: string[],
): string | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

export function constraintsForQuestion(
  question: FormQuestion,
): NormalizedQuestionConstraints {
  const extended = question as FormQuestion & UnknownRecord;
  const validation = record(extended.validation);
  const text = record(validation?.text) ?? record(extended.textValidation);
  const number = record(validation?.number) ?? record(extended.numberValidation);
  const selection =
    record(validation?.selection) ?? record(extended.selectionValidation);
  const grid = record(validation?.grid) ?? record(extended.gridValidation);
  const sources = [validation, text, number, selection];
  const validations = Array.isArray(extended.validations)
    ? extended.validations.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  const numberRange = validations.find((value) => value.kind === "number_range");
  const minLengthRule = validations.find(
    (value) => value.kind === "text_length" && value.operator === "min",
  );
  const maxLengthRule = validations.find(
    (value) => value.kind === "text_length" && value.operator === "max",
  );
  const minSelectionRule = validations.find(
    (value) => value.kind === "selection_count" && value.operator === "min",
  );
  const maxSelectionRule = validations.find(
    (value) => value.kind === "selection_count" && value.operator === "max",
  );
  const exactSelectionRule = validations.find(
    (value) => value.kind === "selection_count" && value.operator === "exact",
  );
  const declaredKind = firstString(sources, ["kind", "type", "format"]);
  const textKind =
    declaredKind === "number" || declaredKind === "numeric"
      ? "number"
      : declaredKind === "email"
        ? "email"
        : declaredKind === "url"
          ? "url"
          : "plain";

  const uniqueGridColumns =
    [
      grid?.uniqueColumns,
      grid?.limitOneResponsePerColumn,
      validation?.uniqueGridColumns,
      extended.limitOneResponsePerColumn,
      (record(extended.grid) ?? {}).uniqueColumns,
      (record(extended.grid) ?? {}).limitOneResponsePerColumn,
    ].some((value) => bool(value) === true);

  return {
    textKind: numberRange ? "number" : textKind,
    minLength:
      finite(minLengthRule?.value) ??
      firstNumber(sources, ["minLength", "minimumLength"]),
    maxLength:
      finite(maxLengthRule?.value) ??
      firstNumber(sources, ["maxLength", "maximumLength"]),
    minValue:
      numberRange?.operator === "between"
        ? finite(numberRange.min)
        : firstNumber(sources, ["minValue", "minimum", "min"]),
    maxValue:
      numberRange?.operator === "between"
        ? finite(numberRange.max)
        : firstNumber(sources, ["maxValue", "maximum", "max"]),
    pattern: firstString(sources, ["pattern", "regex"]),
    minSelections:
      finite(minSelectionRule?.value) ??
      finite(exactSelectionRule?.value) ??
      firstNumber(sources, [
        "minSelections",
        "minimumSelections",
        "minSelected",
      ]),
    maxSelections:
      finite(maxSelectionRule?.value) ??
      finite(exactSelectionRule?.value) ??
      firstNumber(sources, [
        "maxSelections",
        "maximumSelections",
        "maxSelected",
      ]),
    exactSelections: finite(exactSelectionRule?.value),
    excludedNumberRange:
      numberRange?.operator === "not_between" &&
      finite(numberRange.min) !== undefined &&
      finite(numberRange.max) !== undefined
        ? { min: finite(numberRange.min)!, max: finite(numberRange.max)! }
        : undefined,
    uniqueGridColumns,
  };
}

export function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function padTextToMinimum(value: string, minimum: number): string {
  if (Array.from(value).length >= minimum) return value;
  const filler = " 테스트 응답 내용을 구체적으로 작성했습니다.";
  let result = value;
  while (Array.from(result).length < minimum) result += filler;
  return result;
}
