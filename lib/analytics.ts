'use client';

import posthog from 'posthog-js';
import { config } from './config';

// Typed event registry — the web mirror of the app's safeCapture discipline.
// No raw posthog.capture in components; add the event here first.
// HOUSE INVARIANT (from the app repo): identify by Supabase user ID only.
// Email, names, and free text NEVER go to PostHog.

let initialized = false;

export function initAnalytics(): void {
  if (initialized || !config.posthogKey || typeof window === 'undefined') return;
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
  initialized = true;
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
  try {
    if (!initialized) initAnalytics();
    if (!initialized) return; // no key configured — funnel must still work
    posthog.capture(event, props);
  } catch {
    // Analytics must never break the funnel.
  }
}

/** Call once the Supabase user exists (email capture). Merges anon history. */
export function identify(supabaseUserId: string): void {
  try {
    if (!initialized) return;
    posthog.identify(supabaseUserId);
  } catch {
    /* same */
  }
}
