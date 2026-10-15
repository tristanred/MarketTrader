// OK: the seed tool is not application source.
declare const client: { execute(q: string): unknown };
export const r = client.execute('PRAGMA busy_timeout = 5000');
