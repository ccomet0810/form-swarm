import { FormImportError } from "./errors";

const PUBLIC_FORM_PATH = /^\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]+)\/(?:viewform)?\/?$/;
const SHORT_FORM_PATH = /^\/[A-Za-z0-9_-]+\/?$/;

export interface ValidatedFormUrl {
  url: URL;
  kind: "public_form" | "short_link";
  publicId: string | null;
}

export function validateGoogleFormUrl(input: string): ValidatedFormUrl {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    throw new FormImportError(
      "올바른 Google Forms 링크를 입력해 주세요.",
      "INVALID_URL",
      400,
    );
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new FormImportError(
      "HTTPS Google Forms 링크만 가져올 수 있습니다.",
      "INVALID_URL",
      400,
    );
  }

  url.hash = "";
  // Prefill links can carry respondent data in entry.* query parameters. The
  // public form schema does not depend on those values, so never fetch, return,
  // or persist them as part of an import.
  url.search = "";

  if (url.hostname === "forms.gle" && SHORT_FORM_PATH.test(url.pathname)) {
    return { url, kind: "short_link", publicId: null };
  }

  if (url.hostname !== "docs.google.com") {
    throw new FormImportError(
      "docs.google.com 또는 forms.gle 링크만 허용됩니다.",
      "INVALID_URL",
      400,
    );
  }

  const match = url.pathname.match(PUBLIC_FORM_PATH);
  if (!match) {
    throw new FormImportError(
      "공개 응답용 viewform 링크를 입력해 주세요.",
      "INVALID_URL",
      400,
    );
  }

  url.pathname = `/forms/d/${url.pathname.includes("/d/e/") ? "e/" : ""}${match[1]}/viewform`;
  return { url, kind: "public_form", publicId: match[1] };
}

export function publicIdFromUrl(url: URL): string {
  const match = url.pathname.match(PUBLIC_FORM_PATH);
  if (!match || url.hostname !== "docs.google.com") {
    throw new FormImportError(
      "Google Forms 공개 페이지로 연결되지 않았습니다.",
      "UNSUPPORTED_PAGE",
      422,
    );
  }
  return match[1];
}
