# Dependency Vulnerability Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 44 open Dependabot alerts on `tristanred/MarketTrader` (2 critical, 19 high, 22 medium, 1 low, as of 2026-10-15), with no unrelated version churn.

**Architecture:** All 44 alerts are npm packages in `pnpm-lock.yaml`. Code scanning and secret scanning have no open alerts. 42 of the 44 clear by moving direct dependencies to their latest patch versions and refreshing the transitive dependencies inside their existing semver ranges. This was tested in a throwaway worktree, where `pnpm audit` went from 48 findings to 2. Both remaining findings come from Tailwind CSS v3, which pins old majors: one gets a scoped pnpm override and the other has no upstream fix, so its alert is dismissed with a written reason.

**Tech Stack:** pnpm 11 workspaces (`overrides` live in `pnpm-workspace.yaml`), Vitest, `gh` CLI for the Dependabot API.

**Spec:** None. The input is the Dependabot alert list. To fetch it again: `gh api repos/tristanred/MarketTrader/dependabot/alerts --paginate -q '.[] | select(.state=="open")'`.

## Global Constraints

- Do the work on a branch off `origin/main` (`2006f3a`), not on `main` itself.
- Change no major or minor versions except the ones listed in each task. A blanket `pnpm up -r` is out of scope: in testing it also bumped React 19.2→19.3, Radix and OpenTelemetry minors, Playwright, and more.
- Never hand-edit `pnpm-lock.yaml`. Deployment installs with `--frozen-lockfile`, so the lockfile must be committed together with the `package.json` changes that produced it.
- Every new pnpm override goes in `pnpm-workspace.yaml` under `overrides:`. It must be scoped to its parent (`parent>child`) and carry a comment explaining why, in the style of the two esbuild overrides already there.
- No ADR is needed. Tailwind v4 would need one, and that migration is out of scope (see Task 3).
- Add a `patch` changeset covering all three packages. They are a fixed group, see `CLAUDE.md` → Versioning.

## Alert → fix map

| Alerts | Package (installed → fixed) | Reached via | Exposure | Fixed in |
|---|---|---|---|---|
| #103–107, #83, #84 | fastify 5.12.0 → 5.12.7 | direct (server) | **Real.** On every request path: auth bypass through not-found handlers, validation bypass, X-Forwarded-* spoofing under a hop-count `trustProxy` | Task 1 |
| #126 | fast-jwt 6.3.2 → 6.3.5 | `@fastify/jwt` 10.2.1 → 10.2.4 | Low. Only affects the verifier cache, which `plugins/jwt.ts` doesn't turn on, and our tokens always carry `iat` | Task 1 |
| #79–82, #85–86, #88–89, #97, #99, #110, #117 | fast-uri 3.1.5 / 4.1.2 → 3.1.8 / 4.2.x | ajv (fastify, swagger, json-schema-resolver) | Medium. Used by ajv's `uri` format checks | Task 1 |
| #125, #122, #90, #87, #91–93, #108, #98, #101, #109, #116 | @modelcontextprotocol/sdk, proxy-addr, qs, hono, ip-address | `yahoo-finance2` 4.0.2 → 4.0.3 (pulls SDK `^1.32`) | Low. These sit inside the MCP SDK, which yahoo-finance2 bundles; we never start its express/hono server | Task 1 |
| #100, #118 | @grpc/grpc-js 1.14.4 → 1.14.6 | `@opentelemetry/sdk-node`, `pino-opentelemetry-transport` | Low. We use the `-http` OTLP exporters; gRPC only runs if `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` is set | Task 1 |
| #124 (critical) | shell-quote 1.10.0 → 1.11.x | `@changesets/cli` → launch-editor | Dev-only | Task 2 |
| #94, #95 | vitest / @vitest/mocker 4.1.10 → 4.1.11 | direct (dev) | Dev-only | Task 2 |
| #120 | fast-copy 4.0.4 → 4.1.x | `pino-pretty` 13.1.3 → 13.2.0 (dev) | Dev-only | Task 2 |
| #96, #114, #115 | js-yaml 4.3.1, brace-expansion 1.1.18 / 5.0.9 | eslint, typescript-eslint, `@fastify/otel` → minimatch | Dev-only, except the brace-expansion 5.x copy, which `@fastify/otel` and `@fastify/swagger-ui` also pull in at runtime (static globs) | Task 2 |
| #123 | source-map-js 1.2.1 → 1.2.2 | postcss (vite, tailwind, tsup) | Build-only | Task 2 |
| #121 | postcss-selector-parser 6.1.4 → 7.1.6 | `tailwindcss@3.4.19`, `postcss-nested@6` (both pin `^6`) | Build-only; the input is our own CSS | Task 3 (override) |
| #119 | braces 3.0.3, **no patched release** | tailwind → chokidar 3 / micromatch | Build-only; the input is the fixed `content` globs in `tailwind.config` | Task 3 (dismiss) |

