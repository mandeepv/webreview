// whenPixelReady (P3-5): advanced matching attaches as soon as the pixel
// exists, instead of after a fixed 1.5 s guess.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '000000000000000');
  return import('./meta');
}

beforeEach(() => {
  vi.useFakeTimers();
  delete (window as { fbq?: unknown }).fbq;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('whenPixelReady', () => {
  it('runs at once when the pixel is already there', async () => {
    const { whenPixelReady } = await load();
    window.fbq = vi.fn();
    const fn = vi.fn();
    whenPixelReady(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits for a pixel that loads late, then runs once', async () => {
    const { whenPixelReady } = await load();
    const fn = vi.fn();
    whenPixelReady(fn);
    vi.advanceTimersByTime(2500);
    expect(fn).not.toHaveBeenCalled();
    window.fbq = vi.fn();
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after 10 seconds, and can be cancelled', async () => {
    const { whenPixelReady } = await load();
    const late = vi.fn();
    whenPixelReady(late);
    vi.advanceTimersByTime(10_100);
    window.fbq = vi.fn();
    vi.advanceTimersByTime(1000);
    expect(late).not.toHaveBeenCalled();

    delete (window as { fbq?: unknown }).fbq;
    const cancelled = vi.fn();
    const cancel = whenPixelReady(cancelled);
    cancel();
    window.fbq = vi.fn();
    vi.advanceTimersByTime(1000);
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe('leadEventId', () => {
  // The same vector is pinned in supabase/functions/_shared/meta_test.ts:
  // the server-side Lead must carry the identical id or Meta counts it twice.
  it('is "lead-" + the sha256 of the session id, never the id itself (SPEC-21)', async () => {
    vi.useRealTimers();
    const { leadEventId } = await load();
    const sessionId = '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b';
    const id = await leadEventId(sessionId);
    expect(id).toBe('lead-1129de95b35538debaff2294377bffd8b1e5bb25b8b6cb843ccdbbb9a50377c4');
    expect(id).not.toContain(sessionId);
  });
});
