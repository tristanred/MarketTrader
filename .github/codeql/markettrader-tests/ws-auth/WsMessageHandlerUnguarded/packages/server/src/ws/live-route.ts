declare const registry: any;

export function attach(socket: any): void {
  // GOOD: whole body is a try/catch.
  socket.on('message', (raw: any) => {
    try {
      registry.handle(JSON.parse(raw.toString()));
    } catch {
      socket.close();
    }
  });

  // GOOD: a call-free declaration before the try is allowed.
  socket.on('message', (raw: any) => {
    const limit = 10;
    try {
      registry.handle(raw, limit);
    } catch {
      socket.close();
    }
  });

  // BAD: no try at all.
  socket.on('message', (raw: any) => { // flagged
    registry.handle(JSON.parse(raw.toString()));
  });

  // BAD: the parse runs before the try.
  socket.on('message', (raw: any) => { // flagged
    const parsed = JSON.parse(raw.toString());
    try {
      registry.handle(parsed);
    } catch {
      socket.close();
    }
  });

  // BAD: work after the try escapes it.
  socket.on('message', (raw: any) => { // flagged
    try {
      registry.handle(raw);
    } catch {
      socket.close();
    }
    registry.after(raw);
  });

  // BAD: try/finally with no catch.
  socket.on('message', (raw: any) => { // flagged
    try {
      registry.handle(raw);
    } finally {
      registry.done();
    }
  });

  // BAD: expression-bodied arrow.
  socket.on('message', (raw: any) => registry.handle(raw)); // flagged

  // GOOD: other events are out of scope.
  socket.on('close', () => registry.remove(socket));
}
