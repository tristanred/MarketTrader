import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

/**
 * Registers Fastify's Zod-aware validator + serializer compilers and mounts
 * `@fastify/swagger` (spec generation) and `@fastify/swagger-ui` (UI at `/docs`).
 *
 * Must be called after `registerJwt()` so the `bearerAuth` security scheme can
 * be referenced by downstream route definitions, and before any route plugin.
 */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'MarketTrader API',
        description:
          'REST API for the MarketTrader virtual stock trading tournament platform. ' +
          'In addition to the documented HTTP endpoints, a WebSocket endpoint at ' +
          '`/games/:id/live?token=<jwt>` streams price ticks and leaderboard updates.',
        version: '0.0.1',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });
}
