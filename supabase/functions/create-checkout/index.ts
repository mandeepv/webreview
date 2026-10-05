// create-checkout entry point. The logic lives in handler.ts so the
// integration tests (supabase/functions/_integration/) can call it without
// starting a server. Deploy as before: supabase functions deploy create-checkout --no-verify-jwt
import { createHandler } from './handler.ts';

Deno.serve(createHandler());
