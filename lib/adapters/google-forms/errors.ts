export class FormImportError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_URL"
      | "REQUEST_TOO_LARGE"
      | "FETCH_FAILED"
      | "RESPONSE_TOO_LARGE"
      | "UNSUPPORTED_PAGE"
      | "PAYLOAD_NOT_FOUND"
      | "PAYLOAD_INVALID",
    readonly status: number,
  ) {
    super(message);
    this.name = "FormImportError";
  }
}
