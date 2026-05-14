import { z } from 'zod';

/**
 * Shared error envelope used by every documented response.
 * Some routes return `{ error: ZodIssue[] }` from Fastify's validator; we expose
 * a permissive shape rather than try to model ZodIssue in the OpenAPI spec.
 */
export const errorResponseSchema = z.object({
  error: z.unknown().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
