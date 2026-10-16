import { describe, it, expect } from 'vitest';
import { redactConfigUrl } from '../../src/config/redact.js';

describe('redactConfigUrl', () => {
  it.each([
    ['postgres://user:pw@db:5432/app', 'postgres://***@db:5432/app'],
    ['postgres://user:p@ss@db/app', 'postgres://***@db/app'],
    ['postgres://user@db/app', 'postgres://***@db/app'],
    ['libsql://db.turso.io?authToken=abc.def', 'libsql://db.turso.io?authToken=***'],
    ['https://x.io/?a=1&token=s3cret&b=2', 'https://x.io/?a=1&token=***&b=2'],
    // An unencoded `/` in a password must not end the userinfo early and leak its tail.
    ['postgres://user:p/ss@db/app', 'postgres://***@db/app'],
    ['postgres://db/app?sslpassword=pw&sslmode=require', 'postgres://db/app?sslpassword=***&sslmode=require'],
    ['https://x.io/v1?api_key=k1&access_token=t1#frag', 'https://x.io/v1?api_key=***&access_token=***#frag'],
    ['http://localhost:4318', 'http://localhost:4318'],
    ['./dev.db', './dev.db'],
    ['/var/lib/markettrader/app.db', '/var/lib/markettrader/app.db'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(redactConfigUrl(input)).toBe(expected);
  });
});
