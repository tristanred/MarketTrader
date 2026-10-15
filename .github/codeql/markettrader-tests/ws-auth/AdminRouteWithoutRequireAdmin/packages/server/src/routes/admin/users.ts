declare const rawApp: any;
const app = rawApp.withTypeProvider();
const handler = async () => ({});

// GOOD.
app.get('/admin/users', { onRequest: rawApp.requireAdmin, schema: {} }, handler);
app.delete('/admin/users/:id', { onRequest: [rawApp.requireAdmin], schema: {} }, handler);

// BAD: authenticate admits any signed-in player.
app.patch('/admin/users/:id', { onRequest: rawApp.authenticate, schema: {} }, handler); // flagged

// BAD: no guard at all.
app.get('/admin/stats', { schema: {} }, handler); // flagged

// BAD: declared under routes/admin/ even though the path does not say so.
app.post('/maintenance/flush', { onRequest: rawApp.authenticate, schema: {} }, handler); // flagged
