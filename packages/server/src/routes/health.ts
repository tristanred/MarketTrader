import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Liveness probe',
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: 'ok' as const, timestamp: new Date().toISOString() }),
  );
}
