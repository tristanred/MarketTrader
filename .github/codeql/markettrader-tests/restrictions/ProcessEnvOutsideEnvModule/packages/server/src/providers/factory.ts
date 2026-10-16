import nodeProcess, { env as procEnv } from 'node:process';
import { env } from '../env';

declare function use(v: unknown): void;

export function create() {
  use(process.env.MOCK_PRICES); // BAD: dotted read
  use(process.env['MOCK_PRICES']); // BAD: computed read
  const { NODE_ENV } = process.env; // BAD: destructuring
  use(NODE_ENV);
  use(process.env); // BAD: passing the whole object
  use(nodeProcess.env.X); // BAD: imported process
  use(procEnv); // BAD: named import of env
  use(env.PORT); // OK: validated env object
  use(globalThis.process.env.Y); // BAD: via globalThis
  const { env: e2 } = process; // BAD: destructured from process
  use(e2);
  use(process['env']); // BAD: computed
  use(process?.env?.Z); // BAD: optional chaining
  use(process.argv); // OK: not env
}
