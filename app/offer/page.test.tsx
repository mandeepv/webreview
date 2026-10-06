// The offer page's checkout button: every failure must leave the buyer with a
// working button and a message they understand (P6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/meta', () => ({ pixel: vi.fn() }));
vi.mock('@/lib/checkout', () => ({
  preloadCheckout: vi.fn(),
  openOverlayCheckout: vi.fn(),
  closeOverlayCheckout: vi.fn(),
}));
const session = { id: 'session-1', emailCaptured: true, answers: { name: 'Sam', goals: ['closer_bond'] } };
vi.mock('@/lib/session', () => ({
  getSession: () => session,
  readMetaCookies: () => ({ fbp: 'fb.1.1.111' }),
  save: vi.fn(),
}));

import OfferPage from './page';
import { closeOverlayCheckout, openOverlayCheckout } from '@/lib/checkout';
import { pixel } from '@/lib/meta';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  session.emailCaptured = true;
  setUserAgent(IPHONE_SAFARI);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(openOverlayCheckout).mockResolvedValue(true);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: object) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const getPlanButton = () => screen.getAllByRole('button', { name: 'Get my plan' })[0];
async function tapGetMyPlan() {
  render(<OfferPage />);
  await act(async () => {
    fireEvent.click(getPlanButton());
  });
}

describe('/offer', () => {
  it('someone who never reached the offer through the quiz is sent to the start', () => {
    session.emailCaptured = false;
    render(<OfferPage />);
    expect(replace).toHaveBeenCalledWith('/start');
  });

  it('opens Dodo with the session, the displayed price and the Meta cookies', async () => {
    reply(200, { checkoutUrl: 'https://test.checkout.dodopayments.com/session/cks_1', eventId: 'evt_1' });
    await tapGetMyPlan();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/create-checkout');
    expect(body).toEqual({
      sessionId: 'session-1',
      plan: 'annual',
      displayedPrice: 59.99,
      meta: { fbp: 'fb.1.1.111' },
      handoffNonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    await waitFor(() =>
      expect(openOverlayCheckout).toHaveBeenCalledWith('https://test.checkout.dodopayments.com/session/cks_1', expect.any(Function))
    );
    // /welcome fires the browser Purchase with the same event id the webhook sends to Meta.
    expect(localStorage.getItem('kw_purchase_event_id')).toBe('evt_1');
    expect(pixel).toHaveBeenCalledWith('InitiateCheckout', { value: 59.99, currency: 'USD' }, 'ic-evt_1');
  });

  it('every checkout tap sends the same handoff nonce, which /welcome can present later (SPEC-21)', async () => {
    reply(200, { checkoutUrl: 'https://x', eventId: 'e' });
    await tapGetMyPlan();
    cleanup();
    await tapGetMyPlan();
    const [first, second] = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).handoffNonce);
    expect(second).toBe(first);
    expect(JSON.parse(localStorage.getItem('kw_handoff')!)).toEqual({ sessionId: 'session-1', nonce: first });
  });

  it('the monthly plan sends the monthly price', async () => {
    reply(200, { checkoutUrl: 'https://x', eventId: 'e' });
    render(<OfferPage />);
    fireEvent.click(screen.getByRole('radio', { name: /monthly/i }));
    await act(async () => {
      fireEvent.click(getPlanButton());
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.plan).toBe('monthly');
    expect(body.displayedPrice).toBe(12.99);
  });

  it('an existing subscriber is told not to pay again', async () => {
    reply(409, { error: 'already_subscribed' });
    await tapGetMyPlan();
    expect(await screen.findByText(/already has an active Kinderwell subscription/)).toBeTruthy();
    expect((getPlanButton() as HTMLButtonElement).disabled).toBe(false);
    expect(openOverlayCheckout).not.toHaveBeenCalled();
    expect(pixel).not.toHaveBeenCalledWith('InitiateCheckout', expect.anything());
  });

  it('a price mismatch says pricing is being updated', async () => {
    reply(409, { error: 'price_mismatch' });
    await tapGetMyPlan();
    expect(await screen.findByText(/pricing is being updated/)).toBeTruthy();
    expect((getPlanButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a rate limit asks them to wait a minute', async () => {
    reply(429, { error: 'rate_limited' });
    await tapGetMyPlan();
    expect(await screen.findByText(/wait a minute/)).toBeTruthy();
    expect((getPlanButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a timeout or server error leaves a working button and a retry message', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await tapGetMyPlan();
    expect(await screen.findByText(/Couldn’t open checkout/)).toBeTruthy();
    expect((getPlanButton() as HTMLButtonElement).disabled).toBe(false);

    cleanup();
    reply(502, { error: 'checkout_failed' });
    await tapGetMyPlan();
    expect(await screen.findByText(/Couldn’t open checkout/)).toBeTruthy();
  });

  it('an expired checkout session resets the button with a message', async () => {
    reply(200, { checkoutUrl: 'https://x', eventId: 'e' });
    let onClose: (reason: 'closed' | 'error' | 'expired') => void = () => {};
    vi.mocked(openOverlayCheckout).mockImplementation(async (_url, cb) => {
      onClose = cb;
      return true;
    });
    await tapGetMyPlan();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Opening secure checkout/ }).length).toBeGreaterThan(0));
    act(() => onClose('expired'));
    expect(await screen.findByText(/checkout expired/)).toBeTruthy();
    expect((getPlanButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('coming back from the back-forward cache closes the overlay and re-enables the button (P1-10b)', async () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // checkout request still in flight
    await tapGetMyPlan();
    expect(screen.getAllByRole('button', { name: /Opening secure checkout/ }).length).toBeGreaterThan(0);

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });
    expect(closeOverlayCheckout).toHaveBeenCalled();
    expect((getPlanButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('in Safari it promises Apple Pay; inside Instagram it says card works here and offers a Safari link', async () => {
    render(<OfferPage />);
    expect(await screen.findAllByText(/Pay with Apple Pay, Google Pay, or card/)).toBeTruthy();
    cleanup();

    setUserAgent(IPHONE_INSTAGRAM);
    render(<OfferPage />);
    expect((await screen.findAllByText(/Apple Pay only works in Safari/)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Copy a link for Safari/ }).length).toBeGreaterThan(0);
  });
});
