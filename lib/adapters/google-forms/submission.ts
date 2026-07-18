import type {
  FormQuestion,
  GeneratedResponse,
  ImportedForm,
} from "../../domain/form-schema";
import type { FetchedFormPage } from "./fetcher";

const SUBMISSION_DEADLINE_MS = 12_000;
const MAX_RESULT_HTML_BYTES = 512 * 1024;

export type GoogleFormSubmissionErrorCode =
  | "SUBMISSION_CONTEXT_INVALID"
  | "LOGIN_REQUIRED"
  | "FILE_UPLOAD_UNSUPPORTED"
  | "CAPTCHA_REQUIRED"
  | "SUBMISSION_REJECTED"
  | "SUBMISSION_FAILED"
  | "SUBMISSION_RESPONSE_TOO_LARGE";

export class GoogleFormSubmissionError extends Error {
  constructor(
    message: string,
    readonly code: GoogleFormSubmissionErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleFormSubmissionError";
  }
}

export interface GoogleFormSubmissionContext {
  actionUrl: string;
  viewUrl: string;
  fvv: string;
  fbzx: string;
  pageHistory: string;
  partialResponse?: string;
}

export interface GoogleFormSubmissionResult {
  accepted: true;
  status: number;
}

type AnswerRecord = Record<string, unknown>;

interface ResponseWithNavigation {
  answers: AnswerRecord;
  pageHistory?: string | number[];
  visitedSectionIds?: string[];
}

type ExtendedQuestion = FormQuestion & {
  date?: FormQuestion["date"] & {
    includesYear?: boolean;
    includesTime?: boolean;
  };
  time?: FormQuestion["time"] & { includeSeconds?: boolean };
};

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function attributesFromTag(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const expression = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(expression)) {
    attributes.set(
      match[1].toLowerCase(),
      decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ""),
    );
  }
  return attributes;
}

function hiddenInputValue(html: string, name: string): string | null {
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = attributesFromTag(match[0]);
    if (attributes.get("name") === name) return attributes.get("value") ?? "";
  }
  return null;
}

function hasLoginGate(html: string): boolean {
  // Public responder pages normally include an AccountChooser link in the
  // account switcher even when anonymous submission is allowed. A real login
  // gate does not contain the public form payload/action.
  if (/FB_PUBLIC_LOAD_DATA_|\/formResponse\b/i.test(html)) return false;
  return (
    /accounts\.google\.com\/ServiceLogin/i.test(html) ||
    /id=["']identifierId["']/i.test(html) ||
    /Sign in - Google Accounts/i.test(html)
  );
}

function hasCaptchaChallenge(html: string): boolean {
  return (
    /class=["'][^"']*g-recaptcha\b/i.test(html) ||
    /(?:recaptcha-token|data-sitekey)\s*=/i.test(html) ||
    /\/recaptcha\/api2\/(?:anchor|challenge)/i.test(html)
  );
}

function validateActionUrl(
  actionValue: string,
  viewUrl: string,
  publicId: string,
): URL {
  let action: URL;
  try {
    action = new URL(actionValue, viewUrl);
  } catch {
    throw new GoogleFormSubmissionError(
      "Google Forms 제출 주소를 확인할 수 없습니다.",
      "SUBMISSION_CONTEXT_INVALID",
      422,
    );
  }

  if (
    action.protocol !== "https:" ||
    action.hostname !== "docs.google.com" ||
    action.username ||
    action.password ||
    action.port
  ) {
    throw new GoogleFormSubmissionError(
      "허용되지 않은 Google Forms 제출 주소입니다.",
      "SUBMISSION_CONTEXT_INVALID",
      422,
    );
  }

  const match = action.pathname.match(
    /^\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]+)\/formResponse\/?$/,
  );
  if (!match || match[1] !== publicId) {
    throw new GoogleFormSubmissionError(
      "가져온 폼과 제출 주소가 일치하지 않습니다.",
      "SUBMISSION_CONTEXT_INVALID",
      422,
    );
  }

  action.search = "";
  action.hash = "";
  return action;
}

