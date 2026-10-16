import { WS_POLICY_CLOSE_CODE } from './close-codes.js';

declare const app: any;

export function reject(socket: any): void {
  socket.close(WS_POLICY_CLOSE_CODE, 'Invalid token'); // GOOD: named constant
  socket.close(1008, 'Invalid token'); // flagged
  socket.close(4001 as number); // flagged
  socket.close(); // GOOD: no code
}

export async function shutdown(): Promise<void> {
  await app.close(); // GOOD: Fastify close, no code
}
