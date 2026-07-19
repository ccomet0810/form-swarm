import { z } from "zod";

const finiteNumberSchema = z.number().finite();

const excludedNumberRangeSchema = z
  .object({
    min: finiteNumberSchema,
    max: finiteNumberSchema,
  })
  .strict()
  .superRefine((range, context) => {
    if (range.min > range.max) {
      context.addIssue({
        code: "custom",
        path: ["max"],
        message: "max must be greater than or equal to min",
      });
    }
  });

const normalizedTextQuestionShape = {
  id: z.string().trim().min(1).max(128).optional(),
  type: z.enum(["short_text", "paragraph"]),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(2_000).nullable().optional(),
  required: z.boolean().optional().default(false),
  textKind: z.enum(["plain", "number", "email", "url"]).optional(),
  minLength: z.number().int().min(1).max(500).optional(),
  maxLength: z.number().int().min(1).max(2_000).optional(),
  minValue: finiteNumberSchema.optional(),
  maxValue: finiteNumberSchema.optional(),
  excludedNumberRange: excludedNumberRangeSchema.optional(),
  pattern: z.string().max(500).optional(),
} as const;

function validateTextQuestionBounds(
  question: {
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
  },
  context: z.RefinementCtx,
) {
  if (
    question.minLength !== undefined &&
    question.maxLength !== undefined &&
    question.minLength > question.maxLength
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxLength"],
      message: "maxLength must be greater than or equal to minLength",
    });
  }
  if (
    question.minValue !== undefined &&
    question.maxValue !== undefined &&
    question.minValue > question.maxValue
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxValue"],
      message: "maxValue must be greater than or equal to minValue",
    });
  }
}

export const normalizedTextQuestionSchema = z
  .object(normalizedTextQuestionShape)
  .strict()
  .superRefine(validateTextQuestionBounds);

export const promptSuggestionQuestionSchema = z
  .object({
    ...normalizedTextQuestionShape,
    id: z.string().trim().min(1).max(128),
  })
  .strict()
  .superRefine(validateTextQuestionBounds);

const localeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .optional()
  .default("ko");

export const generateTextRequestSchema = z
  .object({
    question: normalizedTextQuestionSchema,
    prompt: z.string().trim().min(1).max(2_000).optional(),
    count: z.number().int().min(1).max(100),
    existingAnswers: z
      .array(z.string().trim().min(1).max(2_000))
      .max(100)
      .optional()
      .default([]),
    locale: localeSchema,
  })
  .strict();

export const suggestTextPromptsRequestSchema = z
  .object({
    questions: z.array(promptSuggestionQuestionSchema).min(1).max(100),
    locale: localeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.questions.forEach((question, index) => {
      if (!seen.has(question.id)) {
        seen.add(question.id);
        return;
      }
      context.addIssue({
        code: "custom",
        path: ["questions", index, "id"],
        message: "question ids must be unique",
      });
    });
  });

export type NormalizedTextQuestion = z.infer<
  typeof normalizedTextQuestionSchema
>;
export type GenerateTextRequest = z.infer<typeof generateTextRequestSchema>;
export type PromptSuggestionQuestion = z.infer<
  typeof promptSuggestionQuestionSchema
>;
export type SuggestTextPromptsRequest = z.infer<
  typeof suggestTextPromptsRequestSchema
>;

export interface SafeGatewayUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GeneratedTextResult {
  answers: string[];
  model: string;
  usage?: SafeGatewayUsage;
}

export interface TextPromptSuggestion {
  questionId: string;
  prompt: string;
}

export interface SuggestedTextPromptsResult {
  suggestions: TextPromptSuggestion[];
  model: string;
  usage?: SafeGatewayUsage;
}
