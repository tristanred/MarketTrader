import { useAdminLimitPolicy } from '@/api/admin/limits';
import { cn } from '@/lib/utils';

/**
 * The caller's IP as the server resolved it (`request.ip`, governed by TRUST_PROXY) and whether it
 * matches `LIMITS_PRIVILEGED_CIDRS` — the one place an admin can check the allowlist really matches.
 */
export function PrivilegedIpBanner() {
  const policy = useAdminLimitPolicy();
  if (!policy.data) return null;
  const { requestIp, requestIpPrivileged, privilegedMultiplier } = policy.data;
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        requestIpPrivileged ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-hairline-strong',
      )}
    >
      Your IP as the server sees it: <span className="font-mono">{requestIp}</span> —{' '}
      {requestIpPrivileged ? `privileged ✓ (limits ×${privilegedMultiplier})` : 'not privileged'}
    </div>
  );
}
