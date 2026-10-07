// The "copy a link for Safari" note inside Instagram / Facebook (review
// 2026-10-07, B-6): the copy must start inside the tap, and when WebKit
// refuses it anyway the page must say "press and hold", never "couldn't
// make the link" above a link it did make.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('@/lib/session', () => ({
  getSession: () => ({ id: 'session-1', email: 'parent@example.com' }),
}));

import { PayMethodsLine } from './in-app-note';

const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const TOKEN = 'r2.TOKEN';
const LINK = `${window.location.origin}/r/${encodeURIComponent(TOKEN)}?to=offer`;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}
function setClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  setUserAgent(IPHONE_INSTAGRAM);
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: TOKEN }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** Renders, lets the up-front mint land, taps the button, lets the copy settle. */
async function renderAndTap() {
  await act(async () => {
    render(<PayMethodsLine />);
  });
  await act(async () => {
    fireEvent.click(screen.getByText('Prefer Apple Pay? Copy a link for Safari'));
  });
}

describe('PayMethodsLine in an in-app browser', () => {
  it('mints the link when it appears, with the session id AND its email', async () => {
    await act(async () => {
      render(<PayMethodsLine />);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: 'mint',
      sessionId: 'session-1',
      email: 'parent@example.com',
    });
  });

  it('the tap copies the ready link synchronously and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    await renderAndTap();
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing fetched inside the tap
    expect(screen.getByText(/Link copied/)).toBeTruthy();
  });

  it('when WebKit refuses the copy, it shows the link with "press and hold", not a failure', async () => {
    setClipboard(() => Promise.reject(new DOMException('NotAllowedError')));
    await renderAndTap();
    expect(screen.getByText(/Press and hold the link below/)).toBeTruthy();
    expect(screen.getByText(LINK)).toBeTruthy();
    expect(screen.queryByText(/Couldn’t make the link/)).toBeNull();
  });

  it('when the link cannot be made, it says so and shows no link', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'session_not_found' }), { status: 404 }));
    setClipboard(() => Promise.reject(new Error('no link')));
    await renderAndTap();
    expect(screen.getByText(/Couldn’t make the link/)).toBeTruthy();
    expect(screen.queryByText(/\/r\//)).toBeNull();
  });
});

describe('PayMethodsLine in Safari', () => {
  it('names the payment methods and mints nothing', async () => {
    setUserAgent(IPHONE_SAFARI);
    await act(async () => {
      render(<PayMethodsLine />);
    });
    expect(screen.getByText(/Pay with Apple Pay, Google Pay, or card/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