## Review Focus

1. **The fastify 5.12.7 upgrade changes how `X-Forwarded-*` is handled under a hop-count `trustProxy`.** `TRUST_PROXY` accepts a hop count (`parseTrustProxy` in `env.ts`), and `request.ip` is the rate-limit key, but `routes/rate-limit-proxy.test.ts` only covers `'loopback'` and `true`. Task 1 adds a hop-count case. Expected behavior: forged leftmost hops still share one bucket and the 6th login gets 429.
   **Superseded during execution:** fastify 5.12.7 removed `number` from the `trustProxy` type and treats a hop count as trusting nothing. The hop-count test only passed because every request then collapsed onto the proxy's own address. So instead of that test, `parseTrustProxy` now rejects hop counts at boot (`tests/env.test.ts` → "rejects a hop count").
2. **An expired access token must still get 401 after the fast-jwt bump**, including one minted without `iat`, which is the exact shape in #126. Task 1 adds that test.
3. **yahoo-finance2 4.0.3 must still return quotes in the shape the provider expects.** `tests/providers/yahoo.test.ts` covers this. Run it explicitly; don't rely on it being somewhere in the full suite.
4. **The postcss-selector-parser 7 override must not change the CSS output.** Task 3 diffs the built CSS before and after the override.
5. **The production server bundle must still build and boot.** That bundle is `tsup` with the esbuild override. Task 1 runs `pnpm --filter server build` and starts the built server for a smoke check.

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch from the worktree on `main`**

```bash
git switch -c fix/dependency-vulnerabilities
pnpm install --frozen-lockfile
pnpm audit --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).metadata.vulnerabilities))'
```

Expected: `{ info: 0, low: 1, moderate: 22, high: 23, critical: 2 }`. This is the baseline, and later steps compare against it. Save the one-liner as `audit-summary`; the rest of the plan uses it.

---

### Task 1: Server runtime dependencies

**Files:**
- Modify: `packages/server/package.json`: `fastify` `^5.12.7`, `@fastify/jwt` `^10.2.4`, `yahoo-finance2` `^4.0.3`
- Modify: `pnpm-lock.yaml` (regenerated)
- Test: `packages/server/tests/routes/rate-limit-proxy.test.ts`, `packages/server/tests/auth-token-type.test.ts`
- Create: `.changeset/dependency-security-updates.md`

**Interfaces:** none. This task changes no code, only versions and tests.

- [ ] **Step 1: Pin the hop-count `trustProxy` behavior with a test**

In `rate-limit-proxy.test.ts`, widen the helper so it also takes a hop count:

```ts
async function buildAppWithTrust(trustProxy: boolean | string | number): Promise<FastifyInstance> {
```

If `buildApp`'s `trustProxy` option doesn't accept `number`, use the type that `parseTrustProxy` returns in `env.ts`. That return type is what production passes in (`index.ts:83`).

Then add this block after the `'loopback'` describe:

```ts
  describe('trustProxy: 1 (hop count, accepted by TRUST_PROXY)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildAppWithTrust(1);
    });

    afterAll(async () => {
      await app.close();
    });

    // One trusted hop means the client is the entry the proxy appended (rightmost),
    // so a forged leftmost hop must not mint a fresh bucket.
    it('keeps every forged request in the same bucket and enforces the cap', async () => {
      const statuses: number[] = [];
      for (let n = 1; n <= LOGIN_CAP + 1; n++) {
        statuses.push((await spoofedLogin(app, n)).statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });
  });
```

- [ ] **Step 2: Pin expired-token rejection with a test**

In `auth-token-type.test.ts`, add this inside the first describe, after `'rejects a token carrying no type claim'`:

```ts
  it('rejects an expired access token, with or without iat', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const claims = { id: adminId, username: 'tokentype-admin', type: 'access', exp: past };
    const withIat = app.jwt.sign({ ...claims, iat: past - 900 });
    // GHSA-x937-hj6v-793p: the verifier cache accepted expired tokens lacking iat.
    const withoutIat = app.jwt.sign(claims, { noTimestamp: true });
    expect((await getGames(withIat)).statusCode).toBe(401);
    expect((await getGames(withoutIat)).statusCode).toBe(401);
  });
```

