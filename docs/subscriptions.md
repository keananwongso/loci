# Hosted accounts and subscriptions

Local copies work without an account, Stripe or Supabase. The hosted demo remains available without signing in, and keeps its boards in the browser. Signing in saves boards, uploaded files, conversations and replays to the account so they open on any device; boards made in the browser before signing in are copied into the account once, from Home. Free accounts keep 3 boards and 25 MB and count their 5 daily questions per account; Loci Pro gets up to 1000 boards and 2 GB (`LOCI_FREE_BOARDS`, `LOCI_FREE_STORAGE_MB`, `LOCI_PRO_BOARDS`, `LOCI_PRO_STORAGE_MB`).

The initial Pro plan is **US$8/month**. Default included usage is 200 questions, 150,000 natural-voice characters and 600 transcriptions per Stripe billing period, with daily limits of 20 questions, 20,000 voice characters and 60 transcriptions. Browser voice remains available when natural voice is exhausted. These limits are configurable in `.env.example`; changing them also changes existing subscribers' allowances. The question count is request based: a provider error can still consume a reserved question.

## Supabase

1. Create a project for Loci. In Google Cloud, configure the OAuth consent screen and create a **Web application** OAuth client. Add your app origin (and `http://localhost` plus `http://localhost:3000` for local testing) under Authorized JavaScript origins. In Supabase, enable the Google provider and add the same client ID. Loci uses [Google's sign-in button with ID tokens](https://supabase.com/docs/guides/auth/social-login/auth-google#google-pre-built), so the Google popup names your domain rather than the Supabase project. Set `GOOGLE_CLIENT_ID`.
2. Run [the billing migration](../supabase/migrations/202610050001_billing.sql), then [the boards migration](../supabase/migrations/202610060001_boards.sql), in the SQL editor. The tables, functions and the private `loci-files` storage bucket are available only to the server's service role: clients get no direct access, and every route verifies the user and filters by their id. Files upload straight to storage through one-time signed URLs and are read through short-lived signed URLs.
3. For email sign-in, set the Auth Site URL to your deployed Loci origin and allow `https://YOUR_DOMAIN/auth/callback` as a redirect. For local testing, also allow `http://localhost:3000/auth/callback`.
4. Optional email sign-in: Supabase's built-in email sender is rate-limited and only delivers to your project's team members, so it is off by default. To offer it, configure custom SMTP (for example Resend) under Authentication → Emails, set the magic-link email template to link to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email` following [Supabase's passwordless PKCE guide](https://supabase.com/docs/guides/auth/auth-email-passwordless), and set `LOCI_EMAIL_SIGNIN=on`.
5. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the anon or publishable key), `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_CLIENT_ID` in the deployment. The service-role key must stay server-only. This implementation also keeps the anon key on the server; all browser auth calls go through same-origin routes.

Sign-in uses server-side cookie sessions. Every privileged request verifies the user through Supabase Auth; it never trusts a client-supplied user ID. API handlers refresh sessions and return cookie updates. Auth-bearing responses are uncached. HttpOnly cookies are intentional: this application has no browser Supabase client. Google sign-in binds each ID token to a single-use nonce held in an HttpOnly cookie, and only `/account` allows Google's sign-in script in its Content Security Policy.

## Stripe

1. Create a Stripe account. Begin in a sandbox/test environment; activating live payments requires completing Stripe's business and payout setup.
2. Create a Loci Pro product with a recurring monthly **USD 8.00** price. The endpoint verifies this amount and interval before opening checkout, so a misconfigured price cannot silently charge a different amount.
3. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` and `LOCI_APP_URL` (your canonical app origin). Keep `LOCI_DEMO_LIMITS=on` and production Redis configured so hosted paid and free usage remains bounded.
4. Enable the Stripe customer portal with payment-method management and cancellation. Enable Stripe's [limit to one subscription](https://docs.stripe.com/payments/checkout/limit-subscriptions) setting. The app also reuses open checkouts and routes existing subscriptions to the portal.
5. Register `https://YOUR_DOMAIN/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid` and `invoice.payment_failed`.

For local webhook testing:

```sh
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Use the `whsec_...` secret from that listener locally. Deployed webhook endpoints have their own secrets.

The [webhook verifies Stripe's signature](https://docs.stripe.com/billing/subscriptions/webhooks), then fetches current subscription state from Stripe. Duplicate and delayed deliveries reconcile current state. A monotonic observation timestamp prevents an earlier reconciliation from overwriting a later one. Database failures return a non-success status so Stripe retries. Only active/trialing subscriptions with a current billing period unlock Pro; past-due, unpaid, incomplete, paused and expired subscriptions do not. Cancellation at period end keeps access through the paid period.

Checkout is server-created using the signed-in account and configured price. Client request fields cannot choose a user, customer, price or return URL. Returning from Checkout does not grant access: the account refreshes Stripe state before showing Pro. Monthly usage keys follow the verified account and billing period; resetting browser cookies cannot reset paid usage. Paid requests use separate daily global spend caps from the anonymous demo.

## Verify before enabling live payments

In Stripe test mode, complete Google sign-in, subscribe using a test card, confirm Pro in `/account` and the tutor, and check that paid questions and voice count against account limits. Verify duplicate checkout clicks, cancellation through the portal, payment failures and webhook retries. Sign out and confirm the free allowance applies again; boards must remain saved. These flows require your own configured Supabase project and Stripe sandbox; local unit tests mock the external services.

The React Flow and perfect-freehand canvas dependencies permit commercial use under their MIT licenses; no canvas license key is required.

## Implementation boundaries

Account boards keep a working copy in the browser and save to the account a moment after edits stop. Saves carry a version: a save from a stale copy is refused, and that device's edits are kept as a separate board instead of overwriting newer work. Natural-voice recordings support audio seeking within a sentence; browser synthesis has no seekable audio, so replay starts that sentence again. Explanations recorded with voice off replay silently. Existing conversation history predating recordings remains readable but cannot be replayed.

Subscriptions and payment details remain in Stripe and Supabase. Signed-in boards, files and audio are stored in Supabase; demo boards stay in the browser and can be lost if site storage is cleared. Refund and dispute decisions are handled by the operator in Stripe; this implementation does not automatically revoke access for a refund while its subscription remains active.
