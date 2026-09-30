import { Suspense } from 'react';
import Landing from './landing-client';

// Landing is variant-aware (?a=tantrums|listening|yelling) so each ad's
// headline matches its creative — one page per angle, not one generic page.
export default function Page() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}
