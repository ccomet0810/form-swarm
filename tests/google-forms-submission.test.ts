import { describe, expect, it, vi } from "vitest";
import type {
  FormQuestion,
  ImportedForm,
} from "../lib/domain/form-schema";
import type { FetchedFormPage } from "../lib/adapters/google-forms/fetcher";
import {
  GoogleFormSubmissionError,
  buildGoogleFormResponseParams,
  extractGoogleFormSubmissionContext,
  submitGoogleFormResponse,
} from "../lib/adapters/google-forms/submission";

function question(
  value: Partial<FormQuestion> & Pick<FormQuestion, "id" | "type">,
): FormQuestion {
  const { id, type, ...rest } = value;
  return {
    id,
    itemId: id,
    entryIds: value.entryIds ?? [`entry-${id}`],
    sectionId: "section-1",
    index: value.index ?? 0,
    title: id,
    description: null,
    type,
    required: value.required ?? true,
    options: value.options ?? [],
    rawType: value.rawType ?? 0,
    ...rest,
  };
}

const questions: FormQuestion[] = [
  question({ id: "q-text", type: "short_text", entryIds: ["101"] }),
  question({
    id: "q-choice-other",
    type: "single_choice",
    entryIds: ["102"],
    options: [
      { label: "A", value: "A", isOther: false },
      { label: "기타", value: "__other__", isOther: true },
    ],
  }),
  question({
    id: "q-checkbox",
    type: "checkboxes",
    entryIds: ["103"],
    options: [
      { label: "X", value: "X", isOther: false },
      { label: "Y", value: "Y", isOther: false },
      { label: "기타", value: "__other__", isOther: true },
    ],
  }),
  question({
    id: "q-grid",
    type: "grid_single",
    entryIds: ["1041", "1042"],
    grid: {
      rows: [
        { id: "r1", label: "행 1", entryId: "1041", required: true },
        { id: "r2", label: "행 2", entryId: "1042", required: true },
      ],
      columns: [
        { id: "c1", label: "열 1" },
        { id: "c2", label: "열 2" },
      ],
      binding: "google_internal_row_ids",
      mode: "single",
      requireResponsePerRow: true,
      limitOneResponsePerColumn: true,
    },
  }),
  question({
    id: "q-grid-checkbox",
    type: "grid_checkbox",
    entryIds: ["1051", "1052"],
    grid: {
      rows: [
        { id: "mr1", label: "다중 행 1", entryId: "1051", required: true },
        { id: "mr2", label: "다중 행 2", entryId: "1052", required: true },
      ],
      columns: [
        { id: "mc1", label: "다중 열 1" },
        { id: "mc2", label: "다중 열 2" },
      ],
      binding: "google_internal_row_ids",
      mode: "multiple",
      requireResponsePerRow: true,
      limitOneResponsePerColumn: false,
    },
  }),
  question({
    id: "q-date",
    type: "date",
    entryIds: ["106"],
    date: { includeYear: false, includeTime: false },
  }),
  question({
    id: "q-date-time",
    type: "date",
    entryIds: ["107"],
    date: { includeYear: true, includeTime: true },
  }),
  question({
    id: "q-time",
    type: "time",
    entryIds: ["108"],
    time: { kind: "time_of_day" },
  }),
  question({
    id: "q-duration",
    type: "time",
    entryIds: ["109"],
    time: { kind: "duration" },
  }),
];

const form: ImportedForm = {
  schemaVersion: "1.0",
  parserVersion: "submission-test",
  source: {
    requestedUrl: "https://docs.google.com/forms/d/e/test-public-id/viewform",
    canonicalUrl: "https://docs.google.com/forms/d/e/test-public-id/viewform",
    publicId: "test-public-id",
    fetchedAt: "2026-07-19T00:00:00.000Z",
  },
  title: "Submission fixture",
  description: null,
  locale: "ko",
  sections: [
    {
      id: "section-1",
      itemId: null,
      index: 0,
      title: "기본",
      description: null,
      questionIds: questions.map((value) => value.id),
    },
  ],
  questions,
  diagnostics: { warnings: [], unsupportedQuestionCount: 0 },
};

const page: FetchedFormPage = {
  requestedUrl: form.source.requestedUrl,
  canonicalUrl: form.source.canonicalUrl,
  publicId: form.source.publicId,
  html: `<!doctype html><form method="POST" action="/forms/d/e/test-public-id/formResponse">
    <input type="hidden" name="fvv" value="1">
    <input value="partial-token" name="partialResponse" type="hidden">
    <input name="pageHistory" type="hidden" value="0">
    <input type="hidden" value="fbzx-token" name="fbzx">
  </form>`,
};

