import { redirect } from 'next/navigation';
import { config } from '@/lib/config';

// kinderwell.app/manage — the one cancel/manage address we print everywhere
// (offer page, receipts, footer). A stable URL of our own means the portal
// can change without reprinting it. California's auto-renewal law requires an
// online way to cancel for anyone who signed up online; this is it.
export function GET() {
  redirect(config.dodoPortalUrl);
}