export function extractGoogleFormSubmissionContext(
  page: FetchedFormPage,
): GoogleFormSubmissionContext {
  if (hasLoginGate(page.html)) {
    throw new GoogleFormSubmissionError(
      "로그인이 필요한 Google Forms에는 자동 제출할 수 없습니다.",
      "LOGIN_REQUIRED",
      422,
    );
  }
  if (hasCaptchaChallenge(page.html)) {
    throw new GoogleFormSubmissionError(
      "CAPTCHA가 필요한 Google Forms에는 자동 제출할 수 없습니다.",
      "CAPTCHA_REQUIRED",
      422,
    );
  }

  const formTags = [...page.html.matchAll(/<form\b[^>]*>/gi)];
  const actionValue = formTags
    .map((match) => attributesFromTag(match[0]).get("action"))
    .find((value) => value?.includes("formResponse"));
  if (!actionValue) {
    throw new GoogleFormSubmissionError(
      "Google Forms 제출 정보를 찾지 못했습니다.",
      "SUBMISSION_CONTEXT_INVALID",
      422,
    );
  }

  const action = validateActionUrl(
    actionValue,
    page.canonicalUrl,
    page.publicId,
  );
  const fbzx = hiddenInputValue(page.html, "fbzx");
  if (!fbzx) {
    throw new GoogleFormSubmissionError(
      "Google Forms 제출 토큰을 찾지 못했습니다.",
      "SUBMISSION_CONTEXT_INVALID",
      422,
    );
  }

  return {
    actionUrl: action.toString(),
    viewUrl: page.canonicalUrl,
    fvv: hiddenInputValue(page.html, "fvv") || "1",
    fbzx,
    pageHistory: hiddenInputValue(page.html, "pageHistory") || "0",
    partialResponse:
      hiddenInputValue(page.html, "partialResponse") ??
      hiddenInputValue(page.html, "draftResponse") ??
      undefined,
  };
}

function normalizedPageHistory(
  response: ResponseWithNavigation,
  fallback: string,
): string {
  if (typeof response.pageHistory === "string") {
    const normalized = response.pageHistory
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value))
      .join(",");
    if (normalized) return normalized;
  }
  if (Array.isArray(response.pageHistory)) {
    const normalized = response.pageHistory
      .filter((value) => Number.isInteger(value) && value >= 0)
      .join(",");
    if (normalized) return normalized;
  }
  return fallback;
}

function appendOtherValue(
  params: URLSearchParams,
  entryId: string,
  value: string,
): void {
  params.append(`entry.${entryId}`, "__other_option__");
  params.set(`entry.${entryId}.other_option_response`, value);
}

function appendChoiceAnswer(
  params: URLSearchParams,
  question: FormQuestion,
  entryId: string,
  answer: string,
): void {
  const regularLabels = new Set(
    question.options
      .filter((option) => !option.isOther)
      .map((option) => option.label),
  );
  if (regularLabels.has(answer)) {
    params.append(`entry.${entryId}`, answer);
    return;
  }
  if (question.options.some((option) => option.isOther)) {
    appendOtherValue(params, entryId, answer);
    return;
  }
  params.append(`entry.${entryId}`, answer);
}

function recordFromAnswer(answer: unknown): Record<string, unknown> | null {
  return answer !== null && typeof answer === "object" && !Array.isArray(answer)
    ? (answer as Record<string, unknown>)
    : null;
}

function appendGridAnswer(
  params: URLSearchParams,
  question: FormQuestion,
  answer: unknown,
): void {
  if (!question.grid) return;
  const record = recordFromAnswer(answer);
  if (!record) return;

  question.grid.rows.forEach((row, rowIndex) => {
    const value = record[row.label] ?? record[row.id];
    const entryId =
      (row as typeof row & { entryId?: string }).entryId ??
      question.entryIds[rowIndex] ??
      row.id;
    if (Array.isArray(value)) {
      for (const selected of value) {
        if (typeof selected === "string") {
          params.append(`entry.${entryId}`, selected);
        }
      }
    } else if (typeof value === "string") {
      params.append(`entry.${entryId}`, value);
    }
  });
}

