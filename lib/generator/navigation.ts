import type {
  FormOption,
  FormQuestion,
  FormSection,
  ImportedForm,
} from "../domain/form-schema";

export const SUBMIT_DESTINATION = "__submit__";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizedDestination(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const direct = string(value);
  if (direct) {
    return /^(?:submit|submitted|end|__submit__)$/i.test(direct)
      ? SUBMIT_DESTINATION
      : direct;
  }
  const object = record(value);
  if (!object) return null;
  if (object.submit === true || object.kind === "submit" || object.type === "submit") {
    return SUBMIT_DESTINATION;
  }
  return (
    string(object.sectionId) ??
    string(object.sectionItemId) ??
    string(object.destinationSectionId) ??
    string(object.targetSectionId) ??
    string(object.target) ??
    string(object.destination)
  );
}

function optionDestination(option: FormOption): string | null {
  const extended = option as FormOption & UnknownRecord;
  return (
    normalizedDestination(extended.branchTarget) ??
    normalizedDestination(extended.destination) ??
    normalizedDestination(extended.destinationSectionId) ??
    normalizedDestination(extended.targetSectionId) ??
    normalizedDestination(extended.navigation)
  );
}

function destinationFromMap(map: unknown, answer: string): string | null {
  const object = record(map);
  if (!object) return null;
  return normalizedDestination(object[answer]);
}

export function destinationForChoice(
  question: FormQuestion,
  answer: unknown,
): string | null {
  if (typeof answer !== "string") return null;
  const regularOption = question.options.find(
    (option) => option.label === answer || option.value === answer,
  );
  const matchingOption =
    regularOption ??
    (answer.trim()
      ? question.options.find((option) => option.isOther)
      : undefined);
  const direct = matchingOption ? optionDestination(matchingOption) : null;
  if (direct) return direct;

  const extended = question as FormQuestion & UnknownRecord;
  const navigation = record(extended.navigation);
  const branch = record(extended.branch);
  const candidates = [
    navigation?.choiceDestinations,
    navigation?.destinations,
    navigation?.byOption,
    branch?.choiceDestinations,
    branch?.destinations,
    branch?.byOption,
    extended.choiceDestinations,
  ];
  for (const candidate of candidates) {
    const destination = destinationFromMap(candidate, answer);
    if (destination) return destination;
  }
  return null;
}

export function destinationAfterSection(section: FormSection): string | null {
  const extended = section as FormSection & UnknownRecord;
  const navigation = record(extended.navigation);
  return (
    normalizedDestination(extended.destination) ??
    normalizedDestination(extended.nextSectionId) ??
    normalizedDestination(navigation) ??
    normalizedDestination(navigation?.destination) ??
    normalizedDestination(navigation?.destinationSectionId) ??
    normalizedDestination(navigation?.nextSectionId)
  );
}

function sectionByDestination(
  form: ImportedForm,
  destination: string,
): FormSection | undefined {
  return form.sections.find(
    (section) =>
      section.id === destination ||
      section.itemId === destination ||
      String(section.index) === destination,
  );
}

export interface NavigationResult {
  visitedSectionIds: string[];
  pageHistory: number[];
}

/**
 * Resolves the section path using already-produced answers. Unknown navigation
 * metadata deliberately falls back to the next physical section.
 */
export function resolveResponseNavigation(
  form: ImportedForm,
  answers: Record<string, unknown>,
): NavigationResult {
  if (form.sections.length === 0) {
    return { visitedSectionIds: [], pageHistory: [0] };
  }

  const visitedSectionIds: string[] = [];
  const pageHistory: number[] = [];
  const visited = new Set<string>();
  let section: FormSection | undefined = form.sections[0];

  while (section && !visited.has(section.id)) {
    visited.add(section.id);
    visitedSectionIds.push(section.id);
    pageHistory.push(section.index);

    let destination: string | null = null;
    for (const questionId of section.questionIds) {
      const question = form.questions.find((candidate) => candidate.id === questionId);
      if (!question) continue;
      const choiceDestination = destinationForChoice(question, answers[question.id]);
      if (choiceDestination) destination = choiceDestination;
    }
    destination ??= destinationAfterSection(section);

    if (destination === SUBMIT_DESTINATION) break;
    if (destination) {
      section = sectionByDestination(form, destination);
      if (!section) break;
      continue;
    }
    section = form.sections[section.index + 1];
  }

  return { visitedSectionIds, pageHistory };
}

export function questionIsReached(
  question: FormQuestion,
  navigation: NavigationResult,
): boolean {
  return navigation.visitedSectionIds.includes(question.sectionId);
}
