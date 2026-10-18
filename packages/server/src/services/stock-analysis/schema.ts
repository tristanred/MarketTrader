import { z } from 'zod';
import type { AnalysisVerdict } from '@markettrader/shared';
import { clip } from './text.js';

export const VERDICTS = ['BUY', 'HOLD', 'SELL'] as const satisfies readonly AnalysisVerdict[];

const SUMMARY_MAX = 600;
const POINT_MAX = 200;
const POINTS_MAX = 5;

const point = z
  .string()
  .trim()
  .min(1)
  .transform((s) => clip(s, POINT_MAX));
const points = z
  .array(point)
  .min(1)
  .transform((xs) => xs.slice(0, POINTS_MAX));

/**
 * Validates the model's answer. Lenient on what a model gets cosmetically wrong —
 * case, whitespace, a fractional confidence, a sixth bullet — and strict on what
 * changes meaning. Model output is untrusted, so this is the real guard; the JSON
 * Schema sent upstream is only a hint.
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
    .transform((s) => clip(s, SUMMARY_MAX)),
  bullPoints: points,
  bearPoints: points,
});

/** A validated analysis result, as stored in `stock_analyses.result`. */
export type AnalysisResult = z.infer<typeof modelOutputSchema>;

/**
 * JSON Schema for `response_format`, kept by hand beside {@link modelOutputSchema}
 * (zod 3 has no exporter). A parity test keeps the two in step.
 */
export const ANALYSIS_JSON_SCHEMA = {
  name: 'stock_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'confidence', 'summary', 'bullPoints', 'bearPoints'],
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      summary: { type: 'string', maxLength: SUMMARY_MAX },
      bullPoints: {
        type: 'array',
        minItems: 1,
        maxItems: POINTS_MAX,
        items: { type: 'string', maxLength: POINT_MAX },
      },
      bearPoints: {
        type: 'array',
        minItems: 1,
        maxItems: POINTS_MAX,
        items: { type: 'string', maxLength: POINT_MAX },
      },
    },
  },
} as const;
