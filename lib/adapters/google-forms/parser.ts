import type {
  FormEntryBinding,
  FormImageItem,
  FormImageRef,
  FormItem,
  FormNavigationTarget,
  FormOption,
  FormQuestion,
  FormQuestionItem,
  FormSection,
  FormSectionItem,
  FormSubmissionMetadata,
  FormTextBlockItem,
  FormValidation,
  FormVideoItem,
  ImportedForm,
  QuestionType,
  SkippedFormItem,
} from "../../domain/form-schema";
import { FormImportError } from "./errors";

export const GOOGLE_FORMS_PARSER_VERSION = "fb-public-load-data/2026-07-v3";

type UnknownArray = unknown[];

const TYPE_MAP: Record<number, QuestionType> = {
  0: "short_text",
  1: "paragraph",
  2: "single_choice",
  3: "dropdown",
  4: "checkboxes",
  5: "scale",
  7: "grid_single",
  9: "date",
  10: "time",
  18: "rating",
};

const FILE_UPLOAD_TYPE = 13;

function asArray(value: unknown): UnknownArray {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIntegerFlag(value: unknown): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

function isEntryId(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function hasValidRequiredFlag(rawEntry: UnknownArray): boolean {
  return asIntegerFlag(rawEntry[2]) !== null;
}

function rawImageTuple(value: unknown): UnknownArray | null {
  const tuple = asArray(value);
  return asString(tuple[0])?.trim() ? tuple : null;
}

function decodeHtml(value: string): string {
  return value.replace(
    /&(?:quot|amp|lt|gt|#39|#x27|#(\d+)|#x([0-9a-f]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      const named: Record<string, string> = {
        "&quot;": '"',
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&#39;": "'",
        "&#x27;": "'",
      };
      return named[entity.toLowerCase()] ?? entity;
    },
  );
}

function tagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

interface RenderedImage {
  url: string;
  altText: string | null;
  renderedWidth: number | null;
}

function extractRenderedImages(html: string): RenderedImage[] {
  const images: RenderedImage[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const url = attributes.src ?? attributes["data-src"];
    if (!url?.startsWith("https://docs.google.com/forms-images-rt/")) continue;
    const widthMatch = url.match(/=w(\d+)(?:$|[-?&#])/);
    images.push({
      url,
      altText: Object.hasOwn(attributes, "alt") ? attributes.alt : null,
      renderedWidth: widthMatch ? Number(widthMatch[1]) : null,
    });
  }
  return images;
}

function questionImages(item: UnknownArray): UnknownArray[] {
  return asArray(item[9]).map(asArray).filter((image) => rawImageTuple(image) !== null);
}

function optionImages(item: UnknownArray): UnknownArray[] {
  const rawEntries = asArray(item[4]).map(asArray);
  if (rawEntries.length === 0) return [];
  return asArray(rawEntries[0][1])
    .map(asArray)
    .map((option) => asArray(option[5]))
    .filter((image) => rawImageTuple(image) !== null);
}

function orderedRawImages(rawItems: UnknownArray[]): UnknownArray[] {
  const images: UnknownArray[] = [];
  for (const item of rawItems) {
    const rawType = item[3];
    if (rawType === FILE_UPLOAD_TYPE) continue;
    if (rawType === 11) {
      const image = rawImageTuple(item[6]);
      if (image) images.push(image);
      continue;
    }
    images.push(...questionImages(item), ...optionImages(item));
  }
  return images;
}

function pairRenderedImages(
  rawImages: UnknownArray[],
  renderedImages: RenderedImage[],
): { pairs: Array<RenderedImage | null>; exact: boolean } {
  if (rawImages.length === 0) return { pairs: [], exact: true };
  const expectedWidths = rawImages.map((rawImage) =>
    asFiniteNumber(asArray(rawImage[2])[0]),
  );
  if (
    rawImages.length === renderedImages.length &&
    expectedWidths.every(
      (expected, index) =>
        expected === null ||
        renderedImages[index].renderedWidth === null ||
        expected === renderedImages[index].renderedWidth,
    )
  ) {
    return { pairs: renderedImages, exact: true };
  }
  const solutions: number[][] = [];
  const current: number[] = [];

  function visit(rawIndex: number, renderedIndex: number): void {
    if (solutions.length > 1) return;
    if (rawIndex === expectedWidths.length) {
      solutions.push([...current]);
      return;
    }
    for (let index = renderedIndex; index < renderedImages.length; index += 1) {
      const expected = expectedWidths[rawIndex];
      const actual = renderedImages[index].renderedWidth;
      if (expected !== null && actual !== null && expected !== actual) continue;
      current.push(index);
      visit(rawIndex + 1, index + 1);
      current.pop();
      if (solutions.length > 1) return;
    }
  }

  visit(0, 0);
  if (solutions.length !== 1) {
    return { pairs: rawImages.map(() => null), exact: false };
  }
  return {
    pairs: solutions[0].map((index) => renderedImages[index]),
    exact: true,
  };
}

function createImageResolver(rawItems: UnknownArray[], html: string): {
  resolve: (rawImage: UnknownArray) => FormImageRef;
  pairedExactly: boolean;
} {
  const rawImages = orderedRawImages(rawItems);
  const { pairs, exact } = pairRenderedImages(rawImages, extractRenderedImages(html));
  let cursor = 0;

  return {
    pairedExactly: exact,
    resolve(rawImage) {
      const dimensions = asArray(rawImage[2]);
      const rendered = pairs[cursor] ?? null;
      cursor += 1;
      return {
        sourceId: asString(rawImage[0])?.trim() ?? "",
        url: rendered?.url ?? null,
        altText: rendered?.altText ?? null,
        width: asFiniteNumber(dimensions[0]),
        height: asFiniteNumber(dimensions[1]),
        alignment: asFiniteNumber(rawImage[1]),
        rawTransform: asFiniteNumber(dimensions[2]),
      };
    },
  };
}

function hasValidOptions(rawEntry: UnknownArray): boolean {
  const rawOptions = rawEntry[1];
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) return false;

  return rawOptions.every((rawOption) => {
    if (!Array.isArray(rawOption)) return false;
    const label = asString(rawOption[0]);
    const isOther = rawOption[4] === 1 && (label === "" || label === null);
    if (!isOther && (label === null || label.trim().length === 0)) return false;
    const image = rawOption[5];
    return image == null || rawImageTuple(image) !== null;
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

function navigationTarget(value: unknown): FormNavigationTarget | null {
  if (value == null) return null;
  if (value === -3 || value === "-3") return { kind: "submit" };
  if (
    (typeof value === "number" && Number.isFinite(value) && value >= 0) ||
    (typeof value === "string" && /^\d+$/.test(value))
  ) {
    return { kind: "section", sectionItemId: String(value) };
  }
  return { kind: "unknown", rawValue: String(value) };
}

function sectionNavigation(value: unknown): FormNavigationTarget {
  return navigationTarget(value) ?? { kind: "next" };
}

interface ValidationResult {
  validations: FormValidation[];
  invalid: boolean;
}

function parseValidations(rawEntry: UnknownArray): ValidationResult {
  if (rawEntry[4] == null) return { validations: [], invalid: false };
  if (!Array.isArray(rawEntry[4])) return { validations: [], invalid: true };

  const validations: FormValidation[] = [];
  for (const rawRuleValue of rawEntry[4]) {
    const rawRule = asArray(rawRuleValue);
    const category = asFiniteNumber(rawRule[0]);
    const operator = asFiniteNumber(rawRule[1]);
    const args = asArray(rawRule[2]);
    const errorMessage = rawRule[3] == null ? null : asString(rawRule[3]);
    if (
      category === null ||
      operator === null ||
      !Number.isInteger(category) ||
      !Number.isInteger(operator) ||
      (rawRule[3] != null && errorMessage === null)
    ) {
      return { validations: [], invalid: true };
    }

    if (category === 1 && (operator === 7 || operator === 8)) {
      const min = asFiniteNumber(args[0]);
      const max = asFiniteNumber(args[1]);
      if (min === null || max === null || min > max || args.length !== 2) {
        return { validations: [], invalid: true };
      }
      validations.push({
        kind: "number_range",
        operator: operator === 7 ? "between" : "not_between",
        min,
        max,
        errorMessage,
        rawCategory: category,
        rawOperator: operator,
      });
      continue;
    }

    if (category === 6 && (operator === 202 || operator === 203)) {
      const value = asFiniteNumber(args[0]);
      if (
        value === null ||
        !Number.isInteger(value) ||
        value < 0 ||
        args.length !== 1
      ) {
        return { validations: [], invalid: true };
      }
      validations.push({
        kind: "text_length",
        operator: operator === 203 ? "min" : "max",
        value,
        errorMessage,
        rawCategory: category,
        rawOperator: operator,
      });
      continue;
    }

    if (category === 7 && (operator === 200 || operator === 201 || operator === 204)) {
      const value = asFiniteNumber(args[0]);
      if (
        value === null ||
        !Number.isInteger(value) ||
        value < 0 ||
        args.length !== 1
      ) {
        return { validations: [], invalid: true };
      }
      validations.push({
        kind: "selection_count",
        operator: operator === 200 ? "min" : operator === 201 ? "max" : "exact",
        value,
        errorMessage,
        rawCategory: category,
        rawOperator: operator,
      });
      continue;
    }

    return { validations: [], invalid: true };
  }

  return { validations, invalid: false };
}

function validationsApplyTo(rawType: number, validations: FormValidation[]): boolean {
  return validations.every((validation) => {
    if (validation.kind === "selection_count") return rawType === 4;
    return rawType === 0 || rawType === 1;
  });
}

function hasNumericOptions(rawEntry: UnknownArray): boolean {
  if (!hasValidOptions(rawEntry)) return false;
  const values = asArray(rawEntry[1]).map((option) =>
    asFiniteNumber(asArray(option)[0]),
  );
  return values.length > 0 && values.every((value) => value !== null);
}

function hasValidRecognizedShape(
  rawType: number,
  rawEntries: UnknownArray[],
): boolean {
  if (rawEntries.length === 0) return false;
  if (
    rawEntries.some((entry) => !isEntryId(entry[0]) || !hasValidRequiredFlag(entry)) ||
    new Set(rawEntries.map((entry) => String(entry[0]))).size !== rawEntries.length
  ) {
    return false;
  }

  for (const entry of rawEntries) {
    const parsed = parseValidations(entry);
    if (parsed.invalid || !validationsApplyTo(rawType, parsed.validations)) return false;
  }

  if (rawType === 0 || rawType === 1) return rawEntries.length === 1;

  if (rawType === 2 || rawType === 3 || rawType === 4) {
    return rawEntries.length === 1 && hasValidOptions(rawEntries[0]);
  }

  if (rawType === 5 || rawType === 18) {
    return rawEntries.length === 1 && hasNumericOptions(rawEntries[0]);
  }

  if (rawType === 7) {
    const columns = optionSignature(rawEntries[0]);
    const modes = rawEntries.map((entry) => asIntegerFlag(asArray(entry[11])[0]));
    return (
      columns !== null &&
      modes[0] !== null &&
      modes.every((mode) => mode === modes[0]) &&
      rawEntries.every(
        (entry) =>
          optionSignature(entry) === columns &&
          (asString(asArray(entry[3])[0])?.trim().length ?? 0) > 0,
      )
    );
  }

  if (rawType === 9) {
    const flags = asArray(rawEntries[0][7]);
    return (
      rawEntries.length === 1 &&
      flags.length >= 2 &&
      asIntegerFlag(flags[0]) !== null &&
      asIntegerFlag(flags[1]) !== null
    );
  }

  if (rawType === 10) {
    const kind = asIntegerFlag(asArray(rawEntries[0][6])[0]);
    return rawEntries.length === 1 && kind !== null;
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

function extractOptions(
  rawEntry: UnknownArray,
  resolveImage: (rawImage: UnknownArray) => FormImageRef,
): FormOption[] {
  return asArray(rawEntry[1]).map((rawOption, optionIndex) => {
    const option = asArray(rawOption);
    const rawLabel = asString(option[0]);
    const isOther = option[4] === 1 && (rawLabel === "" || rawLabel === null);
    const label = isOther ? "기타" : (rawLabel ?? `선택지 ${optionIndex + 1}`);
    const rawImage = rawImageTuple(option[5]);
    return {
      label,
      value: isOther ? "__other__" : label,
      isOther,
      index: optionIndex,
      image: rawImage ? resolveImage(rawImage) : null,
      branchTarget: navigationTarget(option[2]),
    };
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
    navigation: sectionNavigation(item?.[5]),
  };
}

function numericBounds(options: FormOption[]): { min: number; max: number } {
  const values = options.map((option) => Number(option.value));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function mapQuestion(
  item: UnknownArray,
  questionIndex: number,
  itemIndex: number,
  sectionId: string,
  resolveImage: (rawImage: UnknownArray) => FormImageRef,
): { question: FormQuestionItem; structuralFailure: boolean } {
  const rawType = typeof item[3] === "number" ? item[3] : -1;
  const rawEntries = asArray(item[4]).map(asArray);
  const gridMode = asIntegerFlag(asArray(rawEntries[0]?.[11])[0]);
  const declaredType =
    rawType === 7 && gridMode === 1
      ? "grid_checkbox"
      : (TYPE_MAP[rawType] ?? "unknown");
  const entryIds = rawEntries
    .map((entry) => entry[0])
    .filter(isEntryId)
    .map(String);
  const parsedValidations = rawEntries.map(parseValidations);
  const structuralFailure =
    declaredType !== "unknown" && !hasValidRecognizedShape(rawType, rawEntries);
  const type = structuralFailure ? "unknown" : declaredType;
  const title = asString(item[1])?.trim() || `문항 ${questionIndex + 1}`;
  const images = questionImages(item).map(resolveImage);
  const options =
    rawEntries[0] && hasValidOptions(rawEntries[0])
      ? extractOptions(rawEntries[0], resolveImage)
      : [];
  const entryBindings: FormEntryBinding[] = rawEntries
    .filter((entry) => isEntryId(entry[0]))
    .map((entry) => ({
      entryId: String(entry[0]),
      rowId: rawType === 7 ? String(entry[0]) : null,
      required: entry[2] === 1,
    }));
  const validations = structuralFailure
    ? []
    : parsedValidations.flatMap((parsed) => parsed.validations);
  const question: FormQuestionItem = {
    kind: "question",
    id: `question-${String(item[0] ?? questionIndex)}`,
    itemId: String(item[0] ?? questionIndex),
    entryIds,
    entryBindings,
    sectionId,
    index: questionIndex,
    itemIndex,
    title,
    description: asString(item[2]),
    type,
    required: rawEntries.some((entry) => entry[2] === 1),
    options,
    images,
    validations,
    rawType,
  };

  if (type === "scale") {
    const labels = asArray(rawEntries[0]?.[3]);
    question.scale = {
      ...numericBounds(options),
      lowLabel: asString(labels[0])?.trim() || null,
      highLabel: asString(labels[1])?.trim() || null,
    };
  }

  if (type === "grid_single" || type === "grid_checkbox") {
    const rows = rawEntries.map((entry, rowIndex) => ({
      id: String(entry[0] ?? rowIndex),
      entryId: String(entry[0] ?? rowIndex),
      label: asString(asArray(entry[3])[0]) ?? `행 ${rowIndex + 1}`,
      required: entry[2] === 1,
    }));
    const columns = options.map((option, columnIndex) => ({
      id: `column-${columnIndex + 1}`,
      label: option.label,
    }));
    question.grid = {
      rows,
      columns,
      binding: "google_internal_row_ids",
      mode: type === "grid_checkbox" ? "multiple" : "single",
      requireResponsePerRow: rows.every((row) => row.required),
      limitOneResponsePerColumn:
        type === "grid_single" &&
        asArray(item[8]).some((rule) => {
          const tuple = asArray(rule);
          return tuple[0] === 8 && tuple[1] === 205;
        }),
    };
    question.options = columns.map((column, columnIndex) => ({
      label: column.label,
      value: column.label,
      isOther: false,
      index: columnIndex,
      image: null,
      branchTarget: null,
    }));
  }

  if (type === "rating") {
    const iconCode =
      asFiniteNumber(asArray(rawEntries[0]?.[14])[0]) ??
      asFiniteNumber(asArray(rawEntries[0]?.[16])[0]);
    question.rating = {
      icon:
        iconCode === 1
          ? "star"
          : iconCode === 2
            ? "heart"
            : iconCode === 3
              ? "thumbs_up"
              : "unknown",
      ...numericBounds(options),
    };
  }

  if (type === "date") {
    const flags = asArray(rawEntries[0]?.[7]);
    question.date = {
      includeTime: flags[0] === 1,
      includeYear: flags[1] === 1,
    };
  }

  if (type === "time") {
    question.time = {
      kind: asArray(rawEntries[0]?.[6])[0] === 1 ? "duration" : "time_of_day",
    };
  }

  return { question, structuralFailure };
}

function contentBase(item: UnknownArray, itemIndex: number, sectionId: string) {
  return {
    itemId: String(item[0] ?? itemIndex),
    itemIndex,
    sectionId,
    title: asString(item[1])?.trim() || "",
    description: asString(item[2]),
    rawType: typeof item[3] === "number" ? item[3] : -1,
  };
}

function textBlockItem(
  item: UnknownArray,
  itemIndex: number,
  sectionId: string,
): FormTextBlockItem {
  const base = contentBase(item, itemIndex, sectionId);
  return { kind: "text_block", id: `text-block-${base.itemId}`, ...base };
}

function sectionItem(
  item: UnknownArray,
  itemIndex: number,
  section: FormSection,
): FormSectionItem {
  const base = contentBase(item, itemIndex, section.id);
  return {
    kind: "section",
    id: `section-item-${base.itemId}`,
    ...base,
    sectionIndex: section.index,
    navigation: section.navigation ?? { kind: "next" },
  };
}

function imageItem(
  item: UnknownArray,
  itemIndex: number,
  sectionId: string,
  resolveImage: (rawImage: UnknownArray) => FormImageRef,
): FormImageItem | null {
  const image = rawImageTuple(item[6]);
  if (!image) return null;
  const base = contentBase(item, itemIndex, sectionId);
  return {
    kind: "image",
    id: `image-${base.itemId}`,
    ...base,
    image: resolveImage(image),
  };
}

function videoItem(
  item: UnknownArray,
  itemIndex: number,
  sectionId: string,
): FormVideoItem | null {
  const rawVideo = asArray(item[6]);
  const videoId = asString(rawVideo[3])?.trim();
  if (!videoId) return null;
  const dimensions = asArray(rawVideo[2]);
  const base = contentBase(item, itemIndex, sectionId);
  return {
    kind: "video",
    id: `video-${base.itemId}`,
    ...base,
    video: {
      provider: "youtube",
      videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      width: asFiniteNumber(dimensions[0]),
      height: asFiniteNumber(dimensions[1]),
    },
  };
}

function extractSubmissionMetadata(html: string): FormSubmissionMetadata {
  const formTag = html.match(/<form\b[^>]*>/i)?.[0];
  const action = formTag ? tagAttributes(formTag).action : null;
  const hidden = new Map<string, string>();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    if (attributes.type?.toLowerCase() !== "hidden" || !attributes.name) continue;
    hidden.set(attributes.name, attributes.value ?? "");
  }
  return {
    actionUrl: action,
    fvv: hidden.get("fvv") ?? null,
    fbzx: hidden.get("fbzx") ?? null,
    pageHistory: hidden.get("pageHistory") ?? null,
    partialResponse: hidden.get("partialResponse") ?? null,
  };
}

function clearSpecializedQuestionFields(question: FormQuestion): void {
  delete question.scale;
  delete question.grid;
  delete question.rating;
  delete question.date;
  delete question.time;
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

  const imageResolver = createImageResolver(rawItems, input.html);
  const sections: FormSection[] = [createSection(0)];
  const questions: FormQuestionItem[] = [];
  const items: FormItem[] = [];
  const skippedItems: SkippedFormItem[] = [];
  let structurallyInvalidQuestionCount = 0;
  let malformedContentItemCount = 0;
  let currentSection = sections[0];

  rawItems.forEach((item, itemIndex) => {
    const rawType = typeof item[3] === "number" ? item[3] : -1;
    const itemId = String(item[0] ?? itemIndex);
    const itemTitle = asString(item[1])?.trim() || `항목 ${itemIndex + 1}`;

    if (rawType === FILE_UPLOAD_TYPE) {
      skippedItems.push({
        itemId,
        rawType,
        title: itemTitle,
        reason: "file_upload",
      });
      return;
    }

    if (rawType === 8) {
      currentSection = createSection(sections.length, item);
      sections.push(currentSection);
      items.push(sectionItem(item, itemIndex, currentSection));
      return;
    }

    if (rawType === 6) {
      items.push(textBlockItem(item, itemIndex, currentSection.id));
      return;
    }

    if (rawType === 11) {
      const mapped = imageItem(item, itemIndex, currentSection.id, imageResolver.resolve);
      if (mapped) items.push(mapped);
      else malformedContentItemCount += 1;
      return;
    }

    if (rawType === 12) {
      const mapped = videoItem(item, itemIndex, currentSection.id);
      if (mapped) items.push(mapped);
      else malformedContentItemCount += 1;
      return;
    }

    const { question, structuralFailure } = mapQuestion(
      item,
      questions.length,
      itemIndex,
      currentSection.id,
      imageResolver.resolve,
    );
    if (structuralFailure) structurallyInvalidQuestionCount += 1;
    questions.push(question);
    items.push(question);
    currentSection.questionIds.push(question.id);

    const inferredSectionTitle = sectionTitleFromQuestion(question.title);
    if (
      inferredSectionTitle &&
      (currentSection.title === `섹션 ${currentSection.index + 1}` ||
        currentSection.title === "기본 문항")
    ) {
      currentSection.title = inferredSectionTitle;
    }
  });

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
    .filter(([, owners]) => new Set(owners).size > 1 || owners.length > 1)
    .map(([entryId]) => entryId);
  const duplicateEntryIdSet = new Set(duplicateEntryIds);
  for (const question of questions) {
    if (!question.entryIds.some((entryId) => duplicateEntryIdSet.has(entryId))) continue;
    question.type = "unknown";
    clearSpecializedQuestionFields(question);
  }

  const sectionItemIds = new Set(
    sections.flatMap((section) => (section.itemId === null ? [] : [section.itemId])),
  );
  let invalidNavigationCount = 0;
  for (const question of questions) {
    const targets = question.options.map((option) => option.branchTarget ?? null);
    const hasBranching = targets.some((target) => target !== null);
    const invalidTarget = targets.some(
      (target) =>
        target?.kind === "unknown" ||
        (target?.kind === "section" && !sectionItemIds.has(target.sectionItemId)),
    );
    const incompleteBranching = hasBranching && targets.some((target) => target === null);
    if (!invalidTarget && !incompleteBranching) continue;
    question.type = "unknown";
    clearSpecializedQuestionFields(question);
    invalidNavigationCount += 1;
  }
  for (const section of sections) {
    const navigation = section.navigation;
    if (
      navigation?.kind === "unknown" ||
      (navigation?.kind === "section" && !sectionItemIds.has(navigation.sectionItemId))
    ) {
      invalidNavigationCount += 1;
    }
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
  if (invalidNavigationCount > 0) {
    warnings.push(
      `${invalidNavigationCount}개 분기 또는 섹션 이동 설정을 안전하게 해석하지 못했습니다.`,
    );
  }
  if (skippedItems.length > 0) {
    warnings.push(`${skippedItems.length}개 파일 업로드 문항은 명시적으로 제외했습니다.`);
  }
  if (malformedContentItemCount > 0) {
    warnings.push(`${malformedContentItemCount}개 미디어 항목의 내부 구조가 올바르지 않아 제외했습니다.`);
  }
  if (!imageResolver.pairedExactly) {
    warnings.push(
      "이미지 원본 ID와 공개 렌더링 URL을 안전하게 연결할 수 없어 일부 URL을 비워 두었습니다.",
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
    locale: input.html.match(/<html[^>]+lang=["']([^"']+)/i)?.[1] ?? "und",
    sections,
    questions,
    items,
    submission: extractSubmissionMetadata(input.html),
    diagnostics: { warnings, unsupportedQuestionCount, skippedItems },
  };
}
