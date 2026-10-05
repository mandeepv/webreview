import { redirect } from 'next/navigation';
import WelcomeClient from './welcome-client';

// Dodo appends ?email=<buyer's address> (plus status, subscription_id, …) to
// return_url. The Meta pixel and PostHog both send the full page URL with
// every event, so that address would leave in plain text. Redirect to a clean
// URL on the server — before any HTML, so before the pixel snippet runs —
// keeping only what the page reads (P1-9b).
const KEEP = ['status', 'subscription_id', 'payment_id'];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (Object.keys(params).some((k) => !KEEP.includes(k))) {
    const qs = new URLSearchParams();
    for (const k of KEEP) {
      const v = params[k];
      if (typeof v === 'string') qs.set(k, v);
    }
    const query = qs.toString();
    redirect(query ? `/welcome?${query}` : '/welcome');
  }
  return <WelcomeClient />;
}
