// The quiz as data — copy edits are data edits, no new components per screen.
//
// FLOW + COPY SOURCE: the app's variant-B onboarding
// (`feature/variant-b-onboarding-redesign` — variantBContent.ts + VB screens;
// code is the source of truth per docs/specs/variant-b-onboarding-copy.md).
// 3-act story: Hook → Diagnose/Reflect → Commit. Web adaptations, agreed
// 2026-09-19: Rating + Reminders (app-only beats) dropped; iPhone qualifier
// added early in Act 1; email capture sits at the VBReady beat (step marked
// next:'email'), then /building (VBCalculating) → /plan (VBSnapshot) → Act 3
// resumes at step 14 → offer.
//
// Option VALUES mirror variantBContent.ts keys exactly, so web + app
// segmentation line up when analyzed together.
//
// ⚠︎ STATS: the Mirror beat's "83% of parents" is variant B's
// placeholder-but-hard-hitting number, kept at the owner's decision — it MUST
// be confirmed defensible before ads run (MANUAL_STEPS.md §8).
//
// Visual system: the cream/forest onboarding design system from the app's
// design/onboarding-lesson-revamp branch (OnboardingColors et al. in
// theme.ts). Option rows carry NO icons — single/multi is shown by the
// indicator shape (circle vs rounded square). The `icon` field below is
// retained data (mirrors variantBContent.ts) but is not rendered on web.
// Headlines mark ONE italic phrase with *stars* — RichHeadline renders it.

export type StepType = 'single' | 'multi' | 'statement' | 'name';

/** Body text with variant B's HighlightText treatment: hl segments render in brand color. */
export type RichText = (string | { text: string; hl: true })[];

export interface QuizOption {
  value: string;
  label: string;
  icon: string;
  /** Routes to /waitlist instead of the next step. */
  disqualifies?: 'android' | 'age';
}

export interface QuizStepDef {
  id: string;
  act: 1 | 2 | 3;
  type: StepType;
  /** `{name}` interpolates the captured first name (falls back per VB copy). */
  question?: string;
  subtitle?: string;
  options?: QuizOption[];
  /** statement beats */
  headline?: string;
  body?: RichText;
  cta?: string;
  /** VBReady: render the user's answers back as recap chips. */
  recapChips?: boolean;
  /** Where this step routes instead of the next quiz step. */
  next?: 'email' | 'offer';
}

