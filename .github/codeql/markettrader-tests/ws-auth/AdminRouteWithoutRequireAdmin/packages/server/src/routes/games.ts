declare const rawApp: any;
const app = rawApp.withTypeProvider();

// GOOD: non-admin route; authenticate is enough.
app.get('/games', { onRequest: rawApp.authenticate, schema: {} }, async () => ({}));
// GOOD: shares the letters but not the /admin/ segment.
app.get('/administrators', { onRequest: rawApp.authenticate, schema: {} }, async () => ({}));
