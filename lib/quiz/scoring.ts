// Answers → the personalized beats: recap chips (VBReady), the calculating
// theater's stage lines (VBCalculating), and the snapshot card stack
// (VBSnapshot). Copy and key names ported from the app's variantBContent.ts
// and VBSnapshotScreen — continuity between funnel promise and app reality
// is what keeps refunds down.

import type { Answers } from '../session';

const CHALLENGE_SHORT: Record<string, string> = {
  tantrums: 'tantrums',
  listening: 'listening',
  screens: 'screen time',
  sleep: 'bedtime',
  defiance: 'power struggles',
  anxiety: 'big worries',
  siblings: 'sibling fights',
  bond: 'reconnecting',
};

const GOAL_SHORT: Record<string, string> = {
  calm_mornings: 'calmer mornings',
  fewer_meltdowns: 'fewer meltdowns',
  closer_bond: 'a closer bond',
  more_patience: 'more patience',
  confidence: 'confidence',
  consistency: 'a united front',
};

const MOOD_SHORT: Record<string, string> = {
  calm: 'mostly calm days',
  manageable: 'rough patches',
  stretched: 'stretched thin',
  chaotic: 'chaotic days',
  overwhelmed: 'underwater days',
};

// What the plan promises must be what the app delivers (review 2026-10-07,
// B-12). The app's Learn path (mamalearn src/lessons/units.ts LESSON_ORDER)
// is one fixed sequence of 13 lessons, starting with four "Foundations"
// lessons, with no week structure. This used to promise "12 lessons,
// starting with 'Calm in the Meltdown'" (or one of seven other named first
// lessons, picked by the parent's top challenge), copied from the unshipped
// variant-B onboarding: no lesson by any of those names exists in the app.
// Change this with LESSON_ORDER, and with the offer page's "What you get".
export const APP_LESSON_COUNT = 13;

const AGE_LABEL: Record<string, string> = {
  '0-1': 'under 2',
  '2-4': '2–4',
  '5-7': '5–7',
  '8-12': '8–12',
  '13-17': '13–17',
};

function challenges(answers: Answers): string[] {
  return (answers['challenges'] as string[] | undefined) ?? [];
}
function goals(answers: Answers): string[] {
  return (answers['goals'] as string[] | undefined) ?? [];
}

export function familySummary(answers: Answers): string {
  const count = String(answers['children-count'] ?? '1');
  const age = AGE_LABEL[String(answers['child-age'] ?? '')] ?? null;
  const kids = count === '1' ? 'One kid' : count === '2' ? 'Two kids' : 'Three or more kids';
  return age ? `${kids}, focused on ages ${age}` : kids;
}

/** The VBReady beat's recap chips — the user's own words handed back. */
export function recapChips(answers: Answers): string[] {
  const chips: string[] = [];
  const mood = MOOD_SHORT[String(answers['mood'] ?? '')];
  if (mood) chips.push(mood);
  for (const c of challenges(answers).slice(0, 3)) {
    if (CHALLENGE_SHORT[c]) chips.push(CHALLENGE_SHORT[c]);
  }
  for (const g of goals(answers).slice(0, 2)) {
    if (GOAL_SHORT[g]) chips.push(GOAL_SHORT[g]);
  }
  chips.push(familySummary(answers).toLowerCase());
  return chips;
}

/** VBCalculating's personalized stage lines (ported shape: at% + label). */
export function calculatingStages(answers: Answers): { at: number; label: string }[] {
  const focus = CHALLENGE_SHORT[challenges(answers)[0]] ?? 'your hardest moments';
  const goal = GOAL_SHORT[goals(answers)[0]] ?? 'calmer days';
  return [
    { at: 22, label: 'Reading your answers' },
    { at: 46, label: `Focusing on ${focus}` },
    { at: 68, label: `Tuning for your family` },
    { at: 88, label: `Building toward ${goal}` },
    { at: 100, label: 'Finalizing your plan' },
  ];
}

export interface SnapshotRow {
  label: string;
  value: string;
  icon: string;
  accent?: boolean;
}

/** The VBSnapshot card stack: icon stat-cards with one accent hero row. */
export function snapshotRows(answers: Answers): SnapshotRow[] {
  const cs = challenges(answers);
  const gs = goals(answers);
  const focusList = cs.slice(0, 2).map((c) => CHALLENGE_SHORT[c] ?? c);
  const goalList = gs.slice(0, 2).map((g) => GOAL_SHORT[g] ?? g);

  return [
    { label: 'Your family', value: familySummary(answers), icon: 'users' },
    {
      label: 'What we’ll focus on',
      value: focusList.length ? sentence(focusList) : 'Your hardest moments',
      icon: 'crosshair',
    },
    {
      label: 'Where this is headed',
      value: goalList.length ? sentence(goalList) : 'Calmer days',
      icon: 'leaf',
    },
    {
      label: 'Your plan',
      value: `${APP_LESSON_COUNT} lessons, starting with the foundations`,
      icon: 'book-open',
      accent: true,
    },
    { label: 'First results in', value: 'About two weeks', icon: 'clock' },
  ];
}

/** The offer page's personalization echo — their goal, focus, and child age. */
export function offerEcho(answers: Answers): { goal: string; focus: string; age: string } {
  return {
    goal: GOAL_SHORT[goals(answers)[0]] ?? 'calmer days',
    focus: CHALLENGE_SHORT[challenges(answers)[0]] ?? 'the hard moments',
    age: AGE_LABEL[String(answers['child-age'] ?? '')] ?? 'your child',
  };
}

function sentence(items: string[]): string {
  const caps = items.map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s));
  return caps.join(' and ');
}
