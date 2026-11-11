// Mirrors the server's `inviteCodeParamsSchema` bound. The alphabet check is
// deliberately looser than the generator's so a future code format still
// reaches the server, which is the only thing that can say a code is wrong.
const CODE_PATTERN = /^[A-Z0-9]{1,32}$/;
const JOIN_PATH = /\/join\/([^/?#]+)/i;

/**
 * Turns whatever someone pasted — a bare code, a code quoted with spaces or a
 * dash, or a whole `/join/:code` link — into the canonical uppercase code.
 * Returns `null` when the input cannot be an invite code.
 */
export function parseInviteCode(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = JOIN_PATH.exec(trimmed)?.[1];
  if (!fromLink && trimmed.includes('/')) return null;
  const code = (fromLink ?? trimmed).replace(/[\s-]/g, '').toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}
