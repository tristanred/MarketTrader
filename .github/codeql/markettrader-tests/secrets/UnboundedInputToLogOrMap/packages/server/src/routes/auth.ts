import { z } from 'zod';
import type { FailedLoginTracker } from '../services/failed-login.js';

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(8),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const nicknameSchema = z.string().regex(/^[a-z]+$/);
const profileSchema = z.object({ nickname: nicknameSchema, code: z.string().uuid() });

const seen = new Map<string, number>();

export function authRoutes(loginThrottle: FailedLoginTracker) {
  return async function (app: any): Promise<void> {
    const recordFailedLogin = (username: string): void => {
      if (loginThrottle.recordFailure(username)) { // BAD: unbounded key into the tracker
        app.log.warn({ username }, 'login throttled'); // BAD: unbounded value logged
      }
    };

    app.post('/auth/login', { schema: { body: loginSchema } }, async (request: any, reply: any) => {
      const { username, password } = request.body;
      if (loginThrottle.retryAfterMs(username) !== null) return reply.status(429).send({}); // BAD
      recordFailedLogin(username);
      void password; // OK: never reaches a sink
      return reply.send({});
    });

    app.post('/auth/register', { schema: { body: registerSchema } }, async (request: any) => {
      const { username } = request.body;
      app.log.info({ username }, 'registered'); // OK: bounded by .max(30)
      loginThrottle.reset(username); // OK: bounded
      return {};
    });

    app.post('/auth/profile', { schema: { body: profileSchema } }, async (request: any) => {
      seen.set(request.body.nickname, Date.now()); // BAD: .regex is not counted as a bound
      seen.set(request.body.code, Date.now()); // OK: .uuid() is fixed length
      return {};
    });

    app.post('/auth/inline', { schema: { body: z.object({ note: z.string().max(200) }) } }, async (request: any) => {
      app.log.info(request.body.note); // OK: inline schema with .max
      return {};
    });
  };
}
