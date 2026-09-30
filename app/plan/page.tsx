'use client';

// The snapshot reveal — a stack of wash cards (label: mono eyebrow, value:
// serif) with one forest accent hero row, per the cream/forest system. CTA
// resumes Act 3 of the quiz.

import { useEffect, useState } from 'react';
import { Eyebrow, PrimaryButton, RichHeadline, Shell } from '@/components/ui';
import { ACT3_START } from '@/lib/quiz/questions';
import { snapshotRows, SnapshotRow } from '@/lib/quiz/scoring';
import { getSession } from '@/lib/session';
import { track } from '@/lib/analytics';

export default function PlanPage() {
  const [rows, setRows] = useState<SnapshotRow[] | null>(null);

  useEffect(() => {
    setRows(snapshotRows(getSession().answers));
    track('web_funnel_plan_viewed');
  }, []);

  if (!rows) return <Shell>{null}</Shell>;

  return (
    <Shell>
      <div className="flex-1 py-8">
        <Eyebrow>Your snapshot</Eyebrow>
        <div className="mt-4">
          <RichHeadline className="font-serif text-[32px] leading-[1.16] text-ink">
            {'Here’s *your plan*.'}
          </RichHeadline>
        </div>
        <p className="mt-4 text-[17px] leading-[1.6] text-ink/70">
          Built from what you told us. Not a template, not a guess.
        </p>

        <div className="mt-7 space-y-[10px]">
          {rows.map((row) => (
            <div
              key={row.label}
              className={`rounded-card px-5 py-4 ${row.accent ? 'bg-forest' : 'bg-wash'}`}
            >
              <p
                className={`font-mono text-[11px] uppercase tracking-[0.14em] ${
                  row.accent ? 'text-mint' : 'text-clay-deep'
                }`}
              >
                {row.label}
              </p>
              <p
                className={`mt-1.5 font-serif text-[19px] leading-snug ${
                  row.accent ? 'text-cream' : 'text-ink/90'
                }`}
              >
                {row.value}
              </p>
            </div>
          ))}
        </div>

        <div className="sticky bottom-5 mt-9">
          <PrimaryButton href={`/quiz/${ACT3_START}`}>This is me</PrimaryButton>
        </div>
      </div>
    </Shell>
  );
}
