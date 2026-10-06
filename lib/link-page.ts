import 'server-only';
import { createHash } from 'node:crypto';

// The HTML of open.kinderwell.app/k/<key> (app/k/[key]/route.ts): what a
// sign-in link opens when the app ISN'T installed (SPEC-21 §4.2). Plain
// HTML, no framework, nothing loaded from anywhere, because the key in
// this page's URL is a login credential (see the route for the rest).
//
// Copy rules: the app's button labels are quoted EXACTLY as the app shows
// them (same note as app/welcome/welcome-client.tsx).

export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** Must match the server's (supabase/functions/_shared/handoff.ts) and the app's associatedDomains. */
export const LINK_BASE = 'https://open.kinderwell.app/k/';

/**
 * "Already have the app? Open Kinderwell": the same key as a universal link
 * on the MAIN site. This page is on open.kinderwell.app, and a universal link
 * tapped on its own host opens Safari; on another host iOS hands it straight
 * to the app. (A kinderwell:// link would work too, but Safari first asks
 * "Open in Kinderwell?".) Needs the AASA on kinderwell.app, which the same
 * route serves, and applinks:kinderwell.app in the app's associatedDomains.
 */
const OPEN_IN_APP_BASE = 'https://kinderwell.app/k/';

// The one script: "Get Kinderwell" copies the sign-in link (read from this
// page's own URL, so the script is the same for every key and can be pinned
// by hash), then the link's default action opens the App Store. The copy has
// to start inside the tap; iOS refuses it later.
const SCRIPT = `
var get = document.getElementById('get');
if (get) get.addEventListener('click', function () {
  var key = location.pathname.split('/').pop();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !navigator.clipboard) return;
  try { navigator.clipboard.writeText('${LINK_BASE}' + key).catch(function () {}); } catch (e) {}
});
`;

// The site's tokens (tailwind.config.ts), with system fonts: no font request.
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #eee9dc; color: #23211e;
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
main { max-width: 440px; margin: 0 auto; padding: 48px 20px 40px; }
.eyebrow { margin: 0; font: 500 12px/1 ui-monospace, Menlo, monospace; letter-spacing: .14em;
  text-transform: uppercase; color: #8f4526; }
h1 { margin: 16px 0 0; font: 400 32px/1.16 Georgia, 'Times New Roman', serif; }
h2 { margin: 0; font: 400 19px/1.3 Georgia, 'Times New Roman', serif; }
.lede { margin: 16px 0 0; color: rgba(35,33,30,.75); }
.button { display: flex; align-items: center; justify-content: center; height: 58px; margin-top: 24px;
  border-radius: 999px; background: #2f6b4a; color: #fbf7ef; font-size: 17px; font-weight: 600;
  text-decoration: none; }
.alt { margin: 14px 0 0; text-align: center; color: rgba(35,33,30,.7); }
a { color: #2f6b4a; font-weight: 600; }
.qr { width: 196px; margin-top: 24px; padding: 8px; border-radius: 16px; background: #fbf7ef; }
.qr svg { display: block; width: 180px; height: 180px; }
.card { margin-top: 32px; padding: 20px; border-radius: 22px; background: #e5dbc9; }
ol { margin: 12px 0 0; padding-left: 20px; color: rgba(35,33,30,.75); }
li + li { margin-top: 8px; }
.fine { margin: 24px 0 0; text-align: center; font-size: 13px; color: rgba(35,33,30,.5); }
`;

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/** Allows exactly this page's own script and style, and nothing else. */
export const LINK_PAGE_CSP = [
  "default-src 'none'",
  `script-src ${sha256(SCRIPT)}`,
  `style-src ${sha256(STYLE)}`,
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderLinkPage(o: {
  /** A well-formed key, or null for a link that came through broken. */
  key: string | null;
  /** iPhone/iPad: the buttons. Anything else: a QR code for the phone camera. */
  phone: boolean;
  appStoreUrl: string;
  /** The QR code for the link, as SVG markup (desktop only). */
  qrSvg?: string;
}): string {
  const store = escape(o.appStoreUrl);
  let top: string;
  if (!o.key) {
    top = `
<h1>This link looks <em>incomplete</em>.</h1>
<p class="lede">It may have been cut short on the way. You can still get in: install Kinderwell and sign in with the email you used at checkout.</p>
<a class="button" href="${store}">Get Kinderwell</a>`;
  } else if (o.phone) {
    top = `
<h1>Let’s get you <em>into the app</em>.</h1>
<p class="lede">Tap <strong>Get Kinderwell</strong> to install the app. Then open it and tap <strong>Paste</strong>: you’re signed in, no password and no code.</p>
<a id="get" class="button" href="${store}">Get Kinderwell</a>
<p class="alt">Already have the app? <a href="${OPEN_IN_APP_BASE}${escape(o.key)}">Open Kinderwell</a></p>`;
  } else {
    top = `
<h1>Open this on <em>your iPhone</em>.</h1>
<p class="lede">Kinderwell is an iPhone app. Point your iPhone camera at this code and open the link: it gets the app and signs you in.</p>
<div class="qr">${o.qrSvg ?? ''}</div>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#eee9dc">
<title>Open Kinderwell</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="eyebrow">Kinderwell</p>
${top}
<div class="card">
<h2>Or sign in with your email</h2>
<ol>
<li>Open Kinderwell. At the bottom of the first screen, tap <strong>Sign in</strong> (next to “Already have an account?”), not <strong>Get started</strong>, which is for new users.</li>
<li>Choose <strong>Continue with Email</strong> and enter the email you used at checkout. We’ll send you a 6-digit code, and your subscription unlocks automatically.</li>
</ol>
</div>
${o.key ? '<p class="fine">This link signs in to your account and works once, so please don’t share it.</p>' : ''}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}
