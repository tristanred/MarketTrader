declare const rawApp: any;
declare const db: any;
const app = rawApp.withTypeProvider();

// GOOD: authenticated handler, including a closure inside it.
app.get('/games', { onRequest: rawApp.authenticate, schema: {} }, async (request: any) => {
  const userId = request.user.id;
  return db.rows().map(() => request.user.username + userId);
});

// GOOD: requireAdmin also populates request.user.
app.get('/admin/games', { onRequest: rawApp.requireAdmin, schema: {} }, async (request: any) => {
  return request.user.id;
});

// BAD: public route reading request.user.
app.get('/public/featured-games', { schema: {} }, async (request: any) => {
  return request.user.id; // flagged
});

// BAD: destructured and optional-chained reads on an unguarded route.
app.get('/public/other', { schema: {} }, async (request: any) => {
  const { user } = request; // flagged
  return [user?.id, request.user?.id]; // flagged (request.user)
});

// GOOD: destructured read inside a guarded handler whose options live in a const.
const guarded = { onRequest: rawApp.authenticate, schema: {} };
app.get('/games/mine', guarded, async (request: any) => {
  const { user } = request;
  if (user) return [1].map(() => request.user.id);
  return null;
});

// BAD: a helper outside any handler.
export function currentUser(request: any): string {
  return request.user.id; // flagged
}
