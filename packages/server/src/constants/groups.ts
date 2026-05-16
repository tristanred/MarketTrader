/**
 * Authorization group constants. The `admin` group is seeded by migration
 * `0006_lowly_loners.sql` (sqlite) / `0005_cuddly_angel.sql` (pg) with the
 * deterministic id below so server code can reference it without a lookup.
 */
export const ADMIN_GROUP_ID = '00000000-0000-0000-0000-000000000001';
export const ADMIN_GROUP_NAME = 'admin';
