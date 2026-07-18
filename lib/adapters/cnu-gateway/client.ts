import { z } from "zod";
import {
  CnuGatewayError,
  errorForUpstreamStatus,
} from "./errors";
import type { SafeGatewayUsage } from "./schemas";

export const CNU_GATEWAY_BASE_URL =
  "https://factchat-cloud.mindlogic.ai/v1/gateway";
export const DEFAULT_CNU_CHAT_MODEL = "gpt-5.4-mini";

const MODEL_RESPONSE_LIMIT_BYTES = 256 * 1024;
const COMPLETION_RESPONSE_LIMIT_BYTES = 1024 * 1024;
const COMPLETION_REQUEST_LIMIT_BYTES = 128 * 1024;
const MODEL_TIMEOUT_MS = 8_000;
const COMPLETION_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const modelListSchema = z.object({
  data: z
    .array(
      z
        .object({
          id: z.string().trim().min(1).max(256),
        })
        .passthrough(),
    )
    .max(1_000),
});

const completionResponseSchema = z.object({
  choices: z
    .array(
      z
        .object({
          message: z.object({
            content: z.string().min(1),
          }),
        })
        .passthrough(),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .passthrough()
    .optional(),
});

const FALLBACK_CHAT_MODELS = [
  DEFAULT_CNU_CHAT_MODEL,
  "gpt-5.4-nano",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "claude-haiku-4-5-20251001",
] as const;

const NON_CHAT_MODEL_PATTERN =
  /(?:codex|embedding|image|dall-e|sora|video|audio|speech|tts|whisper)/i;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface CnuGatewayClientOptions {
  apiKey: string;
  configuredModel?: string;
  fetchImplementation?: FetchImplementation;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
}

export interface ChatCompletionInput {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  responseSchema: Record<string, unknown>;
  maxCompletionTokens: number;
}

export interface ChatCompletionResult {
  content: string;
  usage?: SafeGatewayUsage;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizedSetting(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort and must not replace the safe gateway error.
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await cancelResponseBody(response);
    throw new CnuGatewayError(
      "AI Gateway 응답이 허용된 크기를 초과했습니다.",
      "AI_GATEWAY_INVALID_RESPONSE",
      502,
    );
  }

  if (!response.body) {
    throw new CnuGatewayError(
      "AI Gateway가 빈 응답을 반환했습니다.",
      "AI_GATEWAY_INVALID_RESPONSE",
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
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new CnuGatewayError(
          "AI Gateway 응답이 허용된 크기를 초과했습니다.",
          "AI_GATEWAY_INVALID_RESPONSE",
          502,
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

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CnuGatewayError(
      "AI Gateway 응답 형식을 확인할 수 없습니다.",
      "AI_GATEWAY_INVALID_RESPONSE",
      502,
    );
  }
}

export class CnuGatewayClient {
  private readonly apiKey: string;
  private readonly configuredModel?: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxAttempts: number;

  constructor(options: CnuGatewayClientOptions) {
    const apiKey = normalizedSetting(options.apiKey);
    if (!apiKey || apiKey === "발급받은키") {
      throw new CnuGatewayError(
        "AI Gateway 키가 설정되지 않았습니다.",
        "AI_NOT_CONFIGURED",
        503,
      );
    }

    this.apiKey = apiKey;
    this.configuredModel = normalizedSetting(options.configuredModel);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxAttempts = Math.max(
      1,
      Math.min(3, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
    );
  }

  private async requestJson(input: {
    path: "/models/" | "/chat/completions/";
    method: "GET" | "POST";
    body?: string;
    timeoutMs: number;
    maximumResponseBytes: number;
  }): Promise<unknown> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      let response: Response;

      try {
        response = await this.fetchImplementation(
          `${CNU_GATEWAY_BASE_URL}${input.path}`,
          {
            method: input.method,
            headers: {
              accept: "application/json",
              authorization: `Bearer ${this.apiKey}`,
              ...(input.body
                ? { "content-type": "application/json" }
                : {}),
            },
            body: input.body,
            signal: AbortSignal.timeout(input.timeoutMs),
          },
        );
      } catch (error) {
        const errorName =
          typeof error === "object" && error !== null && "name" in error
            ? String(error.name)
            : "";
        if (errorName === "AbortError" || errorName === "TimeoutError") {
          throw new CnuGatewayError(
            "AI Gateway 응답 시간이 초과되었습니다.",
            "AI_GATEWAY_TIMEOUT",
            504,
          );
        }

        throw new CnuGatewayError(
          "AI Gateway에 연결하지 못했습니다.",
          "AI_GATEWAY_UNAVAILABLE",
          502,
        );
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt + 1 < this.maxAttempts) {
        await cancelResponseBody(response);
        const backoff = 200 * 2 ** attempt + Math.floor(this.random() * 100);
        await this.sleep(backoff);
        continue;
      }

      if (!response.ok) {
        await cancelResponseBody(response);
        throw errorForUpstreamStatus(response.status);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        await cancelResponseBody(response);
        throw new CnuGatewayError(
          "AI Gateway 응답 형식을 확인할 수 없습니다.",
          "AI_GATEWAY_INVALID_RESPONSE",
          502,
        );
      }

      return readBoundedJson(response, input.maximumResponseBytes);
    }

    throw new CnuGatewayError(
      "AI Gateway에 일시적인 문제가 발생했습니다.",
      "AI_GATEWAY_UNAVAILABLE",
      502,
    );
  }

  async listModels(): Promise<string[]> {
    const payload = await this.requestJson({
      path: "/models/",
      method: "GET",
      timeoutMs: MODEL_TIMEOUT_MS,
      maximumResponseBytes: MODEL_RESPONSE_LIMIT_BYTES,
    });

    const parsed = modelListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new CnuGatewayError(
        "AI 모델 목록 응답을 확인할 수 없습니다.",
        "AI_GATEWAY_INVALID_RESPONSE",
        502,
      );
    }

    return [...new Set(parsed.data.data.map((model) => model.id))];
  }

  async resolveChatModel(): Promise<string> {
    const models = await this.listModels();
    const available = new Set(models);

    if (this.configuredModel) {
      if (available.has(this.configuredModel)) return this.configuredModel;
      throw new CnuGatewayError(
        "설정된 AI 모델을 사용할 수 없습니다.",
        "AI_MODEL_UNAVAILABLE",
        503,
      );
    }

    for (const model of FALLBACK_CHAT_MODELS) {
      if (available.has(model)) return model;
    }

    const fallback = models.find((model) => !NON_CHAT_MODEL_PATTERN.test(model));
    if (fallback) return fallback;

    throw new CnuGatewayError(
      "사용 가능한 채팅 모델이 없습니다.",
      "AI_MODEL_UNAVAILABLE",
      503,
    );
  }

  async createJsonCompletion(
    input: ChatCompletionInput,
  ): Promise<ChatCompletionResult> {
    const body = JSON.stringify({
      model: input.model,
      messages: input.messages,
      stream: false,
      max_completion_tokens: Math.max(
        256,
        Math.min(8_192, Math.floor(input.maxCompletionTokens)),
      ),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "generated_survey_answers",
          strict: true,
          schema: input.responseSchema,
        },
      },
    });

    if (new TextEncoder().encode(body).byteLength > COMPLETION_REQUEST_LIMIT_BYTES) {
      throw new CnuGatewayError(
        "AI 생성 요청이 허용된 크기를 초과했습니다.",
        "AI_REQUEST_TOO_LARGE",
        413,
      );
    }

    const payload = await this.requestJson({
      path: "/chat/completions/",
      method: "POST",
      body,
      timeoutMs: COMPLETION_TIMEOUT_MS,
      maximumResponseBytes: COMPLETION_RESPONSE_LIMIT_BYTES,
    });
    const parsed = completionResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new CnuGatewayError(
        "AI Gateway 생성 응답을 확인할 수 없습니다.",
        "AI_GATEWAY_INVALID_RESPONSE",
        502,
      );
    }

    const rawUsage = parsed.data.usage;
    const usage = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens ?? 0,
          completionTokens: rawUsage.completion_tokens ?? 0,
          totalTokens:
            rawUsage.total_tokens ??
            (rawUsage.prompt_tokens ?? 0) + (rawUsage.completion_tokens ?? 0),
        }
      : undefined;

    return {
      content: parsed.data.choices[0].message.content,
      usage,
    };
  }
}

export function createCnuGatewayClientFromEnvironment(): CnuGatewayClient {
  return new CnuGatewayClient({
    apiKey: process.env.CNU_API_GATEWAY_KEY ?? "",
    configuredModel: process.env.CNU_API_GATEWAY_MODEL,
  });
}
