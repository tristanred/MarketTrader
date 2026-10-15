import { WS_POLICY_CLOSE_CODE } from '../lib/wsAuth.js';

export function isCredentialClose(code: number): boolean {
  if (code === WS_POLICY_CLOSE_CODE) return true; // GOOD
  return code === 1008; // flagged
}

export function isFrameReject(code: number): boolean {
  return code === 4400; // flagged
}

export const UNRELATED = 1009; // GOOD: not a close code this invariant tracks
