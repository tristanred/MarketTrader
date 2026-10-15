declare const app: any;
declare function lookup(): Promise<void>;

// Outside application source: never flagged.
app.get('/games/:id/live', { websocket: true }, async (socket: any) => {
  await lookup();
  socket.on('close', () => {});
});
