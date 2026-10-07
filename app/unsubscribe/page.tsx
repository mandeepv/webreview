import { redirect } from 'next/navigation';
import UnsubscribeClient from './unsubscribe-client';

// Older emails link here with ?u=&t= in the URL. Hand them to /u on the
// server — before any HTML, so before the pixel snippet can send this URL
// to Meta (app/u/route.ts says why).
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { u, t } = await searchParams;
  if (u !== undefined || t !== undefined) {
    const qs = new URLSearchParams();
    if (typeof u === 'string') qs.set('u', u);
    if (typeof t === 'string') qs.set('t', t);
    redirect(`/u?${qs.toString()}`);
  }
  return <UnsubscribeClient />;
}
