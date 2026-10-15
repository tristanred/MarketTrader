import { hash, verify } from '@node-rs/argon2';

declare const db: any;
declare const users: any;

export async function authRoutes(app: any): Promise<void> {
  app.post('/auth/register', {}, async (request: any, reply: any) => {
    const { username, password } = request.body;
    const passwordHash = await hash(password); // OK: argon2
    await db.insert(users).values({ username, passwordHash }); // OK: the hash is stored
    await db.insert(users).values({ username, password }); // BAD: plaintext stored
    request.log.info({ username, password }, 'registering'); // BAD: logged
    return reply.status(201).send({ username, echo: password }); // BAD: echoed back
  });

  app.post('/auth/login', {}, async (request: any, reply: any) => {
    const valid = await verify('stored-hash', request.body.password); // OK: argon2
    app.log.info({ valid }, 'login verdict'); // OK: a boolean verdict
    return reply.send({ ok: valid });
  });
}
