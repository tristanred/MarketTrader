import { z } from 'zod';

declare const db: any;

const tagSchema = z.object({ tag: z.string(), label: z.string().max(40) });

export function tradingRoutes() {
  // Lives as long as the plugin: one per process.
  const lastByTag = new Map<string, number>();

  return async function (app: any): Promise<void> {
    app.post('/games/:id/tag', { schema: { body: tagSchema } }, async (request: any) => {
      const perRequest = new Map<string, number>();
      perRequest.set(request.body.tag, 1); // OK: Map dies with the request
      lastByTag.set(request.body.label, Date.now()); // OK: bounded by .max(40)
      if (request.body.tag) {
        lastByTag.set(request.body.tag, Date.now()); // BAD: unbounded key into a plugin-lifetime Map
      }
      await db.transaction(async (tx: any) => {
        const t = request.body.tag;
        request.log?.info({ t }, 'tagging'); // BAD: unbounded value logged from a nested callback
        void tx;
      });
      return {};
    });
  };
}

export function helper(keys: string[]): number {
  const counts = new Map<string, number>(); // per call, not long-lived
  for (const k of keys) counts.set(k, 1);
  return counts.size;
}
