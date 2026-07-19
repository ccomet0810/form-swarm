import { z } from "zod";

export const normalizedTextQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    type: z.enum(["short_text", "paragraph"]),
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(2_000).nullable().optional(),
    required: z.boolean().optional().default(false),
    minLength: z.number().int().min(1).max(500).optional(),
    maxLength: z.number().int().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((question, context) => {
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
  });

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
    locale: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .optional()
      .default("ko"),
  })
  .strict();

export type NormalizedTextQuestion = z.infer<
  typeof normalizedTextQuestionSchema
>;
export type GenerateTextRequest = z.infer<typeof generateTextRequestSchema>;

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
