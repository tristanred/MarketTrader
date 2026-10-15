import { WS_INVALID_FRAME_CLOSE_CODE, WS_POLICY_CLOSE_CODE } from './close-codes.js';

declare const app: any;

function closeSocket(socket: any, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // already closing
  }
}

app.get('/games/:id/live', { websocket: true }, (socket: any, request: any) => {
  if (!request.headers.token) {
    closeSocket(socket, WS_INVALID_FRAME_CLOSE_CODE, 'Missing token'); // flagged: credential decision
    return;
  }
  socket.on('message', (raw: any) => {
    try {
      if (!raw) {
        closeSocket(socket, WS_INVALID_FRAME_CLOSE_CODE, 'Invalid frame'); // GOOD
        return;
      }
      [raw].forEach(() => socket.close(WS_INVALID_FRAME_CLOSE_CODE)); // GOOD: nested in the listener
    } catch {
      closeSocket(socket, WS_INVALID_FRAME_CLOSE_CODE, 'Invalid frame'); // GOOD
    }
  });
  socket.on('close', () => {
    socket.close(WS_INVALID_FRAME_CLOSE_CODE); // flagged: not a message listener
  });
  closeSocket(socket, WS_POLICY_CLOSE_CODE, 'Not a member'); // GOOD: policy code
});
