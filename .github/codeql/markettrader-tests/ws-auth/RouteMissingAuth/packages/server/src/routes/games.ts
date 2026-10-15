// An ES module like every real route file: top-level consts are then local
// variables that data flow tracks, not script globals.
export {};
declare const rawApp: any;
const app = rawApp.withTypeProvider();
const handler = async () => ({});

// GOOD: guarded with authenticate.
app.get('/games', { onRequest: rawApp.authenticate, schema: {} }, handler);

// GOOD: guarded with requireAdmin as a preHandler array element.
app.post('/games/:id/reset', { preHandler: [rawApp.requireAdmin], schema: {} }, handler);

// BAD: no hook at all.
app.get('/games/secret', { schema: {} }, handler); // flagged

// BAD: a hook, but not an auth guard.
app.delete('/games/:id', { onRequest: rawApp.rateLimit(), schema: {} }, handler); // flagged

// GOOD: on the public allowlist.
app.get('/health', { schema: {} }, handler);
app.post('/auth/login', { schema: {} }, handler);
app.get('/stocks/:symbol', { schema: {} }, handler);
app.get('/stocks/:symbol/history', { schema: {} }, handler);

// BAD: shares a prefix with a public path but is not on the allowlist.
app.get('/stocks/watch/all', { schema: {} }, handler); // flagged

// BAD: two-argument form, no options at all.
app.get('/games/naked', handler); // flagged

// GOOD: options object held in a local const.
const authed = { onRequest: rawApp.authenticate, schema: {} };
app.get('/games/via-const', authed, handler);

// GOOD: guard destructured from the app.
const { authenticate } = rawApp;
app.get('/games/destructured', { onRequest: authenticate, schema: {} }, handler);

// BAD: an options const without any guard.
const unguarded = { schema: {} };
app.get('/games/unguarded-const', unguarded, handler); // flagged

// GOOD: WebSocket routes authenticate on upgrade.
app.get('/ws/live', { websocket: true }, async (socket: any) => {});
