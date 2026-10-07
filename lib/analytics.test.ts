// lib/analytics: posthog-js loads on demand (FE-9), calls made before it
// loads are replayed in order, every event carries the environment
// super-properties (XR-7), and a purchase resets the identity before the
// next funnel run, not during /welcome (FE-5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = {
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_…');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://<DEV_PROJECT_REF>.supabase.co');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('./analytics');
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('analytics', () => {
  it('queues calls until posthog-js has loaded, then replays them in order with the super-properties set', async () => {
    const a = await load();
    a.track('web_funnel_landing_viewed', { variant: 'default' });
    a.identify('user-1');
    expect(posthog.capture).not.toHaveBeenCalled(); // not loaded yet
    await flush();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.register).toHaveBeenCalledWith({ environment: 'dev', app_env: 'dev', surface: 'web' });
    expect(posthog.capture).toHaveBeenCalledWith('web_funnel_landing_viewed', { variant: 'default' });
    expect(posthog.identify).toHaveBeenCalledWith('user-1');
    expect(posthog.capture.mock.invocationCallOrder[0]).toBeLessThan(posthog.identify.mock.invocationCallOrder[0]);
  });

  it('autocapture and session replay stay OFF: /welcome holds a sign-in link in its DOM (app INVARIANTS #29)', async () => {
    const a = await load();
    a.initAnalytics();
    await flush();
    expect(posthog.init.mock.calls[0][1]).toMatchObject({ autocapture: false, disable_session_recording: true });
  });

  it('tags the prod project as prod', async () => {
    const a = await load({ NEXT_PUBLIC_SUPABASE_URL: 'https://<PROD_PROJECT_REF>.supabase.co' });
    a.initAnalytics();
    await flush();
    expect(posthog.register).toHaveBeenCalledWith({ environment: 'prod', app_env: 'prod', surface: 'web' });
  });

  it('does nothing at all without a key', async () => {
    const a = await load({ NEXT_PUBLIC_POSTHOG_KEY: '' });
    a.track('web_funnel_offer_viewed');
    await flush();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('a purchase resets the identity on the next page that is not /welcome, once (FE-5)', async () => {
    const a = await load();
    a.initAnalytics();
    await flush();
    a.resetAnalyticsBeforeNextRun();
    a.consumePendingReset('/welcome');
    expect(posthog.reset).not.toHaveBeenCalled(); // the rest of /welcome is still the buyer's
    a.consumePendingReset('/start');
    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(posthog.register).toHaveBeenLastCalledWith({ environment: 'dev', app_env: 'dev', surface: 'web' });
    a.consumePendingReset('/quiz/1');
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});
