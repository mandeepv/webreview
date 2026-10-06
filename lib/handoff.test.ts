import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchHandoffLink,
  HANDOFF_LINK_RE,
  nonceForCheckout,
  readProof,
  RETRY_DELAYS_MS,
  startCopy,
  withTimeout,
} from './handoff';
import { resetSession } from './session';

const SESSION = '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b';
const LINK = `https://open.kinderwell.app/k/${'K'.repeat(43)}`;

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('nonceForCheckout / readProof', () => {
  it('makes one 43-character nonce per funnel session and keeps it for /welcome', () => {
    const nonce = nonceForCheckout(SESSION);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonceForCheckout(SESSION)).toBe(nonce); // a second tap sends the same one
    expect(readProof()).toEqual({ sessionId: SESSION, nonce });
  });

  it('a new funnel session gets a new nonce', () => {
    const first = nonceForCheckout(SESSION);
    const second = nonceForCheckout('11111111-2222-4333-8444-555555555555');
    expect(second).not.toBe(first);
    expect(readProof()?.sessionId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('survives the funnel-session reset /welcome does after a confirmed payment', () => {
    const nonce = nonceForCheckout(SESSION);
    resetSession();
    expect(readProof()).toEqual({ sessionId: SESSION, nonce });
  });

  it('with storage blocked, sends no nonce (the page could not present it later)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(nonceForCheckout(SESSION)).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('ignores a corrupt or tampered stored proof', () => {
    for (const raw of ['{nope', '{"sessionId":"s"}', '{"sessionId":"s","nonce":"short"}']) {
      localStorage.setItem('kw_handoff', raw);
      expect(readProof(), raw).toBeNull();
    }
  });
});

describe('fetchHandoffLink', () => {
  const proof = { sessionId: SESSION, nonce: 'n'.repeat(43) };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const noSleep = vi.fn(async () => {});

  beforeEach(() => noSleep.mockClear());

  it('returns the link and sends only the session id and nonce', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(200, { link: LINK }));
    expect(await fetchHandoffLink(proof, { fetchImpl, sleep: noSleep })).toEqual({ link: LINK });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/mint-handoff');
    expect(JSON.parse(init.body)).toEqual(proof);
    expect(init.cache).toBe('no-store');
  });

  it('retries "not yet" and server errors until the webhook has landed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply(409, { error: 'not_ready' }))
      .mockResolvedValueOnce(reply(500, { error: 'error' }))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(reply(200, { link: LINK }));
    expect(await fetchHandoffLink(proof, { fetchImpl, sleep: noSleep })).toEqual({ link: LINK });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(noSleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual(RETRY_DELAYS_MS.slice(0, 3));
  });

  it('gives up after about a minute of "not yet", with the last reason', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => reply(409, { error: 'not_ready' }));
    expect(await fetchHandoffLink(proof, { fetchImpl, sleep: noSleep })).toEqual({ error: 'not_ready' });
    expect(fetchImpl).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    const total = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(50_000);
    expect(total).toBeLessThanOrEqual(70_000);
  });

  it('stops at once on a final refusal', async () => {
    for (const [status, error] of [[404, 'not_found'], [403, 'not_entitled'], [410, 'expired'], [429, 'rate_limited'], [400, 'bad_request']] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(reply(status, { error }));
      expect(await fetchHandoffLink(proof, { fetchImpl, sleep: noSleep })).toEqual({ error });
      expect(fetchImpl, error).toHaveBeenCalledTimes(1);
    }
  });

  it('never hands back something that is not our sign-in link', async () => {
    for (const link of ['https://evil.example/k/' + 'K'.repeat(43), `${LINK}x`, 'kinderwell://k/' + 'K'.repeat(43), 42]) {
      const fetchImpl = vi.fn().mockResolvedValue(reply(200, { link }));
      expect(await fetchHandoffLink(proof, { fetchImpl, sleep: noSleep }), String(link)).toEqual({ error: 'bad_link' });
    }
  });
});

describe('startCopy', () => {
  // jsdom's Blob has no .text().
  const blobText = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  function fakeClipboard(o: { failWrite?: boolean } = {}) {
    const written: string[] = [];
    const clipboard = {
      writeText: vi.fn(async (t: string) => {
        if (o.failWrite) throw new DOMException('denied', 'NotAllowedError');
        written.push(t);
      }),
      write: vi.fn(async (items: Array<{ getType: (t: string) => Promise<Blob> }>) => {
        written.push(await blobText(await items[0].getType('text/plain')));
      }),
    } as unknown as Clipboard;
    return { clipboard, written };
  }

  class FakeClipboardItem {
    constructor(private readonly items: Record<string, Promise<Blob>>) {}
    getType(type: string) {
      return this.items[type];
    }
  }

  it('writes a ready link inside the tap, before anything is awaited', async () => {
    const { clipboard, written } = fakeClipboard();
    const copied = startCopy(LINK, clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith(LINK); // synchronously
    expect(await copied).toBe(true);
    expect(written).toEqual([LINK]);
  });

  it('starts the write inside the tap even while the link is still on its way', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const { clipboard, written } = fakeClipboard();
    let deliver!: (l: string) => void;
    const copied = startCopy(new Promise<string | null>((r) => (deliver = r)), clipboard);
    expect(clipboard.write).toHaveBeenCalledTimes(1); // synchronously, before the link exists
    deliver(LINK);
    expect(await copied).toBe(true);
    expect(written).toEqual([LINK]);
  });

  it('reports false, never throws, when the link never comes or the clipboard refuses', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    expect(await startCopy(Promise.resolve(null), fakeClipboard().clipboard)).toBe(false);
    expect(await startCopy(LINK, fakeClipboard({ failWrite: true }).clipboard)).toBe(false);
    expect(await startCopy(LINK, undefined)).toBe(false);
    vi.unstubAllGlobals();
    // A browser without ClipboardItem can't copy a link that isn't here yet.
    expect(await startCopy(Promise.resolve(LINK), fakeClipboard().clipboard)).toBe(false);
  });
});

describe('withTimeout', () => {
  it('returns the value, or the fallback once time is up or on failure', async () => {
    expect(await withTimeout(Promise.resolve(true), 50, false)).toBe(true);
    expect(await withTimeout(new Promise<boolean>(() => {}), 10, false)).toBe(false);
    expect(await withTimeout(Promise.reject(new Error('x')), 50, false)).toBe(false);
  });
});

describe('HANDOFF_LINK_RE', () => {
  it('matches exactly the server’s universal link', () => {
    expect(HANDOFF_LINK_RE.test(LINK)).toBe(true);
    expect(HANDOFF_LINK_RE.test(LINK.replace('open.', ''))).toBe(false);
    expect(HANDOFF_LINK_RE.test(LINK.slice(0, -1))).toBe(false);
  });
});
