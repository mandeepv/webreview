import Landing from './landing-client';
import { variantKeyFor } from './variants';

// Landing is variant-aware (?a=tantrums|listening|yelling) so each ad's
// headline matches its creative — one page per angle, not one generic page.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { a } = await searchParams;
  const variantKey = variantKeyFor(a);
  return <Landing variantKey={variantKey} />;
}
