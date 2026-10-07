'use client';

import type { PostHog } from 'posthog-js';
import { config, supabaseEnvironment } from './config';

// Typed event registry — the web mirror of the app's safeCapture discipline.
// No raw posthog.capture in components; add the event here first.
// HOUSE INVARIANT (from the app repo): identify by Supabase user ID only.
// Email, names, and free text NEVER go to PostHog.
//
// posthog-js (~100 KB gzipped) is loaded on demand, not imported: a static
// import put it in the layout chunk every page ships, including /start, the
// page every ad lands on (review 2026-10-07, FE-9). Calls made before it has
// loaded are queued and replayed in order.

let loading: Promise<PostHog | null> | null = null;
let ready: PostHog | null = null;
const queue: Array<(p: PostHog) => void> = [];
const MAX_QUEUED = 100;

/**
 * Super-properties on every web event, matching the app's (config/posthog.ts
 * registers environment + app_env): the project is shared with the app, and
 * a dashboard filtered on environment = prod used to drop every web event
 * — while the live site still writes to the dev project, its events must
 * not pass for real ones either (XR-7). `surface` tells web from app.
 */
function superProperties() {
  return { environment: supabaseEnvironment, app_env: supabaseEnvironment, surface: 'web' };
}

export function initAnalytics(): void {
  if (loading || !config.posthogKey || typeof window === 'undefined') return;
  loading = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(config.posthogKey, {
        api_host: config.posthogHost,
        capture_pageview: false, // we fire screen-level funnel events instead
        capture_pageleave: false,
        // Autocapture records button text as $el_text — here that is the quiz
        // answers (a parent's stress, their child's behaviour) and, on /welcome,
        // the buyer's email. The typed registry below is the only capture path.
        autocapture: false,
        // The PostHog project is shared with the app; if replay is on there it
        // must not record the funnel.
        disable_session_recording: true,
        persistence: 'localStorage+cookie',
        before_send: scrubUrls,
      });
      posthog.register(superProperties());
      ready = posthog;
      for (const fn of queue.splice(0)) fn(posthog);
      return posthog;
    })
    .catch(() => null); // blocked or failed download: the funnel carries on without analytics
}

/** Runs `fn` with PostHog now, or once it has loaded. Analytics must never break the funnel. */
function withPosthog(fn: (p: PostHog) => void): void {
  try {
    if (!loading) initAnalytics();
    if (!loading) return; // no key configured — funnel must still work
    if (ready) fn(ready);
    else if (queue.length < MAX_QUEUED) queue.push(fn);
  } catch {
    /* same */
  }
}

const URL_PROPS = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer'];

/** Drops email-bearing query params (Dodo appends ?email= to return_url) from every URL property. */
function scrubUrls<T extends { properties?: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> } | null>(
  event: T
): T {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const key of URL_PROPS) {
      const value = bag[key];
      if (typeof value === 'string') bag[key] = stripEmailParams(value);
    }
  }
  return event;
}

export function stripEmailParams(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (key.toLowerCase().includes('email') || /@/.test(u.searchParams.get(key) ?? '')) {
        u.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

type FunnelEvent =
  // Brand homepage (/) — organic entry, deliberately NOT web_funnel_* so the
  // paid funnel's first step stays web_funnel_landing_viewed on /start.
  | { name: 'web_home_viewed'; props?: undefined }
  | { name: 'web_home_cta_clicked'; props: { target: 'quiz' | 'app_store' } }
  | { name: 'web_funnel_landing_viewed'; props: { variant: string } }
  | { name: 'web_funnel_quiz_started'; props?: undefined }
  | { name: 'web_funnel_quiz_step'; props: { step: number; step_id: string; act: number } }
  | { name: 'web_funnel_quiz_disqualified'; props: { reason: 'android' | 'age' } }
  | { name: 'web_funnel_email_captured'; props?: undefined }
  | { name: 'web_funnel_plan_viewed'; props?: undefined }
  | { name: 'web_funnel_offer_viewed'; props?: undefined }
  // /offer with no session in this browser — mostly Instagram's own "Open
  // in browser" (FE-7). Counted to see how often the recovery card shows.
  | { name: 'web_funnel_offer_no_session'; props?: undefined }
  | { name: 'web_funnel_checkout_opened'; props: { plan: 'annual' | 'monthly' } }
  | { name: 'web_funnel_checkout_overlay_opened'; props?: undefined }
  | { name: 'web_funnel_checkout_abandoned'; props?: undefined }
  | { name: 'web_funnel_open_in_safari_clicked'; props?: undefined }
  | { name: 'web_funnel_welcome_viewed'; props: { payment: 'confirmed' | 'processing' | 'failed' | 'unknown' } }
  // SPEC-21 handoff on /welcome. Outcomes only — NEVER the link or its key,
  // which is a login credential. `result` is 'ready' or mint-handoff's error code.
  | { name: 'web_funnel_handoff_link'; props: { result: string } }
  | { name: 'web_funnel_get_app_tapped'; props: { link: 'ready' | 'pending' | 'none'; copied: boolean } }
  | { name: 'web_funnel_open_app_tapped'; props?: undefined }
  | { name: 'web_funnel_error'; props: { where: string } };

export function track(event: FunnelEvent['name'], props?: Record<string, unknown>): void {
  withPosthog((p) => p.capture(event, props));
}

/** Call once the Supabase user exists (email capture). Merges anon history. */
export function identify(supabaseUserId: string): void {
  withPosthog((p) => p.identify(supabaseUserId));
}

const RESET_PENDING_KEY = 'kw_analytics_reset';

/**
 * Forget the buyer before the NEXT funnel run on this device (review
 * 2026-10-07, FE-5): a partner or a second child's run used to be attributed
 * to the buyer until /email. Not at once: the rest of /welcome (the handoff
 * result, the "Get Kinderwell" tap) belongs to the buyer. /welcome marks it;
 * the next page that isn't /welcome does it (consumePendingReset).
 */
export function resetAnalyticsBeforeNextRun(): void {
  try {
    localStorage.setItem(RESET_PENDING_KEY, '1');
  } catch {
    /* storage blocked: the next run starts a new session anyway */
  }
}

/** Called on every route: performs a reset /welcome asked for, once off /welcome. */
export function consumePendingReset(pathname: string): void {
  try {
    if (pathname.startsWith('/welcome') || localStorage.getItem(RESET_PENDING_KEY) !== '1') return;
    localStorage.removeItem(RESET_PENDING_KEY);
  } catch {
    return;
  }
  withPosthog((p) => {
    p.reset();
    // reset() clears super-properties too.
    p.register(superProperties());
  });
}
