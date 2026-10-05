'use client';

// The calculating beat, on the design system's full-bleed takeover surface
// (forest-deep, like the app's splash): mint mono eyebrow, a huge Newsreader
// Light numeral in cream, stage lines that replay the user's own answers.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/ui';
import { calculatingStages } from '@/lib/quiz/scoring';
import { getSession } from '@/lib/session';

const DURATION_MS = 9000;
const BUILT_KEY = 'kw_plan_built';

export default function BuildingPage() {
  const router = useRouter();
  const [pct, setPct] = useState(0);
  const [stages, setStages] = useState<{ at: number; label: string }[]>([]);

  useEffect(() => {
    // Seen it once this visit: the build is theatre, not a gate (P2-7b).
    try {
      if (sessionStorage.getItem(BUILT_KEY)) {
        router.replace('/plan');
        return;
      }
    } catch {
      /* storage blocked — just play it */
    }
    setStages(calculatingStages(getSession().answers));
    const started = Date.now();
    const t = setInterval(() => {
      const p = Math.min(100, Math.round(((Date.now() - started) / DURATION_MS) * 100));
      setPct(p);
      if (p >= 100) {
        clearInterval(t);
        try {
          sessionStorage.setItem(BUILT_KEY, '1');
        } catch {
          /* same */
        }
        setTimeout(() => router.replace('/plan'), 500);
      }
    }, 90);
    return () => clearInterval(t);
  }, [router]);

  const done = useMemo(() => stages.filter((s) => pct >= s.at), [stages, pct]);
  const current = stages.find((s) => pct < s.at);

  return (
    <Shell dark>
      <div className="flex flex-1 flex-col justify-center py-10">
        <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-mint">
          Building your plan
        </p>
        <p className="mt-4 font-serif text-[104px] font-light leading-none text-cream">
          {pct}
          <span className="text-[40px]">%</span>
        </p>

        <div className="mt-6 h-[4px] w-full overflow-hidden rounded-full bg-cream/15">
          <div
            className="h-full rounded-full bg-mint transition-all duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-4 font-serif text-[19px] italic text-cream/80">
          {current?.label ?? 'Finalizing your plan'}
        </p>

        <div className="mt-10 space-y-3">
          {stages.map((s) => {
            const isDone = done.includes(s);
            return (
              <div key={s.at} className="flex items-center gap-3">
                <span
                  className={`flex h-[23px] w-[23px] items-center justify-center rounded-full border-[1.5px] ${
                    isDone ? 'border-mint bg-mint/15' : 'border-cream/25'
                  }`}
                >
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M20 6L9 17l-5-5"
                        stroke="#c9e3d3"
                        strokeWidth="3.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
                <span className={`text-[16px] ${isDone ? 'text-cream' : 'text-cream/45'}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
