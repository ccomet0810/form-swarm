import type {
  FormOption,
  FormQuestion,
  FormSection,
  ImportedForm,
  QuestionType,
} from "../../domain/form-schema";
import { FormImportError } from "./errors";

export const GOOGLE_FORMS_PARSER_VERSION = "fb-public-load-data/2026-07-v2";

type UnknownArray = unknown[];

const TYPE_MAP: Record<number, QuestionType> = {
  0: "short_text",
  1: "paragraph",
  2: "single_choice",
  4: "checkboxes",
  5: "scale",
  7: "grid_single",
  18: "rating",
};

function asArray(value: unknown): UnknownArray {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isEntryId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function hasValidRequiredFlag(rawEntry: UnknownArray): boolean {
  return rawEntry[2] === 0 || rawEntry[2] === 1;
}

function hasValidOptions(rawEntry: UnknownArray): boolean {
  const rawOptions = rawEntry[1];
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return false;

  return rawOptions.every((rawOption) => {
    if (!Array.isArray(rawOption)) return false;
    const label = asString(rawOption[0]);
    const isOther = rawOption[4] === 1 && (label === "" || label === null);
    return isOther || (label !== null && label.trim().length > 0);
  });
}

function optionSignature(rawEntry: UnknownArray): string | null {
  if (!hasValidOptions(rawEntry)) return null;
  return JSON.stringify(
    asArray(rawEntry[1]).map((rawOption) => {
      const option = asArray(rawOption);
      return [asString(option[0]), option[4] === 1];
    }),
  );
}

function hasValidRecognizedShape(rawType: number, rawEntries: UnknownArray[]): boolean {
  if (rawEntries.length === 0) return false;
  if (
    rawEntries.some((entry) => !isEntryId(entry[0]) || !hasValidRequiredFlag(entry)) ||
    new Set(rawEntries.map((entry) => String(entry[0]))).size !== rawEntries.length
  ) {
    return false;
  }

  if (rawType === 0 || rawType === 1) return rawEntries.length === 1;

  if (rawType === 2 || rawType === 4 || rawType === 5 || rawType === 18) {
    return rawEntries.length === 1 && hasValidOptions(rawEntries[0]);
  }

  if (rawType === 7) {
    const columns = optionSignature(rawEntries[0]);
    return (
      columns !== null &&
      rawEntries.every(
        (entry) =>
          optionSignature(entry) === columns &&
          (asString(asArray(entry[3])[0])?.trim().length ?? 0) > 0,
      )
    );
  }

  return false;
}

function extractJsonArrayLiteral(html: string): string {
  const markerIndex = html.indexOf("FB_PUBLIC_LOAD_DATA_");
  if (markerIndex < 0) {
    throw new FormImportError(
      "Google Forms 내부 데이터를 찾지 못했습니다.",
      "PAYLOAD_NOT_FOUND",
      422,
    );
  }

  const start = html.indexOf("[", markerIndex);
  if (start < 0) {
    throw new FormImportError(
      "Google Forms 내부 데이터 시작점을 찾지 못했습니다.",
      "PAYLOAD_NOT_FOUND",
      422,
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }

  throw new FormImportError(
    "Google Forms 내부 데이터가 완전하지 않습니다.",
    "PAYLOAD_INVALID",
    422,
  );
}

export function extractPublicLoadData(html: string): UnknownArray {
  try {
    const parsed = JSON.parse(extractJsonArrayLiteral(html));
    if (!Array.isArray(parsed)) throw new Error("Payload is not an array");
    return parsed;
  } catch (error) {
    if (error instanceof FormImportError) throw error;
    throw new FormImportError(
      "Google Forms 내부 데이터 형식을 해석하지 못했습니다.",
      "PAYLOAD_INVALID",
      422,
    );
  }
}

function extractOptions(rawEntry: UnknownArray): FormOption[] {
  return asArray(rawEntry[1]).map((rawOption, optionIndex) => {
    const option = asArray(rawOption);
    const rawLabel = asString(option[0]);
    const isOther = option[4] === 1 && (rawLabel === "" || rawLabel === null);
    const label = isOther ? "기타" : (rawLabel ?? `선택지 ${optionIndex + 1}`);
    return { label, value: isOther ? "__other__" : label, isOther };
  });
}

function sectionTitleFromQuestion(title: string): string | null {
  return title.match(/^\[(섹션\s*\d+\s*:\s*[^\]]+)\]/)?.[1]?.trim() ?? null;
}

function createSection(index: number, item?: UnknownArray): FormSection {
  const markerTitle = asString(item?.[1])?.trim();
  return {
    id: `section-${index + 1}`,
    itemId: item?.[0] == null ? null : String(item[0]),
    index,
    title:
      markerTitle && markerTitle !== "제목 없는 섹션"
        ? markerTitle
        : `섹션 ${index + 1}`,
    description: asString(item?.[2]),
    questionIds: [],
  };
}

function mapQuestion(
  item: UnknownArray,
  index: number,
  sectionId: string,
): { question: FormQuestion; structuralFailure: boolean } {
  const rawType = typeof item[3] === "number" ? item[3] : -1;
  const declaredType = TYPE_MAP[rawType] ?? "unknown";
  const rawEntries = asArray(item[4]).map(asArray);
  const entryIds = rawEntries
    .map((entry) => entry[0])
    .filter(isEntryId)
    .map(String);
  const structuralFailure =
    declaredType !== "unknown" && !hasValidRecognizedShape(rawType, rawEntries);
  const type = structuralFailure ? "unknown" : declaredType;
  const title = asString(item[1])?.trim() || `문항 ${index + 1}`;
  const options =
    type !== "unknown" && rawEntries[0] && hasValidOptions(rawEntries[0])
      ? extractOptions(rawEntries[0])
      : [];
  const question: FormQuestion = {
    id: `question-${String(item[0] ?? index)}`,
    itemId: String(item[0] ?? index),
    entryIds,
    sectionId,
    index,
    title,
    description: asString(item[2]),
    type,
    required: rawEntries.some((entry) => entry[2] === 1),
    options,
    rawType,
  };

  if (type === "scale") {
    const labels = asArray(rawEntries[0]?.[3]);
    question.scale = {
      lowLabel: asString(labels[0]),
      highLabel: asString(labels[1]),
    };
  }

  if (type === "grid_single") {
    const rows = rawEntries.map((entry, rowIndex) => ({
      id: String(entry[0] ?? rowIndex),
      label: asString(asArray(entry[3])[0]) ?? `행 ${rowIndex + 1}`,
    }));
    const columns = options.map((option, columnIndex) => ({
      id: `column-${columnIndex + 1}`,
      label: option.label,
    }));
    question.grid = {
      rows,
      columns,
      binding: "google_internal_row_ids",
    };
    question.options = columns.map((column) => ({
      label: column.label,
      value: column.label,
      isOther: false,
    }));
  }

  return { question, structuralFailure };
}

export function parseGoogleFormHtml(input: {
  html: string;
  requestedUrl: string;
  canonicalUrl: string;
  publicId: string;
  fetchedAt?: string;
}): ImportedForm {
  const payload = extractPublicLoadData(input.html);
  const formData = asArray(payload[1]);
  const rawItems = asArray(formData[1]).map(asArray);
  const title = asString(formData[8])?.trim() || asString(payload[3])?.trim();

  if (!title || rawItems.length === 0) {
    throw new FormImportError(
      "공개 문항이 있는 Google Forms 페이지가 아닙니다.",
      "UNSUPPORTED_PAGE",
      422,
    );
  }

  const sections: FormSection[] = [createSection(0)];
  const questions: FormQuestion[] = [];
  let structurallyInvalidQuestionCount = 0;
  let currentSection = sections[0];

  for (const item of rawItems) {
    if (item[3] === 8) {
      currentSection = createSection(sections.length, item);
      sections.push(currentSection);
      continue;
    }

    const { question, structuralFailure } = mapQuestion(
      item,
      questions.length,
      currentSection.id,
    );
    if (structuralFailure) structurallyInvalidQuestionCount += 1;
    questions.push(question);
    currentSection.questionIds.push(question.id);

    const inferredSectionTitle = sectionTitleFromQuestion(question.title);
    if (
      inferredSectionTitle &&
      (currentSection.title === `섹션 ${currentSection.index + 1}` ||
        currentSection.title === "기본 문항")
    ) {
      currentSection.title = inferredSectionTitle;
    }
  }

  if (sections[0].questionIds.length === 0 && sections[0].itemId === null) {
    sections[0].title = "소개";
  }

  const entryIdOwners = new Map<string, number[]>();
  questions.forEach((question, questionIndex) => {
    question.entryIds.forEach((entryId) => {
      const owners = entryIdOwners.get(entryId) ?? [];
      owners.push(questionIndex);
      entryIdOwners.set(entryId, owners);
    });
  });
  const duplicateEntryIds = [...entryIdOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([entryId]) => entryId);
  const duplicateEntryIdSet = new Set(duplicateEntryIds);
  for (const question of questions) {
    if (!question.entryIds.some((entryId) => duplicateEntryIdSet.has(entryId))) continue;
    question.type = "unknown";
    delete question.scale;
    delete question.grid;
  }

  const unsupportedQuestionCount = questions.filter(
    (question) => question.type === "unknown",
  ).length;
  const warnings = [
    "Google이 공개적으로 문서화하지 않은 응답 페이지 payload를 읽기 전용으로 해석합니다.",
  ];
  if (unsupportedQuestionCount > 0) {
    warnings.push(`${unsupportedQuestionCount}개 문항 유형은 아직 지원되지 않습니다.`);
  }
  if (structurallyInvalidQuestionCount > 0) {
    warnings.push(
      `${structurallyInvalidQuestionCount}개 문항의 내부 구조가 예상 형식과 달라 생성에서 제외했습니다.`,
    );
  }
  if (duplicateEntryIds.length > 0) {
    warnings.push(
      `${duplicateEntryIds.length}개 중복 입력 ID가 발견되어 관련 문항을 생성에서 제외했습니다.`,
    );
  }

  return {
    schemaVersion: "1.0",
    parserVersion: GOOGLE_FORMS_PARSER_VERSION,
    source: {
      requestedUrl: input.requestedUrl,
      canonicalUrl: input.canonicalUrl,
      publicId: input.publicId,
      fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    },
    title,
    description: asString(formData[0]),
    locale:
      input.html.match(/<html[^>]+lang=["']([^"']+)/i)?.[1] ?? "und",
    sections,
    questions,
    diagnostics: { warnings, unsupportedQuestionCount },
  };
}
