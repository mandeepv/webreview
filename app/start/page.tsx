import Landing from './landing-client';
import { VARIANTS } from './variants';

// Landing is variant-aware (?a=tantrums|listening|yelling) so each ad's
// headline matches its creative — one page per angle, not one generic page.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { a } = await searchParams;
  const variantKey = typeof a === 'string' && VARIANTS[a] ? a : 'default';
  return <Landing variantKey={variantKey} />;
}
