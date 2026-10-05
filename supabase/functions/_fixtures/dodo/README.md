# Dodo payload fixtures

The integration tests (`supabase/functions/_integration/`) replay these
payloads through the real handlers. `_testing/fixtures.ts` loads them and
overrides only the ids a test needs (user, subscription, payment, dates).

## ⚠️ Status: UNVERIFIED — built from Dodo's published schema, not captured

Built on 2026-10-05 from the type definitions in the `dodopayments` SDK
v2.52.0 (`resources/webhooks/webhooks.d.ts`, `subscriptions.d.ts`,
`refunds.d.ts`, `disputes.d.ts`, `payments.d.ts`), with fake ids, names and
emails. Every field Dodo marks as required is present.

They are a stand-in. The worst bug so far (refunds never revoked access)
came from assuming a field Dodo does not send, and only real payloads catch
that class of bug. **Replace them with captured test-mode payloads** before
relying on the tests for go-live.

| File | Used for |
| --- | --- |
| `subscription.active.json` | every `subscription.*` event (the helper changes `type` and `data.status`) |
| `payment.succeeded.json` | `payment.*` events |
| `refund.succeeded.json` | `refund.*` events (helper sets `is_partial`, `status`) |
| `dispute.opened.json` | `dispute.*` events (helper sets `dispute_status`) |
| `payments.get.json` | the `GET /payments/{id}` API response the webhook uses to map a refund to its subscription |
| `products.get.json` | the `GET /products/{id}` API response create-checkout's price guard reads |

## How to replace them with real ones

1. In Dodo **test mode**, make one purchase with card `4242 4242 4242 4242`,
   refund it from the dashboard, and (if test mode allows) open a dispute.
2. Dodo dashboard → Webhooks → your endpoint → **Message attempts**. Open each
   delivery and copy the request body. Alternatively run
   `dodo wh listen <url>` with the Dodo CLI and save what arrives.
3. For `payments.get.json` and `products.get.json`: `curl -H "Authorization: Bearer $DODO_TEST_KEY"
   https://test.dodopayments.com/payments/<payment_id>` (and `/products/<product_id>`).
4. Replace emails, names, addresses, `customer_id` and card details with fake
   values. Keep every other field exactly as Dodo sent it — including fields
   the code doesn't read, and including fields that are missing.
5. Save over the files above, change the status line in this README to
   "captured on <date>", and run the integration tests. A failure after the
   swap is a real mismatch between our code and Dodo — fix the code, not the
   fixture.

Re-capture whenever Dodo changes its API version.
