import { z } from "zod";
import { FormImportError } from "../../../../lib/adapters/google-forms/errors";
import { importGoogleForm } from "../../../../lib/application/import-google-form";

const importRequest = z.object({
  url: z.string().trim().min(1).max(2_048),
});

const MAX_IMPORT_BODY_BYTES = 4 * 1024;

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BODY_BYTES) {
    await request.body?.cancel();
    throw new FormImportError(
      "가져오기 요청이 허용된 크기를 초과했습니다.",
      "REQUEST_TOO_LARGE",
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
      if (totalBytes > MAX_IMPORT_BODY_BYTES) {
        await reader.cancel();
        throw new FormImportError(
          "가져오기 요청이 허용된 크기를 초과했습니다.",
          "REQUEST_TOO_LARGE",
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
    const body = importRequest.parse(await readBoundedJson(request));
    const form = await importGoogleForm(body.url);
    return Response.json({ form }, { status: 200 });
  } catch (error) {
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
            message: "가져올 Google Forms 링크를 확인해 주세요.",
          },
        },
        { status: 400 },
      );
    }

    console.error("Unexpected form import failure", error);
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "폼을 분석하는 중 예상하지 못한 문제가 발생했습니다.",
        },
      },
      { status: 500 },
    );
  }
}
