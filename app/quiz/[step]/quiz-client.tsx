'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  OptionRow,
  PrimaryButton,
  ProgressRail,
  Rich,
  RichHeadline,
  Shell,
} from '@/components/ui';
import { JOURNEY_LENGTH, journeyPositionForStep, QUIZ_STEPS, QuizOption } from '@/lib/quiz/questions';
import { recapChips } from '@/lib/quiz/scoring';
import { getSession, setAnswer } from '@/lib/session';
import { track } from '@/lib/analytics';
import { pixelCustom } from '@/lib/meta';

/**
 * `{name}` interpolation with the graceful fallback: with no name captured,
 * "Take a breath, *{name}*." degrades to "Take a breath." rather than
 * showing a placeholder token.
 */
function withName(text: string, name: string | null): string {
  if (name) return text.replace(/\{name\}/g, name);
  return text
    .replace(/, \*\{name\}\*/g, '')
    .replace(/, \{name\}/g, '')
    .replace(/\{name\}, /g, '')
    .replace(/\*\{name\}\*/g, 'friend')
    .replace(/\{name\}/g, 'friend');
}

const ARRIVED_KEY = 'kw_quiz_arrived_from_previous';

/** Steps this tab reached by Continue from the step before — their previous history entry is that step. */
function arrivedSteps(): number[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ARRIVED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function markArrivedFromPrevious(step: number) {
  try {
    sessionStorage.setItem(ARRIVED_KEY, JSON.stringify([...new Set([...arrivedSteps(), step])]));
  } catch {
    /* storage blocked: back falls back to a push */
  }
}

function arrivedFromPrevious(step: number): boolean {
  return arrivedSteps().includes(step);
}

export default function QuizStep({ stepNumber }: { stepNumber: number }) {
  const router = useRouter();
  const idx = stepNumber - 1;
  const step = QUIZ_STEPS[idx];
  const [multi, setMulti] = useState<string[]>([]);
  const [single, setSingle] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [name, setName] = useState<string | null>(null);
  const [chips, setChips] = useState<string[]>([]);

  useEffect(() => {
    if (!step) {
      router.replace('/start');
      return;
    }
    const s = getSession();
    const prev = s.answers[step.id];
    if (Array.isArray(prev)) setMulti(prev);
    // Coming back to a single-choice step shows what they picked (P3-3).
    setSingle(typeof prev === 'string' && step.type === 'single' ? prev : null);
    if (step.type === 'name' && typeof prev === 'string') setNameInput(prev);
    const storedName = s.answers['name'];
    setName(typeof storedName === 'string' && storedName.trim() ? storedName.trim() : null);
    if (step.recapChips) setChips(recapChips(s.answers));
    if (idx === 0) {
      track('web_funnel_quiz_started');
      pixelCustom('QuizStart');
    }
    track('web_funnel_quiz_step', { step: stepNumber, step_id: step.id, act: step.act });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepNumber]);

  if (!step) return null;

  const next = () => {
    // Email already given (they came back from Act 3): don't ask again or
    // replay the build — straight back to their plan (P2-7c).
    if (step.next === 'email' && getSession().emailCaptured) router.push('/plan');
    else if (step.next === 'email') router.push('/email');
    else if (step.next === 'offer') router.push('/offer');
    else if (stepNumber >= QUIZ_STEPS.length) router.push('/email');
    else {
      markArrivedFromPrevious(stepNumber + 1);
      router.push(`/quiz/${stepNumber + 1}`);
    }
  };

  // Back is a real history step when we know the previous entry is the
  // previous question; pushing a new entry on every back tap grew the history
  // so the browser's own back button walked forward again (P3-25). A step
  // reached any other way (resume link, refresh) still pushes.
  const back = () => {
    if (stepNumber > 1 && arrivedFromPrevious(stepNumber)) router.back();
    else router.push(stepNumber > 1 ? `/quiz/${stepNumber - 1}` : '/start');
  };

  const pickSingle = (opt: QuizOption) => {
    setSingle(opt.value);
    setAnswer(step.id, opt.value);
    if (opt.disqualifies) {
      track('web_funnel_quiz_disqualified', { reason: opt.disqualifies });
      router.push(`/waitlist?reason=${opt.disqualifies}`);
      return;
    }
    // Tiny delay so the selected state is visible before the transition.
    setTimeout(next, 160);
  };

  const toggleMulti = (opt: QuizOption) => {
    setMulti((cur) => {
      const on = cur.includes(opt.value);
      const nextSel = on ? cur.filter((v) => v !== opt.value) : [...cur, opt.value];
      setAnswer(step.id, nextSel);
      return nextSel;
    });
  };

  const saveName = () => {
    // Name goes to Supabase with the rest of the answers (our system of
    // record — same as the app). It is structurally excluded from PostHog
    // and Meta: analytics events only ever carry step ids, never answers.
    setAnswer('name', nameInput.trim());
    next();
  };

  return (
    <Shell>
      <ProgressRail fraction={journeyPositionForStep(stepNumber) / JOURNEY_LENGTH} onBack={back} />

      {step.type === 'statement' ? (
        <div className="flex flex-1 flex-col justify-center py-8">
          <RichHeadline className="font-serif text-[32px] leading-[1.16] text-ink">
            {withName(step.headline!, name)}
          </RichHeadline>
          {chips.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {chips.map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-wash px-4 py-2 text-[14px] font-medium text-ink/80"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          {step.body ? (
            <p className="mt-5 text-[17px] leading-[1.6] text-ink/70">
              <Rich body={step.body} />
            </p>
          ) : null}
          <div className="mt-10">
            <PrimaryButton onClick={next}>{step.cta ?? 'Continue'}</PrimaryButton>
          </div>
        </div>
      ) : step.type === 'name' ? (
        <div className="flex flex-1 flex-col justify-center py-8">
          <RichHeadline>{step.question!}</RichHeadline>
          {step.subtitle ? (
            <p className="mt-3 font-serif text-[17px] italic text-ink/60">{step.subtitle}</p>
          ) : null}
          <div className="mt-8 space-y-3">
            <input
              type="text"
              autoComplete="given-name"
              aria-label="Your first name"
              placeholder="Your first name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && nameInput.trim() && saveName()}
              className="w-full rounded-row border border-ink/15 bg-cream px-5 py-4 text-[17px] text-ink outline-none placeholder:text-ink/35 focus:border-forest"
            />
            <PrimaryButton onClick={saveName} disabled={!nameInput.trim()}>
              Continue
            </PrimaryButton>
            <button
              onClick={next}
              className="mx-auto block py-1 text-[15px] text-ink/50 underline underline-offset-2"
            >
              Skip for now
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col pt-7">
          <RichHeadline>{withName(step.question!, name)}</RichHeadline>
          {step.subtitle ? (
            <p className="mt-3 font-serif text-[17px] italic text-ink/60">{step.subtitle}</p>
          ) : null}

          <div className="mt-7 space-y-[10px]">
            {step.options!.map((opt) => (
              <OptionRow
                key={opt.value}
                label={opt.label}
                mode={step.type === 'multi' ? 'multi' : 'single'}
                selected={step.type === 'multi' ? multi.includes(opt.value) : single === opt.value}
                onClick={() => (step.type === 'multi' ? toggleMulti(opt) : pickSingle(opt))}
              />
            ))}
          </div>

          {step.type === 'multi' ? (
            <div className="sticky bottom-5 mt-9">
              <PrimaryButton onClick={next} disabled={multi.length === 0}>
                Continue
              </PrimaryButton>
            </div>
          ) : null}
        </div>
      )}
    </Shell>
  );
}