const response = {
  id: "response-1",
  index: 0,
  visitedSectionIds: ["section-1"],
  pageHistory: [0, 2],
  answers: {
    "q-text": "텍스트",
    "q-choice-other": "직접 입력",
    "q-checkbox": ["X", "체크 기타"],
    "q-grid": { "행 1": "열 1", "행 2": "열 2" },
    "q-grid-checkbox": {
      "다중 행 1": ["다중 열 1", "다중 열 2"],
      "다중 행 2": ["다중 열 2"],
    },
    "q-date": "07-19",
    "q-date-time": "2026-07-19T14:30",
    "q-time": "09:05",
    "q-duration": "1:02:03",
  },
};

describe("Google Forms formResponse serialization", () => {
  it("extracts and pins a same-form Google action and hidden submission tokens", () => {
    expect(extractGoogleFormSubmissionContext(page)).toEqual({
      actionUrl: "https://docs.google.com/forms/d/e/test-public-id/formResponse",
      viewUrl: "https://docs.google.com/forms/d/e/test-public-id/viewform",
      fvv: "1",
      fbzx: "fbzx-token",
      pageHistory: "0",
      partialResponse: "partial-token",
    });
  });

  it("serializes repeated checkboxes, Other, grids, dates, times, and navigation exactly", () => {
    const context = extractGoogleFormSubmissionContext(page);
    const params = buildGoogleFormResponseParams({ form, response, context });
    expect([...params.entries()]).toMatchInlineSnapshot(`
      [
        [
          "entry.101",
          "텍스트",
        ],
        [
          "entry.102",
          "__other_option__",
        ],
        [
          "entry.102.other_option_response",
          "직접 입력",
        ],
        [
          "entry.103",
          "X",
        ],
        [
          "entry.103",
          "__other_option__",
        ],
        [
          "entry.103.other_option_response",
          "체크 기타",
        ],
        [
          "entry.1041",
          "열 1",
        ],
        [
          "entry.1042",
          "열 2",
        ],
        [
          "entry.1051",
          "다중 열 1",
        ],
        [
          "entry.1051",
          "다중 열 2",
        ],
        [
          "entry.1052",
          "다중 열 2",
        ],
        [
          "entry.106_month",
          "07",
        ],
        [
          "entry.106_day",
          "19",
        ],
        [
          "entry.107_year",
          "2026",
        ],
        [
          "entry.107_month",
          "07",
        ],
        [
          "entry.107_day",
          "19",
        ],
        [
          "entry.107_hour",
          "14",
        ],
        [
          "entry.107_minute",
          "30",
        ],
        [
          "entry.108_hour",
          "09",
        ],
        [
          "entry.108_minute",
          "05",
        ],
        [
          "entry.109_hour",
          "1",
        ],
        [
          "entry.109_minute",
          "02",
        ],
        [
          "entry.109_second",
          "03",
        ],
        [
          "fvv",
          "1",
        ],
        [
          "partialResponse",
          "partial-token",
        ],
        [
          "pageHistory",
          "0,2",
        ],
        [
          "fbzx",
          "fbzx-token",
        ],
      ]
    `);
  });

  it("posts one encoded response and only accepts a confirmation page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("<main>응답이 기록되었습니다.</main>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      submitGoogleFormResponse({ page, form, response, fetchImpl }),
    ).resolves.toEqual({ accepted: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://docs.google.com/forms/d/e/test-public-id/formResponse",
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "manual",
    });
  });

  it("fails closed for a foreign action, login, CAPTCHA, file upload, and non-confirmation results", async () => {
    expect(() =>
      extractGoogleFormSubmissionContext({
        ...page,
        html: `${page.html}<a href="https://accounts.google.com/AccountChooser">계정 전환</a>`,
      }),
    ).not.toThrow();
    expect(() =>
      extractGoogleFormSubmissionContext({
        ...page,
        html: page.html.replace(
          "/forms/d/e/test-public-id/formResponse",
          "https://evil.example/collect",
        ),
      }),
    ).toThrowError(GoogleFormSubmissionError);
    expect(() =>
      extractGoogleFormSubmissionContext({
        ...page,
        html: '<form action="https://accounts.google.com/ServiceLogin"></form>',
      }),
    ).toThrowError(expect.objectContaining({ code: "LOGIN_REQUIRED" }));
    expect(() =>
      extractGoogleFormSubmissionContext({
        ...page,
        html: '<div class="g-recaptcha" data-sitekey="challenge"></div>',
      }),
    ).toThrowError(expect.objectContaining({ code: "CAPTCHA_REQUIRED" }));

    await expect(
      submitGoogleFormResponse({
        page,
        form: {
          ...form,
          diagnostics: {
            ...form.diagnostics,
            skippedItems: [
              { itemId: "upload", rawType: 13, title: "업로드", reason: "file_upload" },
            ],
          },
        },
        response,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "FILE_UPLOAD_UNSUPPORTED" });

    await expect(
      submitGoogleFormResponse({
        page,
        form,
        response,
        fetchImpl: vi.fn(async () => new Response("다시 시도", { status: 200 })),
      }),
    ).rejects.toMatchObject({ code: "SUBMISSION_REJECTED" });
  });
});
