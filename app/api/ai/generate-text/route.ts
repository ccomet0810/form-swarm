import { z } from "zod";
import { createCnuGatewayClientFromEnvironment } from "../../../../lib/adapters/cnu-gateway/client";
import { CnuGatewayError } from "../../../../lib/adapters/cnu-gateway/errors";
import { generateTextAnswers } from "../../../../lib/adapters/cnu-gateway/generate-text";
import { generateTextRequestSchema } from "../../../../lib/adapters/cnu-gateway/schemas";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_REQUEST_BODY_BYTES
  ) {
    await request.body?.cancel();
    throw new CnuGatewayError(
      "AI 생성 요청이 허용된 크기를 초과했습니다.",
      "AI_REQUEST_TOO_LARGE",
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
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new CnuGatewayError(
          "AI 생성 요청이 허용된 크기를 초과했습니다.",
          "AI_REQUEST_TOO_LARGE",
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

function jsonResponse(payload: unknown, status: number): Response {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const input = generateTextRequestSchema.parse(await readBoundedJson(request));
    const client = createCnuGatewayClientFromEnvironment();
    const result = await generateTextAnswers(input, client);
    return jsonResponse(result, 200);
  } catch (error) {
    if (error instanceof CnuGatewayError) {
      return jsonResponse(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }

    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return jsonResponse(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "주관식 생성 요청 내용을 확인해 주세요.",
          },
        },
        400,
      );
    }

    // Do not log the error object: it may retain request headers in its cause.
    console.error("Unexpected AI text generation failure");
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "주관식 응답을 만드는 중 예상하지 못한 문제가 발생했습니다.",
        },
      },
      500,
    );
  }
}
