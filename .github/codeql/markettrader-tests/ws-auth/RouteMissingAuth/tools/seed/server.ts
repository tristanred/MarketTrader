declare const app: any;

// Outside packages/server/src: never flagged.
app.get('/games/secret', { schema: {} }, async () => ({}));
