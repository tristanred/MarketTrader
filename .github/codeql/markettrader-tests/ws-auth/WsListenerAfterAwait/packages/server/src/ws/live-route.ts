declare const app: any;
declare const db: any;
declare const registry: any;
declare function lookup(id: string): Promise<boolean>;
declare function stream(): AsyncIterable<number>;

// BAD: listeners attached after the membership lookup.
app.get('/games/:id/live', { websocket: true }, async (socket: any, request: any) => {
  const ok = await lookup(request.params.id);
  if (!ok) return;
  registry.add(socket);
  socket.on('message', (raw: any) => { // flagged
    try { JSON.parse(raw); } catch { /* ignore */ }
  });
  socket.on('close', () => registry.remove(socket)); // flagged
  socket.on('error', () => registry.remove(socket)); // flagged
  socket.on('pong', () => {}); // not a lifecycle listener this invariant covers
});

// GOOD: listeners first, then the await.
app.get('/ws/live', { websocket: true }, async (socket: any, request: any) => {
  socket.on('close', () => registry.remove(socket));
  socket.on('error', () => registry.remove(socket));
  await lookup(request.headers.x);
  registry.add(socket);
});

// GOOD: the only await is on an early-return path that never reaches the listeners.
app.get('/ws/early', { websocket: true }, async (socket: any, request: any) => {
  if (!request.headers.token) {
    await db.audit('rejected');
    socket.close();
    return;
  }
  socket.on('close', () => registry.remove(socket));
});

// BAD: a for-await suspends just like await.
app.get('/ws/stream', { websocket: true }, async (socket: any) => {
  for await (const n of stream()) {
    registry.note(n);
  }
  socket.on('close', () => registry.remove(socket)); // flagged
});

// BAD: the real shape — destructuring await inside the verification block, listener nested in an if.
app.get('/ws/shape', { websocket: true }, async (socket: any, request: any) => {
  let ok = false;
  try {
    const [row] = await db.select(request.params.id);
    ok = Boolean(row);
  } catch {
    return;
  }
  const s = socket;
  if (ok) {
    s.once('close', () => registry.remove(socket)); // flagged
  }
});

// GOOD: un-awaited async work does not suspend the handler.
app.get('/ws/fire', { websocket: true }, async (socket: any) => {
  void lookup('x');
  socket.on('close', () => registry.remove(socket));
});

// GOOD: an await inside a nested callback does not suspend the handler.
app.get('/ws/nested', { websocket: true }, async (socket: any) => {
  const later = async () => { await lookup('x'); };
  socket.on('close', () => registry.remove(socket));
  later();
});

// GOOD: not a websocket route.
app.get('/plain', { schema: {} }, async (request: any, reply: any) => {
  await lookup('x');
  request.raw.on('close', () => {});
});

// GOOD: listener on a different emitter, not the route's socket.
app.get('/ws/other', { websocket: true }, async (socket: any) => {
  socket.on('close', () => {});
  await lookup('x');
  db.on('error', () => {});
});
