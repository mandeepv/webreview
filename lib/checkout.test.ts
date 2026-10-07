// lib/checkout — the browser half of the money path (review 2026-10-07,
// FE-11: it had no unit tests). The overlay must open in the mode of the
// checkout URL itself (P0-3), every failure must give the page a way out,
// and a silent overlay must not trap the buyer behind an invisible frame
// (FE-3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type OnEvent = (e: { event_type?: string; data?: { message?: { redirect_to?: string } } }) => void;
const sdk = {
  Initialize: vi.fn(),
  Checkout: { open: vi.fn(), close: vi.fn(), isOpen: vi.fn(() => true) },
};
vi.mock('dodopayments-checkout', () => ({ DodoPayments: sdk }));
vi.mock('./analytics', () => ({ track: vi.fn() }));

const TEST_URL = 'https://test.checkout.dodopayments.com/session/cks_1';
const LIVE_URL = 'https://checkout.dodopayments.com/session/cks_1';

async function load() {
  vi.resetModules();
  const checkout = await import('./checkout');
  const { track } = await import('./analytics');
  return { ...checkout, track: vi.mocked(track) };
}
const onEvent = (): OnEvent => sdk.Initialize.mock.calls.at(-1)![0].onEvent;

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, origin: 'https://kinderwell.app', assign },
    configurable: true,
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('openOverlayCheckout', () => {
  it('opens in the mode of the checkout URL itself, test or live (P0-3)', async () => {
    const { openOverlayCheckout } = await load();
    expect(await openOverlayCheckout(TEST_URL, vi.fn())).toBe(true);
    expect(sdk.Initialize.mock.calls[0][0]).toMatchObject({ mode: 'test', displayType: 'overlay' });
    expect(sdk.Checkout.open).toHaveBeenCalledWith({ checkoutUrl: TEST_URL });
    await openOverlayCheckout(LIVE_URL, vi.fn());
    expect(sdk.Initialize.mock.calls[1][0].mode).toBe('live');
  });

  it('returns false when the SDK cannot load or has changed shape, so the page redirects instead', async () => {
    vi.doMock('dodopayments-checkout', () => {
      throw new Error('blocked');
    });
    expect(await (await load()).openOverlayCheckout(TEST_URL, vi.fn())).toBe(false);
    vi.doMock('dodopayments-checkout', () => ({ DodoPayments: { Initialize: vi.fn(), Checkout: {} } }));
    expect(await (await load()).openOverlayCheckout(TEST_URL, vi.fn())).toBe(false);
    vi.doMock('dodopayments-checkout', () => ({ DodoPayments: sdk }));
  });

  it('closing counts as an abandonment; an error or an expired link closes it and says why', async () => {
    const { openOverlayCheckout, track } = await load();
    const onClose = vi.fn();
    await openOverlayCheckout(TEST_URL, onClose);
    onEvent()({ event_type: 'checkout.opened' });
    onEvent()({ event_type: 'checkout.closed' });
    expect(onClose).toHaveBeenLastCalledWith('closed');
    expect(track).toHaveBeenCalledWith('web_funnel_checkout_abandoned');

    await openOverlayCheckout(TEST_URL, onClose);
    onEvent()({ event_type: 'checkout.error' });
    expect(onClose).toHaveBeenLastCalledWith('error');
    onEvent()({ event_type: 'checkout.closed' }); // the close after an error is not an abandonment
    expect(track.mock.calls.filter(([e]) => e === 'web_funnel_checkout_abandoned')).toHaveLength(1);

    await openOverlayCheckout(TEST_URL, onClose);
    onEvent()({ event_type: 'checkout.link_expired' });
    expect(onClose).toHaveBeenLastCalledWith('expired');
  });

  it('follows a redirect only to our own origin', async () => {
    const { openOverlayCheckout } = await load();
    await openOverlayCheckout(TEST_URL, vi.fn());
    onEvent()({ event_type: 'checkout.redirect', data: { message: { redirect_to: 'https://evil.example/welcome' } } });
    onEvent()({ event_type: 'checkout.redirect', data: { message: { redirect_to: 'https://kinderwell.app/welcome?status=active' } } });
    vi.advanceTimersByTime(1500);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('https://kinderwell.app/welcome?status=active');
  });

  it('an overlay that never says anything is taken down and the buyer sent to the hosted page (FE-3)', async () => {
    const { openOverlayCheckout, OVERLAY_WATCHDOG_MS, track } = await load();
    await openOverlayCheckout(TEST_URL, vi.fn());
    vi.advanceTimersByTime(OVERLAY_WATCHDOG_MS - 1);
    expect(assign).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(assign).toHaveBeenCalledWith(TEST_URL);
    expect(sdk.Checkout.close).toHaveBeenCalledWith(false);
    expect(track).toHaveBeenCalledWith('web_funnel_error', { where: 'checkout_overlay_silent' });
  });

  it('an overlay that has spoken is never second-guessed by the watchdog', async () => {
    const { openOverlayCheckout, OVERLAY_WATCHDOG_MS } = await load();
    await openOverlayCheckout(TEST_URL, vi.fn());
    onEvent()({ event_type: 'checkout.resize' });
    await vi.advanceTimersByTimeAsync(OVERLAY_WATCHDOG_MS * 2);
    expect(assign).not.toHaveBeenCalled();
  });
});
