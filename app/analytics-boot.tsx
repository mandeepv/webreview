'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { initAnalytics } from '@/lib/analytics';
import { pixel, setPixelUserData } from '@/lib/meta';
import { getSession } from '@/lib/session';

export default function AnalyticsBoot() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    initAnalytics();
    // A returning visitor (e.g. from a win-back email) already gave us their
    // email — re-attach it so this visit's events keep their match quality.
    // Deferred: the pixel snippet loads afterInteractive and may not have
    // defined fbq yet when this effect runs.
    const s = getSession();
    if (s.email && s.userId && s.userId !== 'dev-preview-user') {
      const t = setTimeout(() => void setPixelUserData(s.email!, s.userId!), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  // The funnel is a single-page app after the first load: Next.js route
  // changes don't reload the pixel, so without this Meta sees ONE PageView
  // per visit and every retargeting audience built on page visits is empty.
  // The first render is skipped — the base snippet already sent that one.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    pixel('PageView');
  }, [pathname]);

  return null;
}
