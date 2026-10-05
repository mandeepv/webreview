import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

// Pairs with the X-Robots-Tag headers in next.config.mjs: only the homepage,
// the ad landing and the legal pages are meant to be found.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/start', '/legal/'],
      disallow: ['/quiz/', '/email', '/building', '/plan', '/offer', '/welcome', '/waitlist', '/unsubscribe', '/manage', '/r/', '/api/'],
    },
    host: config.siteUrl,
  };
}
