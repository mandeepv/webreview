// Answers → plan copy (P5). A new quiz option with no copy would show a raw
// slug ("whining") or a generic fallback on the plan and offer pages.
import { describe, expect, it } from 'vitest';
import { QUIZ_STEPS, stepIndexById } from './questions';
import { calculatingStages, familySummary, offerEcho, recapChips, snapshotRows } from './scoring';
import type { Answers } from '../session';

const optionValues = (id: string) => QUIZ_STEPS[stepIndexById(id)].options!.map((o) => o.value);

describe('plan copy covers every quiz option', () => {
  it.each(optionValues('challenges'))('challenge "%s" has a short label and a first lesson', (c) => {
    expect(recapChips({ challenges: [c] })).toHaveLength(2); // the label + the family line
    const plan = snapshotRows({ challenges: [c] }).find((r) => r.label === 'Your plan')!;
    expect(plan.value).not.toContain('Your First Win');
  });

  it.each(optionValues('goals'))('goal "%s" has a short label', (g) => {
    expect(recapChips({ goals: [g] })).toHaveLength(2);
    expect(offerEcho({ goals: [g] }).goal).not.toBe('calmer days');
  });

  it.each(optionValues('mood'))('mood "%s" has a short label', (m) => {
    expect(recapChips({ mood: m })).toHaveLength(2);
  });

  it.each(optionValues('child-age'))('age band "%s" has a label', (a) => {
    expect(familySummary({ 'child-age': a })).toContain('focused on ages');
    expect(offerEcho({ 'child-age': a }).age).not.toBe('your child');
  });
});

describe('plan copy never prints a missing value', () => {
  const every = (id: string) => optionValues(id);
  const samples: Answers[] = [
    {},
    { name: 'Sam' },
    {
      'children-count': '3+',
      'child-age': '13-17',
      mood: 'overwhelmed',
      challenges: every('challenges'),
      goals: every('goals'),
    },
    { challenges: ['not-an-option'], goals: ['nope'], mood: 'nope', 'child-age': 'nope' },
  ];

  it.each(samples)('answers %j', (answers) => {
    const text = JSON.stringify([
      recapChips(answers),
      calculatingStages(answers),
      snapshotRows(answers),
      offerEcho(answers),
      familySummary(answers),
    ]);
    expect(text).not.toMatch(/undefined|null|NaN|\[object/);
  });

  it('the recap keeps to three challenges and two goals', () => {
    const chips = recapChips({ challenges: every('challenges'), goals: every('goals') });
    expect(chips).toHaveLength(3 + 2 + 1);
  });
});