If `app.jwt.sign`'s types reject `noTimestamp`, check the `SignerOptions` type that `@fastify/jwt` exports. fast-jwt itself names the option `noTimestamp`.

- [ ] **Step 3: Run both tests on the current versions**

```bash
pnpm build:shared
pnpm --filter server exec vitest run tests/routes/rate-limit-proxy.test.ts tests/auth-token-type.test.ts
```

Expected: PASS. These are **regression pins**, not reproductions. The JWT cache is off and inject doesn't exercise the fastify hop-count bug, so neither test can fail before the fix. What they do is stop the upgrade from changing behavior we rely on. If either one **fails** here, stop and report it: that's an existing bug and should be handled separately.

- [ ] **Step 4: Upgrade the direct dependencies and refresh the runtime transitive dependencies**

```bash
pnpm up -r fastify @fastify/jwt yahoo-finance2 fast-jwt hono qs ip-address express proxy-addr
pnpm up -r --depth Infinity fast-uri @grpc/grpc-js
```

The second command is needed because, in testing, `fast-uri` (through `json-schema-resolver`) and `@grpc/grpc-js` didn't move without `--depth Infinity`.

- [ ] **Step 5: Check that the `package.json` diff contains only the intended changes**

```bash
git diff -U0 -- '*package.json'
```

Expected: only the three specifier lines in `packages/server/package.json` listed under **Files**. If anything else changed, revert it with `git checkout -- <file>` and run the step again with fewer names.

- [ ] **Step 6: Verify the runtime alerts are gone**

```bash
pnpm audit --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const a of Object.values(JSON.parse(s).advisories))console.log(a.module_name)})' | grep -E '^(fastify|fast-jwt|fast-uri|@modelcontextprotocol/sdk|proxy-addr|qs|hono|ip-address|@grpc/grpc-js)$'
```

Expected: no output.

- [ ] **Step 7: Run the full checks, the provider tests, and the build**

```bash
pnpm test && pnpm typecheck && pnpm lint
pnpm --filter server exec vitest run tests/providers/yahoo.test.ts tests/providers/market-status/yahoo.test.ts
pnpm --filter server build
```

Expected: all green.

- [ ] **Step 8: Smoke-test the built server**

```bash
(cd packages/server && DATABASE_URL=:memory: JWT_SECRET=$(node -e 'console.log("x".repeat(40))') STOCK_PROVIDER=mock PORT=3999 node dist/index.js) &
curl -sf --retry 15 --retry-connrefused --retry-delay 1 localhost:3999/health; curl -s localhost:3999/version; kill %1
```

Expected: `/health` returns OK and `/version` returns `{version, commit, buildTime}`. The `dist/` entry file may be named differently; check `package.json` → `start`.

- [ ] **Step 9: Add the changeset**

`.changeset/dependency-security-updates.md`:

```md
---
'@markettrader/frontend': patch
'@markettrader/server': patch
'@markettrader/shared': patch
---

Security: upgrade fastify, @fastify/jwt and yahoo-finance2, and refresh vulnerable transitive dependencies flagged by Dependabot.
```

- [ ] **Step 10: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/tests/routes/rate-limit-proxy.test.ts packages/server/tests/auth-token-type.test.ts .changeset/dependency-security-updates.md
git commit -m "fix(deps): upgrade fastify, @fastify/jwt, yahoo-finance2 for security advisories"
```

---

### Task 2: Dev and build tooling dependencies

**Files:**
- Modify: `package.json`: `@changesets/cli` `^3.0.3`
- Modify: `packages/server/package.json`: `vitest` `^4.1.11`, `pino-pretty` `^13.2.0`
- Modify: `packages/frontend/package.json`: `vitest` `^4.1.11`
- Modify: `pnpm-lock.yaml`

**Interfaces:** none.

- [ ] **Step 1: Upgrade**

```bash
pnpm up -r vitest @vitest/mocker pino-pretty @changesets/cli shell-quote
pnpm up -r --depth Infinity js-yaml brace-expansion source-map-js
```

- [ ] **Step 2: Check the `package.json` diff**

```bash
git diff -U0 -- '*package.json'
```

Expected: only the four specifier lines listed under **Files**. Revert anything else.

- [ ] **Step 3: Audit**

Run `audit-summary` from Task 0.
Expected: `{ info: 0, low: 0, moderate: 1, high: 1, critical: 0 }`. The two remaining findings should be `braces` and `postcss-selector-parser`, both under `tailwindcss`.

- [ ] **Step 4: Check that the tooling still works**

```bash
pnpm test && pnpm typecheck && pnpm lint
pnpm changeset status
pnpm --filter frontend build
```

Expected: all green. `changeset status` should list the Task 1 changeset, which confirms that `@changesets/cli` 3.0.3 still reads `.changeset/config.json`.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/server/package.json packages/frontend/package.json pnpm-lock.yaml
git commit -m "fix(deps): upgrade vitest, pino-pretty, changesets and dev transitives for security advisories"
```

