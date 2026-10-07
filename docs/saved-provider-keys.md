# Saved provider keys

Signed-in users may opt into **Remember my key on this account**, separately for the AI model and voice provider. Guests and users who leave it unchecked use page-only keys that disappear on refresh, navigation, page close and sign-out. Remembered keys survive sign-out but cannot be used until that account signs in again. Remove key deletes the active saved database row; encrypted historical backups may retain it until normal backup expiry. Revoke the provider key to invalidate it everywhere immediately.

## Deployment

Apply `supabase/migrations/202610060002_provider_keys.sql`. Generate a dedicated random 32-byte secret, base64 encoded, and set `LOCI_KEY_ENCRYPTION_SECRET` in the server environment. Never use a `NEXT_PUBLIC_` variable. Every deployment sharing a credential database must use the same encryption secret. The key is not stored in Postgres. The production and preview environments for Loci were configured through Vercel's sensitive environment variables. Local development uses the ignored `.env.local`.

Keep the encryption secret available securely in the deployment secret store. Losing it makes saved keys unrecoverable. Do not replace it as a routine environment change: existing rows must be decrypted with the old secret and re-encrypted with the new secret in a controlled migration before the old secret is retired. The `v1` ciphertext envelope provides a format version for future migrations; automatic key rotation is not implemented.

## Protection and request behavior

Each row stores only account ID, credential kind, ciphertext and update time. AES-256-GCM uses a fresh random 96-bit nonce and authenticates the account ID, kind and format version. Provider, model, voice ID and raw key are all inside the authenticated encrypted payload. Moving a ciphertext to a different account or credential kind fails decryption. RLS is enabled with no browser policies; PUBLIC, anon and authenticated roles have all table privileges revoked. The service role is the only application role allowed access, and every server query filters by the verified account ID and credential kind. No request-supplied user ID is accepted.

`GET /api/keys` returns only provider/model/voice settings and saved status, never the key or ciphertext, with private no-store caching. `PUT` validates fixed providers and bounded credentials, encrypts before upsert, and can update settings with a blank key only when the saved provider matches. `DELETE` removes only the caller's selected credential kind. Mutations reject cross-origin requests. Failed storage, authentication, decryption or explicit personal-key requests do not silently fall back to Loci's paid credentials. Upstream errors are sanitized.

Client memory stores either a raw page-only key or a saved reference. References send `x-loci-saved-ai: 1` / `x-loci-saved-voice: 1`; the server verifies the session and loads that account's credential. Direct page-only credentials take precedence. The client restores references from metadata on page load and clears memory on page hide/sign-out. The browser never receives saved raw keys.

A personal Fish key covers TTS and ASR, including bounded live transcription previews, bypassing Loci's hosted allowances for both. Fish bills those requests to that key. ElevenLabs keys cover TTS only; microphone transcription retains hosted Fish limits. Audio is forwarded for transcription and is not persisted by the transcription endpoint. Personal provider keys can still incur costs if the user's account is compromised; provider spending limits remain useful. A compromised application server with the encryption secret can decrypt stored keys.

## Verification

Tests cover randomized ciphertext, account/kind binding, tampering, missing encryption configuration, metadata secrecy, authenticated ownership, settings updates without secret disclosure, deletion, cross-origin writes, strict input validation, page-only precedence and no owner-key fallback. Endpoint tests cover personal Fish ASR bypassing exhausted hosted limits while ElevenLabs retains hosted transcription limits.