interface DateParts {
  year?: string;
  month: string;
  day: string;
  hour?: string;
  minute?: string;
}

function dateParts(answer: unknown): DateParts | null {
  if (typeof answer === "string") {
    const match = answer.match(
      /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/,
    );
    if (!match) return null;
    return {
      year: match[1],
      month: match[2],
      day: match[3],
      hour: match[4],
      minute: match[5],
    };
  }
  const record = recordFromAnswer(answer);
  if (!record) return null;
  const month = record.month;
  const day = record.day;
  if (month == null || day == null) return null;
  return {
    year: record.year == null ? undefined : String(record.year),
    month: String(month),
    day: String(day),
    hour: record.hour == null ? undefined : String(record.hour),
    minute: record.minute == null ? undefined : String(record.minute),
  };
}

function appendDateAnswer(
  params: URLSearchParams,
  question: ExtendedQuestion,
  answer: unknown,
): void {
  const entryId = question.entryIds[0];
  const parts = dateParts(answer);
  if (!entryId || !parts) return;
  const includesYear = question.date?.includeYear ?? true;
  const includesTime = question.date?.includeTime ?? parts.hour !== undefined;

  if (includesYear && parts.year) {
    params.set(`entry.${entryId}_year`, parts.year);
  }
  params.set(`entry.${entryId}_month`, parts.month);
  params.set(`entry.${entryId}_day`, parts.day);
  if (includesTime && parts.hour !== undefined && parts.minute !== undefined) {
    params.set(`entry.${entryId}_hour`, parts.hour);
    params.set(`entry.${entryId}_minute`, parts.minute);
  }
}

interface TimeParts {
  hour: string;
  minute: string;
  second?: string;
}

function timeParts(answer: unknown): TimeParts | null {
  if (typeof answer === "string") {
    const match = answer.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    return match
      ? { hour: match[1], minute: match[2], second: match[3] }
      : null;
  }
  const record = recordFromAnswer(answer);
  if (!record || record.hour == null || record.minute == null) return null;
  return {
    hour: String(record.hour),
    minute: String(record.minute),
    second: record.second == null ? undefined : String(record.second),
  };
}

function appendTimeAnswer(
  params: URLSearchParams,
  question: ExtendedQuestion,
  answer: unknown,
): void {
  const entryId = question.entryIds[0];
  const parts = timeParts(answer);
  if (!entryId || !parts) return;
  params.set(`entry.${entryId}_hour`, parts.hour);
  params.set(`entry.${entryId}_minute`, parts.minute);
  if (
    parts.second !== undefined ||
    question.time?.kind === "duration" ||
    question.time?.includeSeconds
  ) {
    params.set(`entry.${entryId}_second`, parts.second ?? "0");
  }
}

function responseSections(response: ResponseWithNavigation): Set<string> | null {
  return Array.isArray(response.visitedSectionIds)
    ? new Set(response.visitedSectionIds)
    : null;
}

