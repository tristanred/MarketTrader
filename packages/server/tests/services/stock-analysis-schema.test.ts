import { describe, it, expect } from 'vitest';
import { ANALYSIS_JSON_SCHEMA, VERDICTS, modelOutputSchema } from '../../src/services/stock-analysis/schema.js';
import { validAnswer } from '../helpers/fake-llm.js';

describe('analysis schema', () => {
  it('accepts a valid answer, and its parsed form re-validates unchanged as a stored row', () => {
    const parsed = modelOutputSchema.parse(validAnswer());
    expect(parsed.bullPoints).toHaveLength(2);
    expect(modelOutputSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('tolerates cosmetic slips', () => {
    const parsed = modelOutputSchema.parse(
      validAnswer({ verdict: ' buy ', confidence: '71.6', bullPoints: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    );
    expect(parsed.verdict).toBe('BUY');
    expect(parsed.confidence).toBe(72);
    expect(parsed.bullPoints).toHaveLength(5);
  });

  it('truncates over-long text rather than rejecting it', () => {
    const parsed = modelOutputSchema.parse(validAnswer({ summary: 's'.repeat(900), bearPoints: ['b'.repeat(400)] }));
    expect(parsed.summary).toHaveLength(600);
    expect(parsed.bearPoints[0]).toHaveLength(200);
  });

  it.each([
    ['an unknown verdict', { verdict: 'STRONG BUY' }],
    ['confidence out of range', { confidence: 140 }],
    ['an empty summary', { summary: '  ' }],
    ['no bear points', { bearPoints: [] }],
    ['a missing field', { bullPoints: undefined }],
  ])('rejects %s', (_label, override) => {
    expect(modelOutputSchema.safeParse(validAnswer(override)).success).toBe(false);
  });

  it('keeps the JSON Schema in step with the Zod schema', () => {
    const { schema } = ANALYSIS_JSON_SCHEMA;
    const keys = Object.keys(modelOutputSchema.shape).sort();
    expect([...schema.required].sort()).toEqual(keys);
    expect(Object.keys(schema.properties).sort()).toEqual(keys);
    expect(schema.properties.verdict.enum).toEqual([...VERDICTS]);
  });
});
