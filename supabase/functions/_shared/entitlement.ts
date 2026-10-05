// Pure entitlement state machine for dodo-webhook: given the row on file and
// an incoming subscription.* event, decide what to write. No I/O, so every
// ordering and stale-event case is covered by entitlement_test.ts.

export const STATUS_BY_EVENT: Record<string, string> = {
  'subscription.active': 'active',
  'subscription.renewed': 'active',
  'subscription.plan_changed': 'active',
  'subscription.past_due': 'past_due',
  'subscription.on_hold': 'past_due', // still entitled until period end — never cut mid-period on a failed retry
  'subscription.cancelled': 'cancelled', // access continues until current_period_end (app + sweep enforce)
  'subscription.expired': 'expired',
  'subscription.failed': 'expired',
};

/** Statuses the app treats as entitled while current_period_end is in the future. */
const ENTITLED_STATUSES = ['active', 'past_due', 'cancelled'];

/**
 * The access rule — the same one the iOS app applies: entitled while the
 * status is active, past_due or cancelled AND the paid period has not ended.
 * `revoked` (refund/chargeback) and `expired` never have access.
 */
export function hasAccess(
  row: { status: string; current_period_end: string | null } | null | undefined,
  now: Date
): boolean {
  return (
    !!row &&
    ENTITLED_STATUSES.includes(row.status) &&
    !!row.current_period_end &&
    new Date(row.current_period_end) > now
  );
}

/** How long a failed renewal keeps access while Dodo retries the card. */
export const PAST_DUE_GRACE_MS = 3 * 24 * 3600 * 1000;

export type CurrentRow = {
  status: string;
  dodo_subscription_id: string | null;
  current_period_end: string | null;
  /** When the newest event applied to this row occurred (Dodo's envelope timestamp). */
  last_event_at?: string | null;
} | null;

export type IncomingEvent = {
  type: string;
  subscriptionId: string | null;
  nextBillingDate: string | null;
  plan?: string;
  /** Dodo's envelope `timestamp`: when the event happened, the same on every retry. */
  occurredAt?: string | null;
};

export type Decision =
  | { kind: 'ignore'; reason: string }
  /** A second live subscription while the one on file is still entitled. */
  | { kind: 'duplicate'; reason: string }
  | {
      kind: 'write';
      status: string;
      currentPeriodEnd: string | null;
      /** True when this event replaces a different subscription on file. */
      replacesSubscription: boolean;
      /** Set when next_billing_date was missing on an activating event. */
      periodEndFallback: string | null;
    };

export function decideSubscriptionWrite(
  current: CurrentRow,
  event: IncomingEvent,
  now: Date
): Decision {
  const status = STATUS_BY_EVENT[event.type];
  if (!status) return { kind: 'ignore', reason: `${event.type} carries no entitlement change` };

  const onFile = current?.dodo_subscription_id ?? null;
  const incoming = event.subscriptionId;
  const differentSubscription = !!current && !!onFile && !!incoming && onFile !== incoming;

  if (current?.status === 'revoked' && !differentSubscription) {
    // A refund/chargeback is final for THAT subscription: a late or replayed
    // lifecycle event for it must never restore access. A different
    // subscription is a new purchase and falls through (P0-1).
    return { kind: 'ignore', reason: 'row is revoked for this subscription' };
  }

  if (
    !differentSubscription &&
    current?.last_event_at &&
    event.occurredAt &&
    new Date(event.occurredAt).getTime() < new Date(current.last_event_at).getTime()
  ) {
    // Dodo retries a failed delivery hours later. An older event for the
    // same subscription must not undo a newer one — e.g. a retried
    // `renewed` arriving after `expired` would bring the row back to life
    // with a stale period end (P2-17).
    return {
      kind: 'ignore',
      reason: `${event.type} from ${event.occurredAt} is older than the last event applied (${current.last_event_at})`,
    };
  }

  if (differentSubscription) {
    if (status !== 'active') {
      // A late cancelled/expired/on_hold for an OLD subscription must not
      // overwrite the customer's current one (P1-3).
      return { kind: 'ignore', reason: `${event.type} for ${incoming}, but ${onFile} is on file` };
    }
    if (hasAccess(current!, now)) {
      return {
        kind: 'duplicate',
        reason: `${incoming} activated while ${onFile} is still ${current!.status} until ${current!.current_period_end}`,
      };
    }
    // The subscription on file has ended (expired, revoked, or lapsed): this
    // is a new purchase and replaces it.
  }

  const incomingEnd = event.nextBillingDate;
  const existingEnd = differentSubscription ? null : current?.current_period_end ?? null;

  if (status === 'active') {
    if (incomingEnd) {
      return write(status, incomingEnd, differentSubscription, null);
    }
    // Never write null on an activating event — the app would deny a paying
    // customer and the checkout dup guard would open (P1-4).
    const fallback =
      existingEnd && new Date(existingEnd) > now ? existingEnd : addPlanInterval(now, event.plan);
    return write(status, fallback, differentSubscription, fallback);
  }

  if (status === 'past_due' || status === 'cancelled') {
    // Degrading events never move the period end earlier (P2-3c). A failed
    // renewal's next_billing_date is the date it just failed to bill, so
    // past_due also gets a short grace while Dodo retries the card.
    const floor = status === 'past_due' ? new Date(now.getTime() + PAST_DUE_GRACE_MS).toISOString() : null;
    return write(status, latest(existingEnd, incomingEnd, floor), differentSubscription, null);
  }

  // expired / failed
  return write(status, incomingEnd ?? existingEnd, differentSubscription, null);
}

function write(
  status: string,
  currentPeriodEnd: string | null,
  replacesSubscription: boolean,
  periodEndFallback: string | null
): Decision {
  return { kind: 'write', status, currentPeriodEnd, replacesSubscription, periodEndFallback };
}

function latest(...dates: (string | null)[]): string | null {
  const present = dates.filter((d): d is string => !!d);
  if (present.length === 0) return null;
  return present.reduce((a, b) => (new Date(a) >= new Date(b) ? a : b));
}

export function addPlanInterval(from: Date, plan?: string): string {
  const d = new Date(from);
  if (plan === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

/** The later of two ISO timestamps (either may be missing). */
export function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
