export type CnuGatewayErrorCode =
  | "AI_NOT_CONFIGURED"
  | "AI_REQUEST_TOO_LARGE"
  | "AI_GATEWAY_REQUEST_REJECTED"
  | "AI_GATEWAY_AUTH_FAILED"
  | "AI_GATEWAY_QUOTA_EXCEEDED"
  | "AI_MODEL_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_GATEWAY_UNAVAILABLE"
  | "AI_GATEWAY_TIMEOUT"
  | "AI_GATEWAY_INVALID_RESPONSE"
  | "AI_GENERATION_INCOMPLETE";

export class CnuGatewayError extends Error {
  constructor(
    message: string,
    readonly code: CnuGatewayErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CnuGatewayError";
  }
}

export function errorForUpstreamStatus(status: number): CnuGatewayError {
  if (status === 400) {
    return new CnuGatewayError(
      "AI Gateway가 생성 요청을 처리하지 못했습니다.",
      "AI_GATEWAY_REQUEST_REJECTED",
      502,
    );
  }

  if (status === 401 || status === 403) {
    return new CnuGatewayError(
      "AI Gateway 인증 설정을 확인해 주세요.",
      "AI_GATEWAY_AUTH_FAILED",
      503,
    );
  }

  if (status === 402) {
    return new CnuGatewayError(
      "AI Gateway 사용 한도가 부족합니다.",
      "AI_GATEWAY_QUOTA_EXCEEDED",
      503,
    );
  }

  if (status === 404) {
    return new CnuGatewayError(
      "설정된 AI 모델을 사용할 수 없습니다.",
      "AI_MODEL_UNAVAILABLE",
      503,
    );
  }

  if (status === 429) {
    return new CnuGatewayError(
      "AI 요청이 일시적으로 많습니다. 잠시 후 다시 시도해 주세요.",
      "AI_RATE_LIMITED",
      429,
    );
  }

  return new CnuGatewayError(
    "AI Gateway에 일시적인 문제가 발생했습니다.",
    "AI_GATEWAY_UNAVAILABLE",
    502,
  );
}
