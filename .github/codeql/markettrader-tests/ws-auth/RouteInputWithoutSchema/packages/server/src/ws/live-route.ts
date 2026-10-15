declare const app: any;

// BAD: WebSocket route with a path parameter and no params schema.
app.get('/games/:id/live', { websocket: true }, async (socket: any, request: any) => { // flagged
  socket.send(request.params.id);
});

// GOOD: no input.
app.get('/ws/live', { websocket: true }, async (socket: any) => {
  socket.send('hi');
});
