import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthUser } from '@markettrader/shared';

/**
 * The facade in `lib/posthog.ts` lazy-loads posthog-js, so everything here runs
 * against a fake SDK. The behaviour worth pinning is identity: a refresh must
 * not re-identify, and a different user signing in after a session that ended
 * without a logout must not be merged into the previous person.
 */

interface FakePostHog {
  distinctId: string;
  userState: 'anonymous' | 'identified';
  init: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  get_distinct_id: () => string;
  get_property: (name: string) => unknown;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

let fake: FakePostHog;

function makeFake(): FakePostHog {
  const f: FakePostHog = {
    distinctId: 'anon-1',
    userState: 'anonymous',
    init: vi.fn(),
    register: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    identify: vi.fn((id: string) => {
      f.distinctId = id;
      f.userState = 'identified';
    }),
    reset: vi.fn(() => {
      f.distinctId = 'anon-2';
      f.userState = 'anonymous';
    }),
    get_distinct_id: () => f.distinctId,
    get_property: (name) => (name === '$user_state' ? f.userState : undefined),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return f;
}

const alice: AuthUser = { id: 'user-alice', username: 'alice', groups: [] } as unknown as AuthUser;
const bob: AuthUser = { id: 'user-bob', username: 'bob', groups: [] } as unknown as AuthUser;

async function loadFacade(enabled: boolean) {
  vi.resetModules();
  vi.doMock('../src/lib/posthogConfig', () => ({
    posthogEnabled: enabled,
    posthogConfig: { key: 'phc_test', apiHost: '/relay', uiHost: 'https://us.posthog.com' },
  }));
  vi.doMock('posthog-js', () => ({ default: fake }));
  return import('../src/lib/posthog');
}

describe('lib/posthog facade', () => {
  beforeEach(() => {
    fake = makeFake();
  });

  it('does nothing at all when PostHog is not configured', async () => {
    const ph = await loadFacade(false);
    ph.capture('x');
    await ph.loadPostHog();
    expect(fake.init).not.toHaveBeenCalled();
    expect(fake.capture).not.toHaveBeenCalled();
  });

  it('replays calls made before the SDK loaded, in order', async () => {
    const ph = await loadFacade(true);
    ph.capture('first');
    ph.log('info', 'hello');
    ph.capture('second', { a: 1 });
    expect(fake.capture).not.toHaveBeenCalled();

    await ph.loadPostHog();

    expect(fake.init).toHaveBeenCalledWith('phc_test', expect.objectContaining({ api_host: '/relay' }));
    expect(fake.register).toHaveBeenCalledWith(expect.objectContaining({ environment: 'test' }));
    expect(fake.capture.mock.calls).toEqual([['first', undefined], ['second', { a: 1 }]]);
    expect(fake.logger.info).toHaveBeenCalledWith('hello', undefined);
  });

  it('identifies once and skips re-identifying the same user on refresh', async () => {
    const ph = await loadFacade(true);
    await ph.loadPostHog();

    ph.identifyUser(alice);
    ph.identifyUser(alice);

    expect(fake.identify).toHaveBeenCalledTimes(1);
    expect(fake.identify).toHaveBeenCalledWith('user-alice', { username: 'alice', groups: [] });
    expect(fake.reset).not.toHaveBeenCalled();
  });

  it('does not merge a new user into the previous identified person', async () => {
    const ph = await loadFacade(true);
    await ph.loadPostHog();
    ph.identifyUser(alice);

    // Alice's refresh failed (no logout, no reset), then Bob signs in.
    ph.identifyUser(bob);

    expect(fake.reset).toHaveBeenCalledTimes(1);
    expect(fake.reset.mock.invocationCallOrder[0]).toBeLessThan(
      fake.identify.mock.invocationCallOrder[1] ?? Infinity,
    );
    expect(fake.distinctId).toBe('user-bob');
  });

  it('identifies an anonymous visitor without resetting, so pre-login activity is kept', async () => {
    const ph = await loadFacade(true);
    await ph.loadPostHog();

    ph.identifyUser(alice);

    expect(fake.reset).not.toHaveBeenCalled();
  });

  it('resets on explicit logout', async () => {
    const ph = await loadFacade(true);
    await ph.loadPostHog();
    ph.identifyUser(alice);

    ph.resetUser();

    expect(fake.reset).toHaveBeenCalledTimes(1);
  });
});
