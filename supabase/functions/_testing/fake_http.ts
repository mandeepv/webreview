// Fake HTTP for the integration tests: replaces globalThis.fetch so every
// outbound call to a service we don't own (Dodo, Resend, Meta, PostHog) is
// answered by a stub and RECORDED. Calls to the local Supabase pass through
// to the real network. Any other host throws — a new outbound call fails the
// test loudly instead of reaching the internet.

import { SUPABASE_URL, TEST } from './env.ts';

export type Call = {
  method: string;
  url: URL;
  /** Parsed JSON body, or the raw text when it isn't JSON. */
  body: unknown;
  headers: Headers;
};

type Responder = (call: Call) => Response | Promise<Response>;
type Route = { method: string; host: string; path: RegExp; respond: Responder };

export const HOSTS = {
  dodo: 'test.dodopayments.com',
  resend: 'api.resend.com',
  meta: 'graph.facebook.com',
  posthog: new URL(TEST.posthogHost).hostname,
} as const;

/** The real fetch, captured once — before any test file installs a fake. */
const REAL_FETCH = globalThis.fetch;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class FakeHttp {
  calls: Call[] = [];
  private routes: Route[] = [];
  private readonly realFetch = REAL_FETCH;
  private readonly passthrough = SUPABASE_URL ? new URL(SUPABASE_URL).host : '';

  install(): this {
    globalThis.fetch = this.fetch;
    this.reset();
    return this;
  }

  restore() {
    globalThis.fetch = this.realFetch;
  }

  /** Forget recorded calls and per-test routes; reinstall the defaults. */
  reset() {
    this.calls = [];
    this.routes = [];
    this.on('POST', HOSTS.resend, /^\/emails$/, () => json({ id: crypto.randomUUID() }));
    this.on('POST', HOSTS.meta, /\/events$/, () => json({ events_received: 1 }));
    this.on('POST', HOSTS.posthog, /^\/capture\/$/, () => json({ status: 1 }));
    this.on('PATCH', HOSTS.dodo, /^\/subscriptions\/[^/]+$/, () => json({}));
    this.on('GET', HOSTS.dodo, /^\/payments\/[^/]+$/, () => json({ message: 'not found' }, 404));
  }

  /** Register a stub. Later registrations win over earlier ones (so tests override defaults). */
  on(method: string, host: string, path: RegExp, respond: Responder) {
    this.routes.unshift({ method, host, path, respond });
  }

  private fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.host === this.passthrough) return this.realFetch(req);

    const text = req.body ? await req.text() : '';
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // not JSON — keep the text
    }
    const call: Call = { method: req.method, url, body, headers: req.headers };
    this.calls.push(call);

    const route = this.routes.find(
      (r) => r.method === req.method && r.host === url.hostname && r.path.test(url.pathname)
    );
    if (!route) throw new Error(`FakeHttp: unexpected ${req.method} ${url.href}`);
    return route.respond(call);
  };

  // ── Queries for assertions ────────────────────────────────────────────────

  to(host: string, method?: string, path?: RegExp): Call[] {
    return this.calls.filter(
      (c) => c.url.hostname === host && (!method || c.method === method) && (!path || path.test(c.url.pathname))
    );
  }

  emails(): Array<{ to: string[]; subject: string; html?: string; text?: string }> {
    return this.to(HOSTS.resend, 'POST').map((c) => c.body as { to: string[]; subject: string });
  }

  welcomeEmails() {
    return this.emails().filter((e) => e.subject.startsWith('Welcome to Kinderwell'));
  }

  alerts() {
    return this.emails().filter((e) => e.subject.startsWith('[Kinderwell alert]'));
  }

  /** Meta CAPI request bodies, optionally only those carrying `eventName`. */
  capiEvents(eventName?: string): Array<Record<string, unknown>> {
    return this.to(HOSTS.meta, 'POST')
      .map((c) => c.body as { data: Array<{ event_name: string }> } & Record<string, unknown>)
      .filter((b) => !eventName || b.data?.[0]?.event_name === eventName);
  }

  capiPurchases(): Array<Record<string, unknown>> {
    return this.capiEvents('Purchase');
  }

  dodoCancels(): string[] {
    return this.to(HOSTS.dodo, 'PATCH', /^\/subscriptions\//).map((c) => c.url.pathname.split('/').at(-1)!);
  }

  posthogEvents(): string[] {
    return this.to(HOSTS.posthog, 'POST').map((c) => (c.body as { event: string }).event);
  }
}
