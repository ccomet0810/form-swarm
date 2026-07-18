import type {
  FormOption,
  FormQuestion,
  GeneratedAnswer,
  GeneratedResponse,
  GenerationRule,
  ImportedForm,
} from "../domain/form-schema";

export const RESPONSE_GENERATOR_VERSION = "seeded-preview/2026-07-v1";

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

function answerQuestion(
  question: FormQuestion,
  rule: GenerationRule,
  responseIndex: number,
  random: () => number,
): GeneratedAnswer | undefined {
  if (!rule.enabled) return undefined;

  if (rule.kind === "text") {
    if (rule.samples.length === 0) return `샘플 응답 ${responseIndex + 1}`;
    if (rule.mode === "sequence") {
      return rule.samples[responseIndex % rule.samples.length];
    }
    return pick(random, rule.samples) ?? `샘플 응답 ${responseIndex + 1}`;
  }

  const selectableOptions = question.options.filter((option) => !option.isOther);

  if (rule.kind === "choice") {
    if (rule.mode === "fixed") {
      return (
        selectableOptions.find((option) => option.value === rule.fixedValue)?.label ??
        selectableOptions[0]?.label
      );
    }
    const option =
      rule.mode === "middle_weighted"
        ? pickMiddleWeighted(random, selectableOptions)
        : pick(random, selectableOptions);
    return option?.label;
  }

  if (rule.kind === "checkboxes") {
    const requestedMin = Number.isFinite(rule.minSelections)
      ? Math.floor(rule.minSelections)
      : 0;
    const requestedMax = Number.isFinite(rule.maxSelections)
      ? Math.floor(rule.maxSelections)
      : requestedMin;
    const min = Math.max(
      question.required ? 1 : 0,
      Math.min(requestedMin, selectableOptions.length),
    );
    const max = Math.min(
      Math.max(min, requestedMax),
      selectableOptions.length,
    );
    const count = selectableOptions.length === 0 ? 0 : randomInt(random, min, max);
    return shuffled(random, selectableOptions)
      .slice(0, count)
      .map((option) => option.label);
  }

  if (rule.kind === "grid" && question.grid) {
    return Object.fromEntries(
      question.grid.rows.map((row) => {
        const columnOptions = question.grid!.columns.map((column) => ({
          label: column.label,
          value: column.label,
          isOther: false,
        }));
        const column =
          rule.mode === "middle_weighted"
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
  rules: GenerationRule[];
  count: number;
  seed: string;
}): GeneratedResponse[] {
  const requestedCount = Number.isFinite(input.count) ? Math.floor(input.count) : 1;
  const count = Math.max(1, Math.min(500, requestedCount));
  const random = mulberry32(hashSeed(input.seed));
  const ruleByQuestion = new Map(
    input.rules.map((rule) => [rule.questionId, rule]),
  );
  const batchFingerprint = `${input.form.source.publicId}:${input.form.parserVersion}:${JSON.stringify(input.rules)}:${input.seed}`;

  return Array.from({ length: count }, (_, responseIndex) => {
    const answers: Record<string, GeneratedAnswer> = {};

    for (const question of input.form.questions) {
      const rule = ruleByQuestion.get(question.id);
      if (!rule) continue;
      const answer = answerQuestion(question, rule, responseIndex, random);
      if (answer !== undefined) answers[question.id] = answer;
    }

    return {
      id: `${hashSeed(`${batchFingerprint}:${responseIndex}`).toString(16).padStart(8, "0")}${hashSeed(`${responseIndex}:${batchFingerprint}`).toString(16).padStart(8, "0")}`,
      index: responseIndex,
      answers,
    };
  });
}
