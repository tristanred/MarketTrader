import { z } from 'zod';
import { meters } from '../observability/telemetry';

const placeTradeSchema = z.object({
  symbol: z.string(),
  direction: z.enum(['buy', 'sell']),
  orderType: z.enum(['market', 'limit']).optional().default('market'),
});

class TradeError extends Error {
  constructor(public readonly code: 'INSUFFICIENT_FUNDS' | 'MARKET_CLOSED', message: string) {
    super(message);
  }
}

export function tradingRoutes(app: any) {
  app.addHook('onSend', async (_request: any, reply: any, payload: unknown) => {
    let reason = `http_${reply.statusCode}`;
    if (typeof payload === 'string') {
      const body: unknown = JSON.parse(payload);
      if (body && typeof body === 'object') {
        const { code, error } = body as { code?: unknown; error?: unknown };
        if (typeof code === 'string') reason = code;
        // BAD: `error` carries err.message, which embeds the user's symbol.
        else if (typeof error === 'string') reason = error;
      }
    }
    meters.tradesRejected.add(1, { reason });
    return payload;
  });

  app.post('/games/:id/trades', { schema: { body: placeTradeSchema } }, async (request: any, reply: any) => {
    const { symbol, direction, orderType } = request.body;
    // GOOD: Zod enums are a closed set.
    meters.tradesExecuted.add(1, { side: direction, mode: orderType });
    // GOOD: literal values.
    meters.tradesExecuted.add(1, { side: 'buy', outcome: 'ok' });
    // BAD: user-controlled symbol.
    meters.tradesExecuted.add(1, { symbol });
    // BAD: whole path parameter.
    meters.tradesExecuted.add(1, { game: request.params.id });
    try {
      throw new TradeError('MARKET_CLOSED', `Market closed for ${symbol}`);
    } catch (err) {
      if (err instanceof TradeError) {
        // GOOD: the code is a closed union.
        meters.tradesRejected.add(1, { reason: err.code });
        // BAD: the message is free text.
        meters.tradesRejected.add(1, { reason: err.message });
      }
    }
    return reply.send({ ok: true });
  });
}

function recordRejection(label: string) {
  // BAD (via callers): the label is built from the request symbol below.
  meters.tradesRejected.add(1, { reason: label });
}

export function moreShapes(request: any) {
  // BAD: optional chaining, template literal, then a helper parameter.
  recordRejection(`bad_${request.body?.symbol}`);
  // GOOD: closed Zod enum read through optional chaining.
  meters.tradesExecuted.add(1, { side: request.body?.direction });
  const attrs = { side: 'sell', who: request.params.gameId };
  // BAD: attributes object built ahead of the call.
  meters.tradesExecuted.add(1, attrs);
}

export function recordUser(user: { userId: string; kind: 'a' | 'b' }) {
  // GOOD: bounded discriminant.
  meters.workerTicks.add(1, { outcome: user.kind });
  // BAD: identifier.
  meters.workerTicks.add(1, { user: user.userId });
}
