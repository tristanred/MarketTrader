import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AdminConfigEntry, AdminConfigResponse } from '@markettrader/shared';
import { isConfigKey, isLiveKey, liveValueSchema, type LiveKey } from '../../config/registry.js';
import type { ConfigOverridesService } from '../../services/config-overrides.js';

const keyParams = z.object({ key: z.string().min(1).max(64) });
const setBody = z.object({ value: z.union([z.string().max(2048), z.number(), z.boolean()]) });

type KeyCheck =
  | { ok: true; key: LiveKey }
  | { ok: false; status: 404 | 409; code: string; message: string };

function resolveLiveKey(raw: string): KeyCheck {
  if (!isConfigKey(raw)) {
    return { ok: false, status: 404, code: 'UNKNOWN_CONFIG_KEY', message: `No configuration option named ${raw}.` };
  }
  if (!isLiveKey(raw)) {
    return {
      ok: false,
      status: 409,
      code: 'CONFIG_NOT_LIVE',
      message: `${raw} is read once at startup. Change it in the environment and restart.`,
    };
  }
  return { ok: true, key: raw };
}

/**
 * Admin configuration panel endpoints (all `requireAdmin`):
 *   GET    /admin/config      — every option, secrets reduced to `isSet`
 *   PUT    /admin/config/:key — override a live option (persists, audited)
 *   DELETE /admin/config/:key — drop the override, restoring the boot value
 */
export function adminConfigRoutes(svc: ConfigOverridesService) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get('/admin/config', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'List every host configuration option.', security: [{ bearerAuth: [] }] },
    }, async (_request, reply) => {
      const body: AdminConfigResponse = { entries: await svc.list() };
      return reply.send(body);
    });

    app.put('/admin/config/:key', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Override a live configuration option.',
        security: [{ bearerAuth: [] }],
        params: keyParams,
        body: setBody,
      },
    }, async (request, reply) => {
      const check = resolveLiveKey(request.params.key);
      if (!check.ok) return reply.status(check.status).send({ code: check.code, message: check.message });

      const parsed = liveValueSchema(check.key).safeParse(request.body.value);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'INVALID_CONFIG_VALUE',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const entry: AdminConfigEntry = await svc.set(check.key, parsed.data, request.user.id);
      return reply.send(entry);
    });

    app.delete('/admin/config/:key', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Remove an override; the boot value applies again.',
        security: [{ bearerAuth: [] }],
        params: keyParams,
      },
    }, async (request, reply) => {
      const check = resolveLiveKey(request.params.key);
      if (!check.ok) return reply.status(check.status).send({ code: check.code, message: check.message });
      const entry: AdminConfigEntry = await svc.reset(check.key, request.user.id);
      return reply.send(entry);
    });
  };
}
