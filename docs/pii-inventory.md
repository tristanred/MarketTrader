# Personal Data Inventory

Every piece of personal data MarketTrader stores or ships, where it lives, why, how long it is kept, and who can
see it. This is a living document: **a change that starts storing or sending new personal data updates this
file in the same commit** (rule in `CLAUDE.md`). It exists so that a future privacy obligation (e.g. GDPR
if the audience reaches the EU) starts from an accurate list rather than an archaeology project.

"Admins" means members of the `admin` group. Nothing here is visible to other players unless stated.

| Data | Where | Purpose | Retention | Visible to |
|---|---|---|---|---|
| Username | `users.username`; copied into `admin_audit_log.before/after` JSON on user edits | Identity; shown on leaderboards, game lists, featured games | Until the account is deleted; audit copies indefinitely | **Everyone** (incl. logged-out visitors via featured games) |
| Password hash (argon2) | `users.password_hash` | Authentication | Until the account is deleted | Nobody (never returned by any API) |
| Account creation time | `users.created_at` | Probation (`LIMITS_MATURITY_DAYS`), admin views | Until the account is deleted | Admins |
| Registration IP | `users.registration_ip` | Per-IP registration quota; sibling-account detection | Until the account is deleted (no automatic purge — candidate for one) | Admins |
| Request IP (logged-out traffic) | `api_usage_hourly.subject_id`, `limit_denials_hourly.subject_id` where `subject_type = 'ip'` | Abuse monitoring | `USAGE_RETENTION_DAYS` (default 30) | Admins |
| Per-user request and denial counts | `api_usage_hourly`, `limit_denials_hourly` (`subject_type = 'user'`) | Abuse monitoring | `USAGE_RETENTION_DAYS`; deleted with the account (a usage flush that races the delete can leave up to one `USAGE_FLUSH_INTERVAL_MS` of rows until the retention prune) | Admins |
| Limit overrides and their notes | `user_limit_overrides` | Per-user limit exceptions (notes are free text an admin writes about a user) | Until cleared or the account is deleted | Admins |
| Admin actions on a user | `admin_audit_log` | Accountability for admin writes | Indefinite | Admins |
| Trading activity | `trades`, `portfolios`, `game_players`, `portfolio_snapshots`, achievements tables | The game | Until the game or account is deleted | Members of the same game |
| Request IP and URL in logs | pino request logs (`remoteAddress`); shipped to the OTLP collector and, at `warn`+, to PostHog Logs | Operations, debugging | Per the collector/PostHog retention settings (outside this repo) | Operators |
| Analytics identity | PostHog person: `distinctId = users.id`, properties `username`, `groups` (`lib/posthog.ts` identify; server events in `observability/analytics.ts`) | Product analytics | PostHog project retention | PostHog project members |
| Session replay | PostHog replay (browser) | Debugging UX and errors | PostHog project retention | PostHog project members |
| Error reports | PostHog error tracking, tagged with `request.user.id` (`observability/error-capture.ts`) | Debugging | PostHog project retention | PostHog project members |
| Refresh token | HttpOnly cookie on the user's device; not stored server-side | Session | 7 days | The user's browser |

**Not collected:** email address, real name, payment data, precise location.
