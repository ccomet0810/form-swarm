const ALLOWED_IMAGE_PREFIX =
  "https://docs.google.com/forms-images-rt/";
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ALLOWED_REDIRECT_HOST = /^lh\d+-rt\.googleusercontent\.com$/;
const ALLOWED_REDIRECT_PATH_PREFIX = "/rd-forms-images-rt/";
const MAX_REDIRECTS = 2;

export const GOOGLE_FORMS_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const GOOGLE_FORMS_IMAGE_TIMEOUT_MS = 10_000;

export type GoogleFormsImageProxyErrorCode =
  | "INVALID_IMAGE_URL"
  | "IMAGE_FETCH_FAILED"
  | "IMAGE_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE";

export class GoogleFormsImageProxyError extends Error {
  constructor(
    message: string,
    readonly code: GoogleFormsImageProxyErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleFormsImageProxyError";
  }
}

export interface ProxiedGoogleFormsImage {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * Accept only the image endpoint emitted by a public Google Forms page.
 * The literal prefix check intentionally rejects credentials, explicit ports,
 * alternate host spellings, and non-HTTPS URLs before URL normalization.
 */
export function validateGoogleFormsImageUrl(input: string): URL {
  if (
    input.length === 0 ||
    input.length > 4_096 ||
    !input.startsWith(ALLOWED_IMAGE_PREFIX)
  ) {
    throw new GoogleFormsImageProxyError(
      "허용되지 않은 Google Forms 이미지 주소입니다.",
      "INVALID_IMAGE_URL",
      400,
    );
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new GoogleFormsImageProxyError(
      "Google Forms 이미지 주소를 확인해 주세요.",
      "INVALID_IMAGE_URL",
      400,
    );
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "docs.google.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith("/forms-images-rt/") ||
    url.hash !== ""
  ) {
    throw new GoogleFormsImageProxyError(
      "허용되지 않은 Google Forms 이미지 주소입니다.",
      "INVALID_IMAGE_URL",
      400,
    );
  }

  return url;
}

function validateGoogleFormsImageRedirect(
  location: string,
  currentUrl: URL,
): URL {
  const trimmedLocation = location.trim();
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(
    trimmedLocation,
  )?.[1];

  // Redirects must be absolute. Checking the raw authority before URL parsing
  // prevents a default port such as :443 from being normalized away.
  if (!authority || authority.includes("@") || authority.includes(":")) {
    throw new GoogleFormsImageProxyError(
      "허용되지 않은 Google Forms 이미지 리디렉션입니다.",
      "IMAGE_FETCH_FAILED",
      502,
    );
  }

  let url: URL;
  try {
    url = new URL(trimmedLocation, currentUrl);
  } catch {
    throw new GoogleFormsImageProxyError(
      "Google Forms 이미지 리디렉션을 확인할 수 없습니다.",
      "IMAGE_FETCH_FAILED",
      502,
    );
  }

  if (
    url.protocol !== "https:" ||
    !ALLOWED_REDIRECT_HOST.test(url.hostname) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith(ALLOWED_REDIRECT_PATH_PREFIX) ||
    url.hash !== ""
  ) {
    throw new GoogleFormsImageProxyError(
      "허용되지 않은 Google Forms 이미지 리디렉션입니다.",
      "IMAGE_FETCH_FAILED",
      502,
    );
  }

  return url;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not mask the proxy error.
  }
}

async function readBoundedImage(
  response: Response,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    throw new GoogleFormsImageProxyError(
      "Google Forms가 빈 이미지 응답을 반환했습니다.",
      "IMAGE_FETCH_FAILED",
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
      if (totalBytes > GOOGLE_FORMS_IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new GoogleFormsImageProxyError(
          "Google Forms 이미지가 허용된 크기를 초과했습니다.",
          "IMAGE_TOO_LARGE",
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
  return bytes;
}

export async function fetchGoogleFormsImage(
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProxiedGoogleFormsImage> {
  let currentUrl = validateGoogleFormsImageUrl(input);
  const deadlineSignal = AbortSignal.timeout(GOOGLE_FORMS_IMAGE_TIMEOUT_MS);
  const visitedUrls = new Set<string>();
  let response: Response | undefined;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const currentKey = currentUrl.toString();
    if (visitedUrls.has(currentKey)) {
      throw new GoogleFormsImageProxyError(
        "Google Forms 이미지 리디렉션이 반복되었습니다.",
        "IMAGE_FETCH_FAILED",
        502,
      );
    }
    visitedUrls.add(currentKey);

    try {
      response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        headers: {
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: deadlineSignal,
      });
    } catch {
      throw new GoogleFormsImageProxyError(
        "Google Forms 이미지를 가져오지 못했습니다.",
        "IMAGE_FETCH_FAILED",
        502,
      );
    }

    if (response.status < 300 || response.status >= 400) break;

    const location = response.headers.get("location");
    await cancelResponseBody(response);
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new GoogleFormsImageProxyError(
        "Google Forms 이미지 리디렉션을 확인할 수 없습니다.",
        "IMAGE_FETCH_FAILED",
        502,
      );
    }
    currentUrl = validateGoogleFormsImageRedirect(location, currentUrl);
  }

  if (!response) {
    throw new GoogleFormsImageProxyError(
      "Google Forms 이미지를 가져오지 못했습니다.",
      "IMAGE_FETCH_FAILED",
      502,
    );
  }

  if (!response.ok) {
    await cancelResponseBody(response);
    throw new GoogleFormsImageProxyError(
      `Google Forms 이미지 서버가 ${response.status} 응답을 반환했습니다.`,
      "IMAGE_FETCH_FAILED",
      502,
    );
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    await cancelResponseBody(response);
    throw new GoogleFormsImageProxyError(
      "지원하지 않는 Google Forms 이미지 형식입니다.",
      "UNSUPPORTED_IMAGE_TYPE",
      415,
    );
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > GOOGLE_FORMS_IMAGE_MAX_BYTES
  ) {
    await cancelResponseBody(response);
    throw new GoogleFormsImageProxyError(
      "Google Forms 이미지가 허용된 크기를 초과했습니다.",
      "IMAGE_TOO_LARGE",
      413,
    );
  }

  try {
    return {
      bytes: await readBoundedImage(response),
      contentType,
    };
  } catch (error) {
    await cancelResponseBody(response);
    if (error instanceof GoogleFormsImageProxyError) throw error;
    throw new GoogleFormsImageProxyError(
      "Google Forms 이미지를 읽지 못했습니다.",
      "IMAGE_FETCH_FAILED",
      502,
    );
  }
}
