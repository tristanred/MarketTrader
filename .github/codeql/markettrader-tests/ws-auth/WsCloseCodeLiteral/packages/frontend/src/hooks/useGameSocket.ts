export function leave(ws: WebSocket): void {
  ws.close(1000); // flagged
  ws.close(); // GOOD
}