export function buildGoogleFormResponseParams(input: {
  form: ImportedForm;
  response: GeneratedResponse | ResponseWithNavigation;
  context: GoogleFormSubmissionContext;
}): URLSearchParams {
  const response = input.response as ResponseWithNavigation;
  const params = new URLSearchParams();
  const visitedSections = responseSections(response);

  for (const question of input.form.questions) {
    if (visitedSections && !visitedSections.has(question.sectionId)) continue;
    const answer = response.answers[question.id];
    if (answer === undefined || answer === null || answer === "") continue;

    if (question.type === "grid_single" || question.type === "grid_checkbox") {
      appendGridAnswer(params, question, answer);
      continue;
    }
    if (question.type === "date") {
      appendDateAnswer(params, question as ExtendedQuestion, answer);
      continue;
    }
    if (question.type === "time") {
      appendTimeAnswer(params, question as ExtendedQuestion, answer);
      continue;
    }

    const entryId = question.entryIds[0];
    if (!entryId) continue;
    if (Array.isArray(answer)) {
      for (const value of answer) {
        if (typeof value === "string") {
          appendChoiceAnswer(params, question, entryId, value);
        }
      }
    } else if (typeof answer === "string") {
      appendChoiceAnswer(params, question, entryId, answer);
    }
  }

  params.set("fvv", input.context.fvv);
  if (input.context.partialResponse !== undefined) {
    params.set("partialResponse", input.context.partialResponse);
  }
  params.set(
    "pageHistory",
    normalizedPageHistory(response, input.context.pageHistory),
  );
  params.set("fbzx", input.context.fbzx);
  return params;
}

async function readBoundedResult(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESULT_HTML_BYTES) {
        await reader.cancel();
        throw new GoogleFormSubmissionError(
          "Google Forms 제출 결과가 허용된 크기를 초과했습니다.",
          "SUBMISSION_RESPONSE_TOO_LARGE",
          502,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isAcceptedResult(status: number, html: string): boolean {
  if (status === 204) return true;
  if (status < 200 || status >= 300) return false;
  return (
    /Your response has been recorded\.?/i.test(html) ||
    /응답이 기록되었습니다\.?/.test(html) ||
    /Response submitted/i.test(html) ||
    /FormResponseConfirmationMessage/i.test(html)
  );
}

export async function submitGoogleFormResponse(input: {
  page: FetchedFormPage;
  form: ImportedForm;
  response: GeneratedResponse | ResponseWithNavigation;
  fetchImpl?: typeof fetch;
}): Promise<GoogleFormSubmissionResult> {
  if (
    input.form.questions.some((question) => question.rawType === 13) ||
    input.form.diagnostics.skippedItems?.some((item) => item.rawType === 13)
  ) {
    throw new GoogleFormSubmissionError(
      "파일 업로드 문항이 있는 Google Forms에는 자동 제출할 수 없습니다.",
      "FILE_UPLOAD_UNSUPPORTED",
      422,
    );
  }

  const context = extractGoogleFormSubmissionContext(input.page);
  const params = buildGoogleFormResponseParams({
    form: input.form,
    response: input.response,
    context,
  });
  const fetchImpl = input.fetchImpl ?? fetch;
  let result: Response;
  try {
    result = await fetchImpl(context.actionUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        origin: "https://docs.google.com",
        referer: context.viewUrl,
        "user-agent": "FormSwarmResponseSubmitter/0.1",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(SUBMISSION_DEADLINE_MS),
    });
  } catch (error) {
    if (error instanceof GoogleFormSubmissionError) throw error;
    throw new GoogleFormSubmissionError(
      "Google Forms에 응답을 제출하지 못했습니다.",
      "SUBMISSION_FAILED",
      502,
    );
  }

  const resultHtml = await readBoundedResult(result);
  if (hasLoginGate(resultHtml)) {
    throw new GoogleFormSubmissionError(
      "제출 중 Google 로그인이 요구되었습니다.",
      "LOGIN_REQUIRED",
      422,
    );
  }
  if (hasCaptchaChallenge(resultHtml)) {
    throw new GoogleFormSubmissionError(
      "제출 중 CAPTCHA가 요구되었습니다.",
      "CAPTCHA_REQUIRED",
      422,
    );
  }
  if (!isAcceptedResult(result.status, resultHtml)) {
    throw new GoogleFormSubmissionError(
      "Google Forms가 응답을 접수하지 않았습니다. 문항 조건이나 폼 상태를 확인해 주세요.",
      "SUBMISSION_REJECTED",
      result.status >= 400 && result.status < 500 ? 422 : 502,
    );
  }

  return { accepted: true, status: result.status };
}
