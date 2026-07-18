import { FormImportError } from "./errors";
import {
  publicIdFromUrl,
  validateGoogleFormUrl,
} from "./url-policy";

const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_DEADLINE_MS = 10_000;

export interface FetchedFormPage {
  requestedUrl: string;
  canonicalUrl: string;
  publicId: string;
  html: string;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not replace the import error.
  }
}

async function readBoundedHtml(response: Response): Promise<string> {
  if (!response.body) {
    throw new FormImportError(
      "Google Forms가 빈 응답을 반환했습니다.",
      "FETCH_FAILED",
      502,
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_HTML_BYTES) {
        await reader.cancel();
        throw new FormImportError(
          "폼 페이지가 허용된 크기를 초과했습니다.",
          "RESPONSE_TOO_LARGE",
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
  return new TextDecoder().decode(bytes);
}

export async function fetchGoogleFormPage(
  input: string,
): Promise<FetchedFormPage> {
  const initial = validateGoogleFormUrl(input);
  let current = initial.url;
  const deadlineSignal = AbortSignal.timeout(FETCH_DEADLINE_MS);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;

    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "FormSwarmSchemaImporter/0.1 (+read-only)",
        },
        signal: deadlineSignal,
      });
    } catch {
      throw new FormImportError(
        "Google Forms 페이지를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "FETCH_FAILED",
        502,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await cancelResponseBody(response);
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new FormImportError(
          "Google Forms 리디렉션을 확인할 수 없습니다.",
          "FETCH_FAILED",
          502,
        );
      }

      current = validateGoogleFormUrl(new URL(location, current).toString()).url;
      continue;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new FormImportError(
        `Google Forms가 ${response.status} 응답을 반환했습니다.`,
        "FETCH_FAILED",
        502,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await cancelResponseBody(response);
      throw new FormImportError(
        "응답이 Google Forms HTML 페이지가 아닙니다.",
        "UNSUPPORTED_PAGE",
        422,
      );
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_HTML_BYTES) {
      await cancelResponseBody(response);
      throw new FormImportError(
        "폼 페이지가 허용된 크기를 초과했습니다.",
        "RESPONSE_TOO_LARGE",
        413,
      );
    }

    const finalValidated = validateGoogleFormUrl(current.toString());
    if (finalValidated.kind !== "public_form") {
      await cancelResponseBody(response);
      throw new FormImportError(
        "Google Forms 공개 페이지로 연결되지 않았습니다.",
        "UNSUPPORTED_PAGE",
        422,
      );
    }

    let html: string;
    try {
      html = await readBoundedHtml(response);
    } catch (error) {
      await cancelResponseBody(response);
      if (error instanceof FormImportError) throw error;
      throw new FormImportError(
        "Google Forms 페이지를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "FETCH_FAILED",
        502,
      );
    }

    return {
      requestedUrl: initial.url.toString(),
      canonicalUrl: finalValidated.url.toString(),
      publicId: publicIdFromUrl(finalValidated.url),
      html,
    };
  }

  throw new FormImportError(
    "Google Forms 페이지를 가져오지 못했습니다.",
    "FETCH_FAILED",
    502,
  );
}
