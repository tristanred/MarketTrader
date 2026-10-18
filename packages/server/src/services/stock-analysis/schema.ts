import { z } from 'zod';
import type { AnalysisVerdict } from '@markettrader/shared';

export const VERDICTS = ['BUY', 'HOLD', 'SELL'] as const satisfies readonly AnalysisVerdict[];

const SUMMARY_MAX = 600;
const POINT_MAX = 200;
const POINTS_MAX = 5;

const point = z
  .string()
  .trim()
  .min(1)
  .transform((s) => (s.length > POINT_MAX ? `${s.slice(0, POINT_MAX - 1)}…` : s));

/**
 * Validates the model's answer (snake_case, as the prompt asks). Lenient on what
 * a model gets cosmetically wrong — case, whitespace, a fractional confidence, a
 * sixth bullet — and strict on what changes meaning. Model output is untrusted,
 * so this is the real guard; the JSON Schema sent upstream is only a hint.
 */
export const modelOutputSchema = z.object({
  verdict: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(VERDICTS)),
  confidence: z.coerce.number().finite().min(0).max(100).transform(Math.round),
  summary: z
    .string()
    .trim()
    .min(1)
    .transform((s) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s)),
  bull_points: z.array(point).min(1).transform((xs) => xs.slice(0, POINTS_MAX)),
  bear_points: z.array(point).min(1).transform((xs) => xs.slice(0, POINTS_MAX)),
});

/** The stored, camelCase form kept in `stock_analyses.result`. Re-validated on every read. */
export const storedResultSchema = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().min(1).max(SUMMARY_MAX),
  bullPoints: z.array(z.string().min(1).max(POINT_MAX)).min(1).max(POINTS_MAX),
  bearPoints: z.array(z.string().min(1).max(POINT_MAX)).min(1).max(POINTS_MAX),
});

/** A validated analysis result. */
export type AnalysisResult = z.infer<typeof storedResultSchema>;

/** Converts a validated model answer to the stored shape. */
export function toResult(output: z.infer<typeof modelOutputSchema>): AnalysisResult {
  return {
    verdict: output.verdict,
    confidence: output.confidence,
    summary: output.summary,
    bullPoints: output.bull_points,
    bearPoints: output.bear_points,
  };
}

/**
 * JSON Schema for `response_format`, kept by hand beside {@link modelOutputSchema}
 * (zod 3 has no exporter). A parity test keeps the two in step.
 */
export const ANALYSIS_JSON_SCHEMA = {
  name: 'stock_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'confidence', 'summary', 'bull_points', 'bear_points'],
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      summary: { type: 'string', maxLength: SUMMARY_MAX },
      bull_points: {
        type: 'array',
        minItems: 1,
        maxItems: POINTS_MAX,
        items: { type: 'string', maxLength: POINT_MAX },
      },
      bear_points: {
        type: 'array',
        minItems: 1,
        maxItems: POINTS_MAX,
        items: { type: 'string', maxLength: POINT_MAX },
      },
    },
  },
} as const;
