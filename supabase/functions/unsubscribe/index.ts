// unsubscribe entry point. The logic lives in handler.ts so the integration tests
// (supabase/functions/_integration/) can call it without starting a server.
// Deploy as before: supabase functions deploy unsubscribe --no-verify-jwt
import { handler } from './handler.ts';

Deno.serve(handler);