---

### Task 3: Tailwind v3 holdovers (#121, #119)

**Files:**
- Modify: `pnpm-workspace.yaml` (`overrides:`)
- Modify: `pnpm-lock.yaml`

**Interfaces:** none.

`tailwindcss@3.4.19` is the last v3 release. It pins `postcss-selector-parser ^6.1.2` and `postcss-nested ^6.2.0`, and the latest `postcss-nested` itself requires `postcss-selector-parser ^7.1.6`. Tailwind v4 drops all of these, but moving to it is a rewrite of the CSS config and needs an ADR, so it is out of scope here.

- [ ] **Step 1: Capture the current CSS output**

```bash
pnpm --filter frontend build
cat packages/frontend/dist/assets/*.css > "$SCRATCH/css-before.css"
```

(`$SCRATCH` is any temporary directory outside the repo.)

- [ ] **Step 2: Add the scoped override**

Append this under `overrides:` in `pnpm-workspace.yaml`:

```yaml
  # tailwindcss@3.4.19 (last v3) and its postcss-nested@6 both pin
  # postcss-selector-parser ^6, which carries GHSA-rj75-hqrm-r3gf. The fix only
  # exists in 7.1.6, and current postcss-nested already depends on ^7.1.6, so 7.x
  # is a supported pairing with this parser API. Remove when moving to Tailwind v4.
  'tailwindcss>postcss-selector-parser': '^7.1.6'
  'postcss-nested>postcss-selector-parser': '^7.1.6'
```

Then run `pnpm install`.

- [ ] **Step 3: Rebuild and compare**

```bash
pnpm --filter frontend build
cat packages/frontend/dist/assets/*.css > "$SCRATCH/css-after.css"
diff "$SCRATCH/css-before.css" "$SCRATCH/css-after.css" && echo IDENTICAL
```

Expected: `IDENTICAL`. **If the files differ or the build fails**, revert the override (`git checkout -- pnpm-workspace.yaml pnpm-lock.yaml && pnpm install`) and dismiss #121 in Step 5 using the same reasoning as #119.

- [ ] **Step 4: Audit, test, and commit**

Run `audit-summary` and expect `{ ..., moderate: 0, high: 1, ... }`, where the only remaining finding is `braces`. Then run `pnpm test && pnpm --filter frontend e2e`.

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "fix(deps): override tailwind's postcss-selector-parser to 7.1.6 (GHSA-rj75-hqrm-r3gf)"
```

- [ ] **Step 5: Dismiss #119 (braces). Ask the user first, because this writes to GitHub.**

```bash
gh api -X PATCH repos/tristanred/MarketTrader/dependabot/alerts/119 \
  -f state=dismissed -f dismissed_reason=tolerable_risk \
  -f dismissed_comment="No patched braces release exists. Reached only via tailwindcss@3 (chokidar 3, micromatch) at build time; its input is the fixed content globs in tailwind.config, not user data. Revisit with the Tailwind v4 migration."
```

---

### Task 4: Ship and confirm

- [ ] **Step 1: Push and open the PR.** In the description, include the alert map table above and the fact that no deployment configuration changes. Nothing changes in env vars, proxy routes, or how the process is launched.
- [ ] **Step 2: After merge, confirm that Dependabot has closed the alerts:**

```bash
gh api repos/tristanred/MarketTrader/dependabot/alerts --paginate -q '[.[] | select(.state=="open")] | length'
```

Expected: `0`. Dependabot rescans `main` after a push, which can take a few minutes. Any alert still open should be checked against `pnpm why -r <pkg>`, because it may be a second copy that `pnpm audit` and Dependabot resolve differently.