export const QUIZ_STEPS: QuizStepDef[] = [
  // ── ACT 1 — Hook & frame ──────────────────────────────────────────────────
  // (The VBWelcome cold-open lives on the landing page — on web the landing IS
  // the hook, and ad variants must be able to override it for message match.)
  {
    id: 'intro',
    act: 1,
    type: 'statement',
    headline: "Let's start with *your family*.",
    body: [
      'No right answers, no judgment. The more real you are, the sharper your plan gets, built for ',
      { text: 'your child', hl: true },
      ', not the average one.\n\nEverything you share stays on your side. It just shapes your plan.',
    ],
    cta: 'Continue',
  },
  {
    id: 'name',
    act: 1,
    type: 'name',
    question: 'First, what should we call *you*?',
    subtitle: 'So your plan feels like yours.',
  },
  {
    id: 'role',
    act: 1,
    type: 'single',
    question: 'Who are you parenting *as*?',
    subtitle: 'Your answers are stored securely and used only to personalize your lessons.',
    options: [
      { value: 'mother', label: 'Mother', icon: 'user' },
      { value: 'father', label: 'Father', icon: 'user' },
      { value: 'other', label: 'Guardian / caregiver', icon: 'heart-handshake' },
    ],
  },
  {
    // Web-only qualifier — the chargeback guard. Early, before investment
    // builds. Android routes to the waitlist, never to checkout.
    id: 'phone',
    act: 1,
    type: 'single',
    question: 'What *phone* do you use?',
    subtitle: 'Your lessons live in the Kinderwell iPhone app.',
    options: [
      { value: 'iphone', label: 'iPhone', icon: 'apple' },
      { value: 'android', label: 'Android', icon: 'bot', disqualifies: 'android' },
    ],
  },
  {
    id: 'children-count',
    act: 1,
    type: 'single',
    question: 'Tell us about *your kids*. How many do you have?',
    options: [
      { value: '1', label: 'One', icon: 'baby' },
      { value: '2', label: 'Two', icon: 'users' },
      { value: '3+', label: 'Three or more', icon: 'users-round' },
    ],
  },
  {
    id: 'child-age',
    act: 1,
    type: 'single',
    question: 'How old is *your child*?',
    subtitle: 'If you have more than one, pick the child you’re most focused on right now.',
    options: [
      { value: '0-1', label: 'Under 2', icon: 'baby' },
      { value: '2-4', label: '2–4 years', icon: 'blocks' },
      { value: '5-7', label: '5–7 years', icon: 'backpack' },
      { value: '8-12', label: '8–12 years', icon: 'book-open' },
      { value: '13-17', label: '13–17 years', icon: 'graduation-cap' },
    ],
  },

  // ── ACT 2 — Diagnose & reflect ────────────────────────────────────────────
  {
    id: 'mood',
    act: 2,
    type: 'single',
    question: '{name}, how do most days *feel* lately?',
    subtitle: "Be honest. This one's just between us.",
    options: [
      { value: 'calm', label: 'Mostly calm', icon: 'sun' },
      { value: 'manageable', label: 'Okay, with rough patches', icon: 'cloud-sun' },
      { value: 'stretched', label: 'Stretched thin', icon: 'shrink' },
      { value: 'chaotic', label: 'Honestly, chaotic', icon: 'shuffle' },
      { value: 'overwhelmed', label: 'Underwater most days', icon: 'cloud-rain' },
    ],
  },
  {
    id: 'challenges',
    act: 2,
    type: 'multi',
    question: "What's been the *hardest part* lately?",
    subtitle: 'Pick as many as ring true.',
    options: [
      { value: 'tantrums', label: 'Meltdowns and tantrums', icon: 'flame' },
      { value: 'listening', label: 'Getting them to listen', icon: 'ear' },
      { value: 'screens', label: 'Screen-time battles', icon: 'smartphone' },
      { value: 'sleep', label: 'Sleep and bedtime', icon: 'moon' },
      { value: 'defiance', label: 'Defiance and power struggles', icon: 'hand' },
      { value: 'anxiety', label: 'Big worries or anxiety', icon: 'cloud' },
      { value: 'siblings', label: 'Sibling fighting', icon: 'users' },
      { value: 'bond', label: 'Feeling disconnected from them', icon: 'heart-off' },
    ],
  },
  {
    id: 'when-hardest',
    act: 2,
    type: 'multi',
    question: 'In those moments, what *usually happens*?',
    subtitle: 'No judgment here. Every parent has these.',
    options: [
      { value: 'lose_patience', label: 'I lose my patience', icon: 'zap' },
      { value: 'give_in', label: 'I give in just to stop it', icon: 'flag' },
      { value: 'dont_know', label: "I freeze and don't know what to say", icon: 'snowflake' },
      { value: 'yell', label: 'I raise my voice, then feel awful', icon: 'megaphone' },
      { value: 'guilt', label: 'I feel guilty long after', icon: 'frown' },
      { value: 'okay', label: "I'm actually handling it okay", icon: 'thumbs-up' },
    ],
  },
  {
    id: 'experience',
    act: 2,
    type: 'single',
    question: 'How familiar are you with *modern parenting* ideas?',
    options: [
      { value: 'new-to-science', label: "I'm completely new to parenting science", icon: 'sprout' },
      { value: 'somewhat-familiar', label: 'I am somewhat familiar with it', icon: 'book-open' },
      { value: 'know-a-lot', label: 'I know a lot about parenting science', icon: 'graduation-cap' },
    ],
  },
  {
    id: 'mirror',
    act: 2,
    type: 'statement',
    headline: 'Take a breath, *{name}*.',
    body: [
      { text: '83% of parents', hl: true },
      ' just told us the exact same thing.\n\nThat voice saying you should already know how to handle this? It’s wrong. You were never taught. That’s not a flaw, it’s the whole reason we’re here.',
    ],
    cta: "I'm ready",
  },
  {
    id: 'goals',
    act: 2,
    type: 'multi',
    question: "Picture six months from now. *What's different?*",
    subtitle: "Pick what you're really after.",
    options: [
      { value: 'calm_mornings', label: 'Calmer mornings', icon: 'coffee' },
      { value: 'fewer_meltdowns', label: 'Fewer meltdowns', icon: 'leaf' },
      { value: 'closer_bond', label: 'A closer bond with my kid', icon: 'heart' },
      { value: 'more_patience', label: 'More patience when it counts', icon: 'flower' },
      { value: 'confidence', label: "Feeling like I've got this", icon: 'award' },
      { value: 'consistency', label: 'My partner and I on the same page', icon: 'users-round' },
    ],
  },
  {
    id: 'ready',
    act: 2,
    type: 'statement',
    headline: 'Got it, {name}. This is your *starting point*.',
    body: ['Your plan gets built around exactly this. Nothing off the shelf.'],
    recapChips: true,
    cta: 'Build my plan',
    next: 'email', // → /email → /building (calculating) → /plan (snapshot) → step 14
  },

  // ── ACT 3 — Commit & convert (resumes after the /plan snapshot) ──────────
  {
    id: 'how-it-works',
    act: 3,
    type: 'statement',
    headline: 'No 300-page books. Just *five minutes*.',
    body: [
      'Every lesson gives you ',
      { text: 'one thing to try today', hl: true },
      '.\n\nGrounded in real child development science, written for tired parents in the middle of it, not for a classroom.',
    ],
    cta: 'Continue',
  },
  {
    id: 'benefit',
    act: 3,
    type: 'statement',
    headline: 'Small shifts. *Big difference.*',
    body: [
      'You don’t have to fix everything at once. You won’t.\n\nBut give it ',
      { text: 'two weeks', hl: true },
      ' and most parents say the same thing: the house feels calmer, and the hard moments stop running the day.',
    ],
    cta: 'Continue',
  },
  {
    id: 'commit',
    act: 3,
    type: 'single',
    question: 'Real talk. How ready are you to make this *stick*?',
    subtitle: "There's no wrong answer, but be honest with yourself.",
    options: [
      { value: 'extremely', label: 'All in', icon: 'flame' },
      { value: 'very', label: 'Very committed', icon: 'check-circle' },
      { value: 'somewhat', label: 'Somewhat committed', icon: 'circle' },
      { value: 'exploring', label: 'Just looking for now', icon: 'eye' },
    ],
  },
  {
    id: 'all-in',
    act: 3,
    type: 'statement',
    headline: "That's the hard part *done*, {name}.",
    body: [
      'Choosing to change how you show up? Most people never get there. You just did.\n\nThe rest is small, doable steps. Let’s build the home you actually want, one at a time.',
    ],
    cta: "Let's go",
    next: 'offer',
  },
];

export const TOTAL_STEPS = QUIZ_STEPS.length;

/** Where Act 3 resumes after the /plan snapshot ("This is me" CTA). */
export const ACT3_START = QUIZ_STEPS.findIndex((s) => s.id === 'how-it-works') + 1;

/** Full perceived journey for the progress bar: steps + email/building/plan/offer. */
export const JOURNEY_LENGTH = TOTAL_STEPS + 4;

export function stepIndexById(id: string): number {
  return QUIZ_STEPS.findIndex((s) => s.id === id);
}
