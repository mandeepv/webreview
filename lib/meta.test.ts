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
