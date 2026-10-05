import { describe, expect, it } from 'vitest';
import { isInAppBrowser, paymentStateFrom } from './browser';
import { stripEmailParams } from './analytics';
import { EMAIL_POSITION, JOURNEY_LENGTH, journeyPositionForStep, ACT3_START, TOTAL_STEPS } from './quiz/questions';

describe('paymentStateFrom', () => {
  it('only active|succeeded is confirmed (fires the Purchase pixel)', () => {
    expect(paymentStateFrom('active')).toBe('confirmed');
    expect(paymentStateFrom('succeeded')).toBe('confirmed');
  });
  it('pending-type statuses are processing', () => {
    for (const s of ['pending', 'processing', 'requires_customer_action']) expect(paymentStateFrom(s)).toBe('processing');
  });
  it('a direct visit is unknown, anything else failed', () => {
    expect(paymentStateFrom(null)).toBe('unknown');
    expect(paymentStateFrom('failed')).toBe('failed');
    expect(paymentStateFrom('cancelled')).toBe('failed');
  });
});

describe('isInAppBrowser', () => {
  it('detects Instagram and Facebook iOS browsers', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Instagram 350.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/480.0]')).toBe(true);
  });
  it('leaves Safari alone', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});

describe('stripEmailParams (P1-9b)', () => {
  it('drops email and any @-valued param, keeps the rest', () => {
    const out = stripEmailParams('https://kinderwell.app/welcome?status=active&email=jane%40x.com&subscription_id=sub_1&who=a@b.co');
    expect(out).toBe('https://kinderwell.app/welcome?status=active&subscription_id=sub_1');
  });
  it('returns non-URLs and clean URLs untouched', () => {
    expect(stripEmailParams('not a url')).toBe('not a url');
    expect(stripEmailParams('https://kinderwell.app/start?a=yelling')).toBe('https://kinderwell.app/start?a=yelling');
  });
});

describe('journey progress (P2-7)', () => {
  it('never goes backwards across email → build → plan → Act 3 → offer', () => {
    const positions = [
      ...Array.from({ length: ACT3_START - 1 }, (_, i) => journeyPositionForStep(i + 1)),
      EMAIL_POSITION,
      EMAIL_POSITION + 1, // building
      EMAIL_POSITION + 2, // plan
      ...Array.from({ length: TOTAL_STEPS - ACT3_START + 1 }, (_, i) => journeyPositionForStep(ACT3_START + i)),
      JOURNEY_LENGTH, // offer
    ];
    for (let i = 1; i < positions.length; i++) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    expect(positions.at(-1)).toBe(JOURNEY_LENGTH);
  });
});
