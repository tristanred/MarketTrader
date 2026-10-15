declare const app: any;

// GOOD: Fastify replies are not socket sends.
app.get('/games', { schema: {} }, async (_request: any, reply: any) => {
  reply.header('x', '1');
  if (Math.random() > 0.5) return reply.code(404).send({ error: 'nope' });
  return reply.send({ ok: true });
});
