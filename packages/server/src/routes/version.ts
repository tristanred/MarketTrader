import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildInfo } from '../build-info.js';

const versionResponseSchema = z.object({
  version: z.string(),
  commit: z.string(),
  buildTime: z.string().datetime(),
});

/**
 * Registers the public build-stamp route:
 *  - `GET /version` — semver, short git SHA, and build timestamp of the running
 *    bundle.
 *
 * Unauthenticated like `/health`, so a deploy can be verified with one curl.
 * The SHA matters because shipping is decoupled from versioning: several
 * deploys can carry the same version number.
 */
export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/version',
    {
      schema: {
        tags: ['Health'],
        summary: 'Build version of the running server',
        response: { 200: versionResponseSchema },
      },
    },
    async () => buildInfo,
  );
}
