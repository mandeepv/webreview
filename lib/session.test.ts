import { beforeEach, describe, expect, it } from 'vitest';
import { captureAttribution, getSession, readMetaCookies, resetSession } from './session';
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
