import type {
  FormOption,
  FormQuestion,
  GeneratedAnswer,
  GeneratedResponse,
  GenerationRule,
  ImportedForm,
} from "../domain/form-schema";
import {
  constraintsForQuestion,
  padTextToMinimum,
} from "./constraints";
import { resolveResponseNavigation } from "./navigation";
import { matchesTextConstraints } from "./validation";

export const RESPONSE_GENERATOR_VERSION = "deterministic-preview/2026-07-v4";

export interface GeneratedResponseWithNavigation extends GeneratedResponse {
  visitedSectionIds: string[];
  pageHistory: number[];
}

export type GeneratorRule = GenerationRule & { omitProbability?: number };

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function pick<T>(random: () => number, values: T[]): T | undefined {
  return values[Math.floor(random() * values.length)];
}

function pickMiddleWeighted(
  random: () => number,
  options: FormOption[],
): FormOption | undefined {
  if (options.length <= 2) return pick(random, options);
  const midpoint = (options.length - 1) / 2;
  const weights = options.map(
    (_, index) => Math.max(1, options.length - Math.abs(index - midpoint) * 1.4),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < options.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return options[index];
  }
  return options.at(-1);
}

function shuffled<T>(random: () => number, values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function usableOtherSamples(
  question: FormQuestion,
  rule: GeneratorRule,
): string[] {
  if (
    (rule.kind !== "choice" && rule.kind !== "checkboxes") ||
    !rule.other?.enabled ||
    !question.options.some((option) => option.isOther)
  ) {
    return [];
  }

  const regularValues = new Set(
    question.options
      .filter((option) => !option.isOther)
      .flatMap((option) => [option.label, option.value]),
  );
  return [...new Set(
    rule.other.samples
      .map((sample) => sample.trim())
      .filter(
        (sample) =>
          sample.length > 0 &&
          sample.length <= 20_000 &&
          !regularValues.has(sample),
      ),
  )];
}

function otherProbability(rule: GeneratorRule): number {
  if (rule.kind !== "choice" && rule.kind !== "checkboxes") return 0;
  const probability = rule.other?.probability;
  return Number.isFinite(probability)
    ? Math.max(0, Math.min(1, probability!))
    : 0;
}

function sampledNumberInInclusiveRange(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  if (minimum === maximum) return minimum;

  const span = maximum - minimum;
  // The normalized model has no separate integer-only flag. Preserve the
  // useful distinction it does carry: two safe-integer bounds produce an
  // integer, while any decimal bound produces a real value.
  if (
    Number.isSafeInteger(minimum) &&
    Number.isSafeInteger(maximum) &&
    Number.isSafeInteger(span)
  ) {
    return randomInt(random, minimum, maximum);
  }

  const sampled = minimum + span * random();
  const readable = Number(sampled.toPrecision(15));
  return Math.max(minimum, Math.min(maximum, readable));
}

function sampledNumberOutsideClosedRange(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  // `not_between` excludes both normalized endpoints, matching validation.ts.
  const integerRange = Number.isSafeInteger(minimum) && Number.isSafeInteger(maximum);
  const offset = () => integerRange
    ? randomInt(random, 1, 100)
    : Math.max(1, Math.abs(minimum), Math.abs(maximum)) * Number.EPSILON * 4 +
      1 + random() * 100;
  const below = minimum - offset();
  const above = maximum + offset();
  const candidates = [below, above].filter((value) =>
    Number.isFinite(value) && (value < minimum || value > maximum),
  );
  return pick(random, candidates) ?? 0;
}

function numericTextAnswer(
  question: FormQuestion,
  random: () => number,
): string {
  const constraints = constraintsForQuestion(question);
  if (constraints.excludedNumberRange) {
    const { min, max } = constraints.excludedNumberRange;
    return String(sampledNumberOutsideClosedRange(random, min, max));
  }

  const minimum = constraints.minValue;
  const maximum = constraints.maxValue;
  const low = minimum ?? (maximum === undefined ? 1 : maximum - 100);
  const high = maximum ?? (minimum === undefined ? 101 : minimum + 100);
  if (low > high) return String(low);
  return String(sampledNumberInInclusiveRange(random, low, high));
}

function normalizedTextAnswer(
  question: FormQuestion,
  candidate: string,
  responseIndex: number,
  random: () => number,
): string {
  const constraints = constraintsForQuestion(question);
  if (matchesTextConstraints(question, candidate)) return candidate;
  if (constraints.textKind === "number") {
    return numericTextAnswer(question, random);
  }
  if (constraints.textKind === "email") {
    return `test${responseIndex + 1}@example.com`;
  }
  if (constraints.textKind === "url") {
    return `https://example.com/response/${responseIndex + 1}`;
  }
  let answer = candidate;
  if (constraints.minLength !== undefined) {
    answer = padTextToMinimum(answer, Math.max(0, Math.trunc(constraints.minLength)));
  }
  if (constraints.maxLength !== undefined) {
    answer = Array.from(answer)
      .slice(0, Math.max(0, Math.trunc(constraints.maxLength)))
      .join("");
  }
  return answer;
}

function generatedDateAnswer(
  question: FormQuestion,
  responseIndex: number,
): string {
  const extended = question as FormQuestion & {
    date?: { includeYear?: boolean; includeTime?: boolean };
  };
  const year = 2026 + (responseIndex % 2);
  const month = String((responseIndex % 12) + 1).padStart(2, "0");
  const day = String((responseIndex % 27) + 1).padStart(2, "0");
  const date = extended.date?.includeYear === false
    ? `${month}-${day}`
    : `${year}-${month}-${day}`;
  if (!extended.date?.includeTime) return date;
  const hour = String(8 + (responseIndex % 10)).padStart(2, "0");
  const minute = String((responseIndex * 7) % 60).padStart(2, "0");
  return `${date}T${hour}:${minute}`;
}

function generatedTimeAnswer(
  question: FormQuestion,
  responseIndex: number,
): string {
  const extended = question as FormQuestion & {
    time?: { kind?: "time_of_day" | "duration" };
  };
  if (extended.time?.kind === "duration") {
    const hour = responseIndex % 4;
    const minute = String((responseIndex * 11) % 60).padStart(2, "0");
    const second = String((responseIndex * 13) % 60).padStart(2, "0");
    return `${hour}:${minute}:${second}`;
  }
  const hour = String(8 + (responseIndex % 12)).padStart(2, "0");
  const minute = String((responseIndex * 5) % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function shouldOmitOptional(
  question: FormQuestion,
  rule: GeneratorRule,
  random: () => number,
): boolean {
  if (question.required || !rule.enabled) return false;
  const configured = rule.omitProbability;
  const probability = Number.isFinite(configured)
    ? Math.max(0, Math.min(1, configured!))
    : 0.15;
  return random() < probability;
}

function answerQuestion(
  question: FormQuestion,
  rule: GeneratorRule,
  responseIndex: number,
  random: () => number,
): GeneratedAnswer | undefined {
  if (!rule.enabled) return undefined;

  if (question.type === "date") {
    return generatedDateAnswer(question, responseIndex);
  }
  if (question.type === "time") {
    return generatedTimeAnswer(question, responseIndex);
  }

  if (rule.kind === "text") {
    if (rule.samples.length === 0) {
      return normalizedTextAnswer(
        question,
        `샘플 응답 ${responseIndex + 1}`,
        responseIndex,
        random,
      );
    }
    if (rule.mode === "sequence") {
      return normalizedTextAnswer(
        question,
        rule.samples[responseIndex % rule.samples.length],
        responseIndex,
        random,
      );
    }
    return normalizedTextAnswer(
      question,
      pick(random, rule.samples) ?? `샘플 응답 ${responseIndex + 1}`,
      responseIndex,
      random,
    );
  }

  const regularOptions = question.options.filter((option) => !option.isOther);
  const otherSamples = usableOtherSamples(question, rule);

  if (rule.kind === "choice") {
    if (rule.mode === "fixed") {
      const fixedOption = regularOptions.find(
        (option) =>
          option.value === rule.fixedValue || option.label === rule.fixedValue,
      );
      if (fixedOption) return fixedOption.label;
      if (rule.fixedValue && otherSamples.includes(rule.fixedValue)) {
        return rule.fixedValue;
      }
      if (rule.fixedValue === "__other__" && otherSamples.length > 0) {
        return pick(random, otherSamples);
      }
      return regularOptions[0]?.label ?? pick(random, otherSamples);
    }
    if (
      otherSamples.length > 0 &&
      (regularOptions.length === 0 || random() < otherProbability(rule))
    ) {
      return pick(random, otherSamples);
    }
    const option =
      rule.mode === "middle_weighted"
        ? pickMiddleWeighted(random, regularOptions)
        : pick(random, regularOptions);
    return option?.label ?? pick(random, otherSamples);
  }

  if (rule.kind === "checkboxes") {
    const constraints = constraintsForQuestion(question);
    const canGenerateOther = otherSamples.length > 0;
    const totalOptions = regularOptions.length + (canGenerateOther ? 1 : 0);
    if (totalOptions === 0) return undefined;
    const requestedMin = Number.isFinite(rule.minSelections)
      ? Math.floor(rule.minSelections)
      : 0;
    const requestedMax = Number.isFinite(rule.maxSelections)
      ? Math.floor(rule.maxSelections)
      : requestedMin;
    const min = Math.max(
      question.required ? 1 : 0,
      Math.min(
        constraints.exactSelections ?? constraints.minSelections ?? requestedMin,
        totalOptions,
      ),
    );
    const max = Math.min(
      Math.max(
        min,
        constraints.exactSelections ?? constraints.maxSelections ?? requestedMax,
      ),
      totalOptions,
    );
    const count = randomInt(random, min, max);
    if (count === 0) return [];
    const includeOther =
      canGenerateOther &&
      (count > regularOptions.length || random() < otherProbability(rule));
    const regularCount = Math.min(
      regularOptions.length,
      count - (includeOther ? 1 : 0),
    );
    const selected = shuffled(random, regularOptions)
      .slice(0, regularCount)
      .map((option) => option.label);
    if (includeOther) {
      const customAnswer = pick(random, otherSamples);
      if (customAnswer) selected.push(customAnswer);
    }
    return shuffled(random, selected);
  }

  if (rule.kind === "grid" && question.grid) {
    const constraints = constraintsForQuestion(question);
    const columnOptions = question.grid.columns.map((column) => ({
      label: column.label,
      value: column.label,
      isOther: false,
    }));
    if (question.type === "grid_checkbox") {
      return Object.fromEntries(
        question.grid.rows.map((row) => {
          const max = Math.min(3, columnOptions.length);
          const count = columnOptions.length === 0 ? 0 : randomInt(random, 1, max);
          return [
            row.label,
            shuffled(random, columnOptions)
              .slice(0, count)
              .map((column) => column.label),
          ];
        }),
      );
    }
    const available = constraints.uniqueGridColumns
      ? shuffled(random, columnOptions)
      : columnOptions;
    return Object.fromEntries(
      question.grid.rows.map((row, rowIndex) => {
        const column = constraints.uniqueGridColumns
          ? available[rowIndex]
          : rule.mode === "middle_weighted"
            ? pickMiddleWeighted(random, columnOptions)
            : pick(random, columnOptions);
        return [row.label, column?.label ?? ""];
      }),
    );
  }

  return undefined;
}

export function generateResponses(input: {
  form: ImportedForm;
  rules: GeneratorRule[];
  count: number;
  seed?: string;
}): GeneratedResponseWithNavigation[] {
  const requestedCount = Number.isFinite(input.count) ? Math.floor(input.count) : 1;
  const count = Math.max(1, Math.min(500, requestedCount));
  const internalSeed =
    input.seed?.trim() ||
    `${input.form.source.publicId}:${input.form.parserVersion}:${JSON.stringify(input.rules)}`;
  const random = mulberry32(hashSeed(internalSeed));
  const ruleByQuestion = new Map(
    input.rules.map((rule) => [rule.questionId, rule]),
  );
  const batchFingerprint = `${input.form.source.publicId}:${input.form.parserVersion}:${JSON.stringify(input.rules)}:${internalSeed}`;

  return Array.from({ length: count }, (_, responseIndex) => {
    const answers: Record<string, GeneratedAnswer> = {};

    for (const question of input.form.questions) {
      const rule = ruleByQuestion.get(question.id);
      if (!rule) continue;
      if (shouldOmitOptional(question, rule, random)) continue;
      const answer = answerQuestion(question, rule, responseIndex, random);
      if (answer !== undefined) answers[question.id] = answer;
    }

    const navigation = resolveResponseNavigation(
      input.form,
      answers as Record<string, unknown>,
    );
    const reachedSections = new Set(navigation.visitedSectionIds);
    for (const question of input.form.questions) {
      if (!reachedSections.has(question.sectionId)) delete answers[question.id];
    }

    return {
      id: `${hashSeed(`${batchFingerprint}:${responseIndex}`).toString(16).padStart(8, "0")}${hashSeed(`${responseIndex}:${batchFingerprint}`).toString(16).padStart(8, "0")}`,
      index: responseIndex,
      answers,
      ...navigation,
    };
  });
}
