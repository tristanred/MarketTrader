declare const app: { jwt: { sign(p: object): string } };

// OK: tests forge tokens on purpose and are not application source.
export const forged = app.jwt.sign({ sub: 'u' });
