#!/usr/bin/env node
/**
 * Deploy MarketTrader to the self-hosted server.
 *
 *   pnpm ship                      # deploy origin/main
 *   pnpm ship --ref v1.2.0         # deploy a tag
 *   pnpm ship --ref abc1234        # roll back to a commit
 *   pnpm ship --host user@example  # override the target
 *
 * Named `ship` rather than `deploy`/`publish` because both of those are pnpm
 * built-in commands and would shadow a package script of the same name.
 *
 * See docs/deployment-selfhost.md.
 */
import { spawn } from 'node:child_process';

const DEFAULT_HOST = process.env.MARKETTRADER_DEPLOY_HOST ?? 'tristan@192.168.2.117';
const DEFAULT_REF = 'origin/main';
const APP_DIR = process.env.MARKETTRADER_APP_DIR ?? '/opt/markettrader';

function parseArgs(argv) {
  const opts = { host: DEFAULT_HOST, ref: DEFAULT_REF };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ref' || arg === '--host') {
      const value = argv[++i];
      if (!value) fail(`${arg} requires a value`);
      opts[arg.slice(2)] = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: pnpm ship [--ref <git-ref>] [--host <user@host>]',
          '',
          `  --ref   git ref to deploy (default: ${DEFAULT_REF})`,
          `  --host  ssh target        (default: ${DEFAULT_HOST})`,
        ].join('\n'),
      );
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function fail(message) {
  console.error(`[ship] ERROR: ${message}`);
  process.exit(1);
}

const { host, ref } = parseArgs(process.argv.slice(2));

// The ref is interpolated into a remote shell command. Restrict it to the
// characters git actually allows in a ref or SHA so it can't carry a payload.
if (!/^[A-Za-z0-9._/-]+$/.test(ref)) {
  fail(`refusing to deploy suspicious ref: ${ref}`);
}

console.log(`[ship] deploying ${ref} to ${host}`);

const remote = `${APP_DIR}/deploy/deploy.sh ${ref}`;
// -t allocates a TTY so remote output streams live instead of buffering.
const ssh = spawn('ssh', ['-t', host, remote], { stdio: 'inherit' });

ssh.on('error', (err) => fail(`failed to launch ssh: ${err.message}`));
ssh.on('exit', (code, signal) => {
  if (signal) fail(`ssh terminated by signal ${signal}`);
  if (code !== 0) {
    console.error(`[ship] deploy failed (exit ${code})`);
    process.exit(code ?? 1);
  }
  console.log('[ship] done');
});
