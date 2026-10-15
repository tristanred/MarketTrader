declare const rawApp: any;
declare const z: any;
const app = rawApp.withTypeProvider();
const auth = rawApp.authenticate;
const idParams = z.object({ id: z.string() });
const sharedSchema = { params: idParams, body: z.object({}) };
const tagsOnly = { tags: ['x'] };
declare function externalSchema(): unknown;

// GOOD: params declared.
app.get('/games/:id', { onRequest: auth, schema: { params: idParams } }, async (request: any) => request.params.id);

// BAD: path parameter without schema.params.
app.get('/games/:id/players', { onRequest: auth, schema: { tags: ['x'] } }, async (request: any) => request.params.id); // flagged

// BAD: no schema at all on a parameterised path.
app.get('/games/:id/raw', { onRequest: auth }, async () => ({})); // flagged

// GOOD: body declared.
app.post('/games', { onRequest: auth, schema: { body: z.object({}) } }, async (request: any) => request.body.name);

// BAD: body read without schema.body.
app.patch('/games', { onRequest: auth, schema: { tags: ['x'] } }, async (request: any) => { // flagged
  const { name } = request.body;
  return name;
});

// GOOD: POST that never reads the body needs no body schema.
app.post('/games/flush', { onRequest: auth, schema: { tags: ['x'] } }, async () => ({}));

// BAD: query read (inside a nested closure) without schema.querystring.
app.get('/games/search', { onRequest: auth, schema: { tags: ['x'] } }, async (request: any) => { // flagged
  return [1].map(() => request.query.q);
});

// GOOD: querystring declared.
app.get('/games/browse', { onRequest: auth, schema: { querystring: z.object({}) } }, async (request: any) => request.query.page);

// GOOD: schema shared through a const.
app.put('/games/:id', { onRequest: auth, schema: sharedSchema }, async (request: any) => request.body);

// Real routes register inside a plugin function, with schemas held in module-level consts.
export function plugin(): void {
  // GOOD: module-level shared schema resolves across the closure boundary.
  app.patch('/games/:id/plugin', { onRequest: auth, schema: sharedSchema }, async (request: any) => request.body);

  // BAD: module-level schema const that lacks params.
  app.get('/games/:id/plugin-bad', { onRequest: auth, schema: tagsOnly }, async () => ({})); // flagged

  // BAD: DELETE reading a body without schema.body.
  app.delete('/games/:id/items', { onRequest: auth, schema: { params: idParams } }, async (request: any) => { // flagged
    const { body } = request;
    return body.ids;
  });

  // BAD: destructured query read without schema.querystring.
  app.get('/games/list', { onRequest: auth, schema: { tags: ['x'] } }, async (request: any) => { // flagged
    const { query } = request;
    return query.page;
  });
}

// GOOD: schema built elsewhere — given the benefit of the doubt.
app.put('/games/:id/opaque', { onRequest: auth, schema: externalSchema() }, async (request: any) => request.body);
