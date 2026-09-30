import { redirect } from 'next/navigation';
import Home from './home-client';

// kinderwell.app/ is the BRAND homepage (organic, press, App Store "Developer
// Website" traffic). Paid traffic belongs on /start, the message-matched ad
// landing. Any ad parameter arriving at / is forwarded there with its query
// intact, so a mis-typed ad URL still lands on the funnel and keeps its
// attribution instead of silently becoming "organic".
const AD_PARAMS = ['a', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (AD_PARAMS.some((k) => params[k] !== undefined)) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string') qs.set(k, v);
      else if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    }
    redirect(`/start?${qs.toString()}`);
  }
  return <Home />;
}
