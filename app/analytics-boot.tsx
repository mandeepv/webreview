'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { consumePendingReset, identify, initAnalytics } from '@/lib/analytics';
import { pixel, setPixelUserData, whenPixelReady } from '@/lib/meta';
import { getSession } from '@/lib/session';

export default function AnalyticsBoot() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    initAnalytics();
    // A purchase on this device asked to forget the buyer before the next run (FE-5).
    consumePendingReset(window.location.pathname);
    // A returning visitor (e.g. from a win-back email) already gave us their
    // email — re-attach it so this visit's events keep their match quality.
    // The pixel snippet loads afterInteractive, so wait until fbq exists.
    const s = getSession();
    // Same person across browsers (a resumed win-back link lands here with
    // a session built elsewhere): tie this browser to their user id.
    if (s.userId && s.userId !== 'dev-preview-user') identify(s.userId);
    if (s.email && s.userId && s.userId !== 'dev-preview-user') {
      return whenPixelReady(() => void setPixelUserData(s.email!, s.userId!));
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
    consumePendingReset(pathname);
    pixel('PageView');
  }, [pathname]);

  return null;
}
