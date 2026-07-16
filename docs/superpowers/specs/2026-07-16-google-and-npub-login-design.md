# Google Login (Pomegranate) + Read-Only npub Login — Design

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan

## Goal

Add two new login methods to edufeed-app, each independently deployment-gated via `.env`:

1. **Login with Google** — Google OAuth mapped to a Nostr identity via the Pomegranate
   FROST threshold-signer protocol (fiatjaf's promenade), as shipped by Jumble.
2. **Read-only npub login** — browse the app as any pubkey without signing ability.

## Background / research findings

- **Jumble** (web) uses **Pomegranate**: a random Nostr key is generated client-side,
  FROST-sharded (default 3-of-5) to independent community-run operator servers, and Google
  OAuth (via a central server, `auth.njump.me`) only proves identity for registration,
  login lookup, and shard recovery. After setup the account is an ordinary **NIP-46 bunker
  account**; the central server coordinates threshold partial signatures. Same Google
  account → same npub on any device via server-side email→pubkey lookup.
- **Wisp** (Android) uses a different model (PIN-encrypted nsec backup in the user's Google
  Drive appDataFolder). Not chosen: nothing reusable (Kotlin), PIN-loss = key-loss, more
  code to write and maintain.
- **Deterministic key derivation from the Google identity is a known dead end**: Wisp
  shipped `sha256("wisp-account-v1:" + sub)` and reverted it within a day — the `sub`
  claim is visible to every OAuth client of a Google account, so any of them could
  regenerate the nsec offline. Both features below use random keys.

**Decision:** Pomegranate on the existing public infrastructure, with all server URLs
env-configurable so a deployment can point at a self-hosted promenade (Go, open source)
later without client changes.

## Decisions made during brainstorming

| Question | Decision |
| --- | --- |
| Trust model / infra | Pomegranate, public infra by default, URLs env-configurable |
| New-Google-user onboarding | Reuse the existing signup wizard steps (profile, interests, communities, publish kind 0 / 10015 / 30000 / 10050 / 10002 defaults) |
| nsec backup step at Google signup | Optional/skippable "download your recovery key" step; nsec export always available later in settings |
| Read-only UX for write actions | CTAs stay visible; clicking prompts "you're browsing read-only — log in with a signing method"; read-only badge in account menu; DM/inbox decryption disabled with explanatory empty state |
| Feature flag defaults | Both features **off** by default — existing deployments unchanged until they opt in |

## 1. Configuration

New env vars, following the `MEMBERSHIP_ENABLED` pattern
(`src/routes/api/config/+server.js` → `defaultConfig` + merge block + getter in
`src/lib/stores/config.svelte.js` → UI gate):

```bash
GOOGLE_LOGIN_ENABLED=false
POMEGRANATE_CENTRAL_URL=https://auth.njump.me/
POMEGRANATE_OPERATOR_URLS=https://po.jumble.social/,https://po.coracle.social/,https://po.njump.me/,https://po.f7z.io/,https://po.nostrver.se/
NPUB_LOGIN_ENABLED=false
```

Exposed as `runtimeConfig.googleLogin.{enabled,centralUrl,operatorUrls}` and
`runtimeConfig.npubLogin.enabled`. The FROST threshold is computed, not configured:
`ceil(operatorCount * 7/12)`, minimum 2 operators (matches Jumble; YAGNI on an extra
env var).

## 2. Google login (Pomegranate)

### Dependency

`@fiatjaf/promenade-trusted-dealer` — published on JSR; installed as
`npm:@jsr/fiatjaf__promenade-trusted-dealer` with an `@jsr:registry=https://npm.jsr.io`
line added to `.npmrc` (same setup as Jumble). Provides `trustedKeyDeal`,
`hexShard`/`hexPubShard`, `decodeShard`, `aggregateSecretKeyShards`.

### New service: `src/lib/services/pomegranate.js`

Protocol client, pure functions where possible, no Svelte state:

- `authenticateWithGoogle(centralUrl)` — `window.open` popup to
  `{central}/login/google`; central runs the Google OAuth dance and `postMessage`s back a
  base64 identity token (Nostr-event-shaped JSON with `created_at` + `["email", …]` tag,
  valid 24 h). Decode + validate expiry. The SPA never talks to Google directly — no
  Google SDK, no Firebase.
- `getAccount(centralUrl, token)` — `GET {central}/account` with
  `Authorization: Token <raw>`; returns the registered pubkey for the email, or null.
- `createAccount({secretKey, token, centralUrl, operatorUrls, threshold})` —
  1. `trustedKeyDeal(masterSk, threshold, n)` in the browser;
  2. kind **20445** account-registration event (tags `["threshold", n]` + one
     `["operator", url, hexPubShard]` per operator), signed with the master key,
     `POST {central}/register`;
  3. kind **20444** operator-registration events (content = `hexShard(shard)`, tags
     `["central", url]`, `["email", email]`), signed with the master key,
     `POST {operator}/po/register` in parallel with an `X-Pomegranate-Session`
     correlation header. Failures tolerated while registered operators ≥ threshold;
     below threshold → abort, surface error, activate nothing.
- `getBunkerUrl(centralUrl, token)` — `GET/POST {central}/profiles` → build
  `bunker://{handler_pubkey}?relay=wss://{central-host}`.
- `recoverNsec({centralUrl, operatorUrls, expectedPubkey})` — per-operator popup to
  `{operator}/po/recover/google` (each independently re-proves Google identity), collect
  shards, validate against registered pubshards, `aggregateSecretKeyShards` once ≥
  threshold, verify `getPublicKey(sk) === expectedPubkey`.

### Login flow

Rendered through the existing modal system (`ModalManager.svelte` / `modal.svelte.js`).
`LoginModal.svelte` gains a "Continue with Google" button (gated on
`runtimeConfig.googleLogin.enabled`), leading to a `LoginWithGoogle` step:

- **Existing account** (central knows the email): fetch bunker URL → the existing
  bunker path: `NostrConnectSigner.fromBunkerURI` → `registerBunkerAccount(manager,
  pubkey, signer)` (`src/lib/helpers/bunker-connection.js`). The account gets metadata
  (via `manager.setAccountMetadata`) storing the central URL — this marks it as a
  Google/Pomegranate account for badging and settings-export.
- **New account**: generate key in browser (`generateSecretKey()`), show **skippable**
  "download your recovery key" step (copy + download buttons, prominent Skip), then
  `createAccount(...)` → bunker login as above → hand off to the signup wizard's
  profile/interests/communities steps. `SignupModal.svelte` gets a mode where the
  account already exists (skips its own keygen/step-1 account creation); its
  `finishSignup()` publishes kind 0, 10015, 30000, 10050, 10002 exactly as today,
  signed through the bunker signer.

### Settings

"Export private key" action for Pomegranate accounts (visible when the account metadata
carries a central URL): runs `recoverNsec` and shows the nsec with copy/download. This
is the exit hatch that makes the skippable backup step acceptable.

### Signer-compatibility verification (do this first)

Jumble signs via nostr-tools' NIP-46 client; we use applesauce's `NostrConnectSigner`.
Protocol-identical on paper, but implementation starts with a live verification script
(Node, per project practice of verifying against live relays) that completes a full
sign round-trip against `wss://auth.njump.me` before any UI is built. If
`NostrConnectSigner` turns out incompatible, the fallback is a thin dedicated signer
wrapper — decision deferred until evidence exists.

## 3. Read-only npub login

Applesauce already ships the pieces: `ReadonlyAccount` / `ReadonlySigner`
(`ReadonlyAccount.fromPubkey()` accepts hex or npub; `signEvent` and all nip04/nip44
methods throw), and `registerCommonAccountTypes(manager)` in
`src/lib/stores/accounts.svelte.js` already registers the `readonly` type — so
localStorage persistence round-trips with no changes.

- **UI:** `LoginModal.svelte` gains a "Browse as npub (read-only)" method button (gated
  on `runtimeConfig.npubLogin.enabled`) → new `LoginWithNpub.svelte` step: paste
  npub/hex, validate via `nip19.decode`, `ReadonlyAccount.fromPubkey()` →
  `manager.addAccount` + `manager.setActive` (add-or-activate like
  `registerBunkerAccount`).
- **Write gating:** new `canSign(account)` helper in the accounts store
  (`account.type !== 'readonly'`), plus a shared `requireSigning()` guard used at
  write-action entry points (e.g. `educational-actions.svelte.js`, publish/compose
  paths) that shows a toast/modal: "You're browsing read-only — log in with a signing
  method to do this." Write CTAs remain visible.
- **Badging:** "read-only" badge in `AccountProfile.svelte` (account list) and
  `AccountMenuSection.svelte` (account menu).
- **DM/inbox guard:** `initializeDMs` (accounts store, Step 10) is skipped for readonly
  accounts (gift-wrap decryption needs nip44 and would throw); DM/inbox pages show an
  explanatory read-only empty state. Non-decrypting notifications still work.
- **Safety net:** `ReadonlySigner.signEvent` throws — any missed gate surfaces as a
  caught error toast rather than a silent failure.

## 4. Error handling

- Popup blocked → inline hint to allow popups for the site.
- Identity token expired (24 h validity) → transparent re-run of the popup.
- Operator registrations below threshold at signup → abort with a clear error; no
  partially-registered account is added or activated.
- Central-server account mismatch (Google email maps to a different pubkey than the
  local account) → explicit error on export/disconnect flows, mirroring Jumble's guard.
- Bunker connect timeout → existing `wrapBunkerSigner` 90 s timeout handling applies
  unchanged (`type === 'nostr-connect'`).
- Readonly sign attempt → friendly toast via the safety net.

## 5. Testing

- **Unit** (`src/lib/__tests__/`): pomegranate service with mocked `fetch` — token
  decode/expiry, kind 20445/20444 payload shapes, threshold math, below-threshold
  abort; `canSign` / `requireSigning`; config parsing defaults (flags off, default
  URLs).
- **Component** (`src/lib/components/__tests__/`): `LoginWithNpub` (valid npub, hex,
  invalid input, flag off → hidden), Google button gating, read-only badge rendering.
- **E2E** (`e2e/`, update `COVERAGE.md`): one npub-login flow — login with a pasted
  npub → badge visible → a write CTA prompts the read-only message. No Google E2E
  (external OAuth); replaced by a manual verification checklist against the live
  servers (popup auth, new-account registration, cross-device login, settings export).

## 6. Delivery phases

1. **Phase 1 — npub read-only login.** Small, self-contained, no external deps. Builds
   `canSign`/`requireSigning` gating and badging that phase 2 reuses.
2. **Phase 2 — Google/Pomegranate login.** JSR dependency, live signer verification,
   pomegranate service, login flow + signup-wizard integration, settings export.

## Out of scope (explicitly)

- Binding an *existing* nsec account to Google (Jumble's `PomegranateBindDialog`) — can
  be a follow-up.
- Disconnect-from-Google flow (`DELETE {central}/account`) — follow-up alongside bind.
- Self-hosting promenade on the homelab — enabled by the env vars, but a separate ops
  project.
- User-configurable operator lists / threshold in the UI (Jumble's "Advanced options")
  — deployment-level config only.
