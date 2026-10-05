// The quiz is data (lib/quiz/questions.ts); these checks stop a copy edit from
// breaking the flow (P4).
import { describe, expect, it } from 'vitest';
import { QUIZ_STEPS, stepIndexById } from './questions';

describe('quiz data', () => {
  it('every step id is unique', () => {
    const ids = QUIZ_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every choice step has at least two options with unique values and labels', () => {
    for (const step of QUIZ_STEPS.filter((s) => s.type === 'single' || s.type === 'multi')) {
      const options = step.options ?? [];
      expect(options.length, step.id).toBeGreaterThanOrEqual(2);
      expect(new Set(options.map((o) => o.value)).size, step.id).toBe(options.length);
      expect(new Set(options.map((o) => o.label)).size, step.id).toBe(options.length);
      expect(step.question, step.id).toBeTruthy();
    }
  });

  it('statement steps have a headline and a button', () => {
    for (const step of QUIZ_STEPS.filter((s) => s.type === 'statement')) {
      expect(step.headline, step.id).toBeTruthy();
      expect(step.cta, step.id).toBeTruthy();
    }
  });

  it('answer ids stay within the shape capture-email stores (lowercase, digits, dashes, ≤ 40)', () => {
    for (const step of QUIZ_STEPS) expect(step.id, step.id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it('exactly one step hands off to /email, before the one that ends at /offer', () => {
    const toEmail = QUIZ_STEPS.filter((s) => s.next === 'email');
    const toOffer = QUIZ_STEPS.filter((s) => s.next === 'offer');
    expect(toEmail).toHaveLength(1);
    expect(toOffer).toHaveLength(1);
    expect(stepIndexById(toEmail[0].id)).toBeLessThan(stepIndexById(toOffer[0].id));
    expect(QUIZ_STEPS.at(-1)!.next).toBe('offer');
  });

  it('the questions the app profile and the plan copy depend on still exist with their app values', () => {
    // The webhook maps these to the app's user_profiles (03-app-changes §5):
    // values must match the app's enums exactly.
    const values = (id: string) => QUIZ_STEPS[stepIndexById(id)]?.options?.map((o) => o.value);
    expect(values('role')).toEqual(['mother', 'father', 'other']);
    expect(values('children-count')).toEqual(['1', '2', '3+']);
    expect(values('child-age')).toEqual(['0-1', '2-4', '5-7', '8-12', '13-17']);
    expect(values('experience')).toEqual(['new-to-science', 'somewhat-familiar', 'know-a-lot']);
  });

  it('the iPhone question turns Android users away to the waitlist', () => {
    const phone = QUIZ_STEPS[stepIndexById('phone')];
    expect(phone.options?.find((o) => o.value === 'android')?.disqualifies).toBe('android');
    expect(phone.options?.find((o) => o.value === 'iphone')?.disqualifies).toBeUndefined();
  });

  // Review P3-23: /waitlist has copy for reason=age, but no answer routes there
  // — no age is turned away, although the README says out-of-range ages are.
  // Owner decision pending: gate 0–1 / 13–17, or delete the branch and claim.
  it.todo('every /waitlist reason is reachable from some answer (P3-23 — owner decision pending)');
});
