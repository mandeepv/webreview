// Is this the funnel's own account, or one that existed before the funnel
// session that names it?
//
// capture-email attaches a funnel session to WHATEVER account already has the
// typed address, with no proof that the typist owns it. So anyone can pay
// with an existing customer's email. That much is harmless (they paid, the
// owner's inbox gets the welcome email), but nothing may then hand the payer
// a sign-in credential for that account: no welcome-page key, no "Open
// Kinderwell" link in the email (review 2026-10-07, B-1). For such a purchase
// the account owner's inbox is the only proof — the email-code sign-in.
//
// A returning lead whose account the funnel created on an earlier visit falls
// on the same side of the rule. They lose only the one-tap link and sign in
// with the email code like everyone did before SPEC-21.

/** An account created more than this before the session started predates it. */
export const ACCOUNT_SLACK_MS = 10 * 60 * 1000;

/**
 * True when the account predates the funnel session, or when either date is
 * unknown: a sign-in credential needs proof the funnel created the account.
 */
export function accountPredatesSession(
  accountCreatedAt: string | null | undefined,
  sessionCreatedAt: string | null | undefined
): boolean {
  if (!accountCreatedAt || !sessionCreatedAt) return true;
  const account = new Date(accountCreatedAt).getTime();
  const session = new Date(sessionCreatedAt).getTime();
  if (!Number.isFinite(account) || !Number.isFinite(session)) return true;
  return account < session - ACCOUNT_SLACK_MS;
}
