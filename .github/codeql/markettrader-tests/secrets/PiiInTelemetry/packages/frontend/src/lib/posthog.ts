interface AuthUser {
  id: string;
  username: string;
  groups: string[];
}
declare const ph: any;

export function log(level: string, body: string, attrs?: Record<string, unknown>): void {
  ph.logger[level](body, attrs);
}

export function identifyUser(user: AuthUser): void {
  ph.identify(user.id, { username: user.username, groups: user.groups }); // OK: the username person property is deliberate
  ph.identify(user.id, { groups: user.groups }); // OK: opaque id only
  ph.identify(user.id, { handle: user.username }); // BAD: only the `username` trait is exempt
  ph.identify(user.username); // BAD: username as the distinct id
}

export function onLogin(user: AuthUser): void {
  log('info', `login ${user.username}`); // BAD: frontend log facade
  log('info', 'login', { id: user.id }); // OK
}

declare function useForm(): any;
declare function capture(event: string, props?: Record<string, unknown>): void;

export function LoginForm(user: AuthUser | null): void {
  const form = useForm();
  form.register(user?.username ?? 'username'); // OK: react-hook-form field binding, not analytics
  ph.register({ environment: 'dev' }); // OK: super-property without PII
  if (user) {
    capture('login_viewed', { who: user?.username }); // BAD: optional chaining, nested in if
  }
}
