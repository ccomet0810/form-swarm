import { z } from "zod";
import {
  GoogleFormSubmissionError,
  submitGoogleFormResponse,
} from "../../../../lib/adapters/google-forms/submission";
import { FormImportError } from "../../../../lib/adapters/google-forms/errors";
import { fetchGoogleFormPage } from "../../../../lib/adapters/google-forms/fetcher";
import { parseGoogleFormHtml } from "../../../../lib/adapters/google-forms/parser";
import { resolveResponseNavigation } from "../../../../lib/generator/navigation";
import { validateGeneratedResponse } from "../../../../lib/generator/validation";

const MAX_SUBMIT_BODY_BYTES = 256 * 1024;

const scalarAnswer = z.union([
  z.string().max(20_000),
  z.number().finite(),
]);
const answer = z.union([
  z.string().max(20_000),
  z.array(z.string().max(20_000)).max(200),
  z.record(
    z.string().max(500),
    z.union([scalarAnswer, z.array(z.string().max(20_000)).max(200)]),
  ),
]);
const submitRequest = z.object({
  url: z.string().trim().min(1).max(2_048),
  response: z.object({
    id: z.string().trim().min(1).max(256),
    index: z.number().int().min(0).max(100_000),
    answers: z
      .record(z.string().min(1).max(256), answer)
      .refine((answers) => Object.keys(answers).length <= 1_000),
    visitedSectionIds: z.array(z.string().max(256)).max(200).optional(),
    pageHistory: z
      .union([
        z.string().max(2_000),
        z.array(z.number().int().min(0).max(10_000)).max(200),
      ])
      .optional(),
  }),
});

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SUBMIT_BODY_BYTES) {
    await request.body?.cancel();
    throw new GoogleFormSubmissionError(
      "제출 요청이 허용된 크기를 초과했습니다.",
      "SUBMISSION_REJECTED",
      413,
    );
  }
  if (!request.body) throw new SyntaxError("Missing request body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SUBMIT_BODY_BYTES) {
        await reader.cancel();
        throw new GoogleFormSubmissionError(
          "제출 요청이 허용된 크기를 초과했습니다.",
          "SUBMISSION_REJECTED",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function POST(request: Request) {
  try {
    const body = submitRequest.parse(await readBoundedJson(request));
    const page = await fetchGoogleFormPage(body.url);
    const form = parseGoogleFormHtml({
      ...page,
      fetchedAt: new Date().toISOString(),
    });

    if (
      form.questions.some((question) => question.rawType === 13) ||
      form.diagnostics.skippedItems?.some((item) => item.rawType === 13)
    ) {
      throw new GoogleFormSubmissionError(
        "파일 업로드 문항이 있는 Google Forms에는 자동 제출할 수 없습니다.",
        "FILE_UPLOAD_UNSUPPORTED",
        422,
      );
    }

    const validation = validateGeneratedResponse(form, body.response);
    if (!validation.valid) {
      return Response.json(
        {
          error: {
            code: "RESPONSE_INVALID",
            message: "폼이 변경되었거나 생성 응답이 현재 문항 조건과 맞지 않습니다.",
            issues: validation.issues,
          },
        },
        { status: 422 },
      );
    }

    // Never trust a client-provided section path. Recompute it against the
    // freshly fetched form before serializing pageHistory and reached answers.
    const navigation = resolveResponseNavigation(form, body.response.answers);
    const result = await submitGoogleFormResponse({
      page,
      form,
      response: { ...body.response, ...navigation },
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof GoogleFormSubmissionError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof FormImportError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return Response.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "제출할 Google Forms 링크와 단일 응답을 확인해 주세요.",
          },
        },
        { status: 400 },
      );
    }

    console.error("Unexpected form submission failure", error);
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "응답을 제출하는 중 예상하지 못한 문제가 발생했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
