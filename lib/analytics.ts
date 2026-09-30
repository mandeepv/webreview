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
    persistence: 'localStorage+cookie',
  });
  initialized = true;
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
  | { name: 'web_funnel_welcome_viewed'; props: { payment: 'confirmed' | 'processing' | 'failed' | 'unknown' } }
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
