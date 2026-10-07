import { beforeEach, describe, expect, it } from 'vitest';
import { captureAttribution, getSession, readMetaCookies, resetSession, restartSession, save, setAnswer, uuid } from './session';
import { RESUME_COOKIE } from './resume-cookie';

function clearCookies() {
  for (const c of document.cookie.split('; ')) {
    const name = c.split('=')[0];
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

beforeEach(() => {
  localStorage.clear();
  clearCookies();
  resetSession();
});

describe('captureAttribution', () => {
  it('a new fbclid replaces the stored click', () => {
    captureAttribution(new URLSearchParams('fbclid=OLD&utm_source=fb'));
    captureAttribution(new URLSearchParams('fbclid=NEW'));
    expect(getSession().utm).toEqual({ fbclid: 'NEW' });
  });
  it('a later visit tagged only with ?a= keeps the stored fbclid (P3-22)', () => {
    captureAttribution(new URLSearchParams('fbclid=CLICK1'));
    captureAttribution(new URLSearchParams('a=yelling'));
    const s = getSession();
    expect(s.utm).toEqual({ a: 'yelling', fbclid: 'CLICK1' });
    expect(s.landingVariant).toBe('yelling');
  });
  it('…and keeps the ad click’s utm_* too: an ?a=-only visit is not a new click (P3)', () => {
    captureAttribution(new URLSearchParams('utm_source=fb&utm_campaign=c1&fbclid=CLICK1'));
    captureAttribution(new URLSearchParams('a=listening'));
    expect(getSession().utm).toEqual({ utm_source: 'fb', utm_campaign: 'c1', fbclid: 'CLICK1', a: 'listening' });
  });
  it('a new tagged click still replaces the utm_* (latest click)', () => {
    captureAttribution(new URLSearchParams('utm_source=fb&utm_campaign=c1'));
    captureAttribution(new URLSearchParams('utm_source=ig&utm_campaign=c2'));
    expect(getSession().utm).toEqual({ utm_source: 'ig', utm_campaign: 'c2' });
  });
  it('an untagged visit changes nothing', () => {
    captureAttribution(new URLSearchParams('fbclid=CLICK1'));
    captureAttribution(new URLSearchParams(''));
    expect(getSession().utm).toEqual({ fbclid: 'CLICK1' });
  });
});

describe('readMetaCookies', () => {
  it('prefers the pixel cookies', () => {
    document.cookie = '_fbp=fb.1.1.123';
    document.cookie = '_fbc=fb.1.2.abc';
    expect(readMetaCookies()).toEqual({ fbp: 'fb.1.1.123', fbc: 'fb.1.2.abc' });
  });
  it('rebuilds fbc from the stored fbclid in Meta’s format', () => {
    captureAttribution(new URLSearchParams('fbclid=XYZ'));
    const at = getSession().fbclidAt;
    expect(readMetaCookies()).toEqual({ fbc: `fb.1.${at}.XYZ` });
  });
});

describe('session fallback (P2-8)', () => {
  it('returns the same session id on every read', () => {
    expect(getSession().id).toBe(getSession().id);
  });
});

describe('resume cookie hand-off (P1-6)', () => {
  it('replaces the local session with the resumed one, once', () => {
    const local = getSession();
    const payload = {
      sessionId: '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b',
      userId: 'user-1',
      email: 'zoë@example.com',
      answers: { name: 'Zoë', goals: ['calm'] },
      utm: { fbclid: 'F' },
      landingVariant: 'tantrums',
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    document.cookie = `${RESUME_COOKIE}=${encoded}; path=/`;

    const s = getSession();
    expect(s.id).toBe(payload.sessionId);
    expect(s.id).not.toBe(local.id);
    expect(s).toMatchObject({ emailCaptured: true, userId: 'user-1', email: 'zoë@example.com', landingVariant: 'tantrums' });
    expect(s.answers).toEqual(payload.answers);
    expect(document.cookie).not.toContain(RESUME_COOKIE);
    expect(getSession().id).toBe(payload.sessionId); // persisted, not re-consumed
  });
  it('ignores a malformed cookie', () => {
    const local = getSession();
    document.cookie = `${RESUME_COOKIE}=not-base64!!; path=/`;
    expect(getSession().id).toBe(local.id);
  });
});

describe('restartSession (B-3: capture-email answers 409 for a session owned by another email)', () => {
  it('keeps the answers and attribution under a new id, without the old email', () => {
    captureAttribution(new URLSearchParams('fbclid=CLICK1&a=yelling'));
    setAnswer('role', 'mother');
    const old = getSession();
    old.emailCaptured = true;
    old.email = 'typo@example.con';
    old.userId = 'u-1';
    save(old);

    const s = restartSession();
    expect(s.id).not.toBe(old.id);
    expect(s.answers).toEqual({ role: 'mother' });
    expect(s.utm).toEqual({ fbclid: 'CLICK1', a: 'yelling' });
    expect(s.landingVariant).toBe('yelling');
    expect(s.fbclidAt).toBe(old.fbclidAt);
    expect([s.emailCaptured, s.email, s.userId]).toEqual([false, null, null]);
    expect(getSession().id).toBe(s.id); // stored
  });
});

describe('stored session (P3)', () => {
  it('a corrupt or foreign shape is replaced by a fresh session, not trusted', () => {
    for (const raw of ['{"id":"not-a-uuid","answers":{},"utm":{}}', '{"id":"0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b"}', '[]', '{"v":2,"id":"0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b","answers":{},"utm":{}}']) {
      resetSession();
      localStorage.setItem('kw_funnel_session', raw);
      const s = getSession();
      expect(s.id, raw).not.toBe('0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b');
      expect(s.answers).toEqual({});
    }
  });
  it('a session saved before versioning is still read', () => {
    resetSession();
    localStorage.setItem('kw_funnel_session', JSON.stringify({
      id: '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b', answers: { role: 'mother' }, utm: {}, landingVariant: 'default',
      emailCaptured: true, userId: 'u-1', email: 'a@example.com', startedAt: 1,
    }));
    const s = getSession();
    expect([s.id, s.answers.role, s.email, s.v]).toEqual(['0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b', 'mother', 'a@example.com', 1]);
  });
  it('uuid() makes v4 UUIDs even where crypto.randomUUID is missing (iOS before 15.4)', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const ids = new Set(Array.from({ length: 50 }, uuid));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});
