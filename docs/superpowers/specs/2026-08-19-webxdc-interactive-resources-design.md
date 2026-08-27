# Interactive Resources (webxdc / H5P) — Design

**Date:** 2026-08-19
**Status:** Approved design, pre-implementation
**Phases:** 1 = viewer + publishing (this plan's target), 2 = shared community sessions, 3 = results layer

## Goal

Let educators publish interactive learning packages (H5P exports, webxdc
apps, self-contained HTML) as first-class AMB resources, rendered inside
edufeed in a fully sandboxed, network-isolated player — and make every
published app discoverable by the wider Nostr ecosystem (Armada, Ditto)
via the NIP-DC convention. Later phases add shared state sessions inside
communities (quiz leaderboards, collaborative apps).

## Background: webxdc and NIP-DC

- **webxdc** (webxdc.org, from Delta Chat): a `.xdc` file is a ZIP with
  `index.html` at the root, `manifest.toml` (`name = "…"`), and
  `icon.png`/`icon.jpg`. Apps run sandboxed with **no network access**
  and interact only through `window.webxdc`:
  - `sendUpdate({payload, info?, document?, summary?})` — durable,
    serially-ordered shared state.
  - `setUpdateListener(cb, serial)` / `getAllUpdates()` — receive all
    updates (including one's own) in order.
  - `joinRealtimeChannel()` — ephemeral byte frames (≤128,000 bytes).
  - `selfAddr` / `selfName` — participant identity strings.
  The **host** replaces the app's bundled `webxdc.js` with its own
  bridge; apps only ship a simulator copy for local dev.
- **NIP-DC** (Soapbox draft; canonical doc: `NOSTR_WEBXDC.md` in the
  Ditto repo — not in nostr-protocol/nips): maps webxdc onto Nostr.
  - Apps are published/discovered as **NIP-94 kind 1063** file-metadata
    events with `m = application/x-webxdc`.
  - Chat attachments carry an `imeta` entry with the `.xdc` URL and a
    `webxdc` property = random session UUID scoping all state traffic.
  - State/realtime event kinds are per-transport: Ditto uses 4932/20932,
    Armada's NIP-29 mapping uses **9450** (durable state) / **24450**
    (ephemeral realtime) with `h` (scope) + `i` (session UUID) tags.
    We adopt the 9450/24450 pair (Phase 2).
- **Armada's sandbox**: iframe on a per-app HMAC-derived subdomain of
  `iframe.diy`, whose service worker proxies every same-origin `fetch()`
  to the parent window via JSON-RPC postMessage; the parent serves files
  from the unzipped archive in memory, injecting a `/webxdc.js` bridge
  and a strict CSP into every response.

**Licensing:** Armada is AGPL-3.0; edufeed-app is Unlicense. We
implement the sandbox protocol and NIP-DC convention **clean-room in
Svelte** from the spec/protocol docs. No Armada code is copied.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Scope | Design viewer + shared sessions now; implement in phases (Phase 1 viewer-only) |
| Sandbox host | Reuse `iframe.diy`, `SANDBOX_DOMAIN` runtime-configurable; self-hosting `*.sandbox.edufeed.org` is the documented fallback if terms/availability disappoint |
| Upload formats | `.h5p` (auto-wrapped client-side with bundled h5p-standalone player), `.xdc` (pass-through), self-contained `.html` (wrapped) |
| Event model | Kind 30142 AMB resource (edufeed-native) + one dual-purpose kind 1063 (license attestation **and** NIP-DC discovery) |
| Phase 2 kinds | 9450 / 24450 with `h` = community pubkey (Communikey scoping), `i` = session UUID |

## Section 1 — Event model & publishing

Every upload is normalized client-side into a `.xdc` ZIP:

- `.xdc` input: passed through unchanged (manifest/icon read for metadata).
- `.html` input: wrapped — file becomes `index.html`; `manifest.toml`
  generated from the form's title; default icon.
- `.h5p` input: wrapped via the h5p pipeline (Section 3).

The archive is uploaded to Blossom via the existing upload helpers
(NIP-98 auth), yielding URL + SHA-256. The icon (extracted or default)
is uploaded as a separate Blossom image.

Two events are then published:

### Kind 30142 (AMB resource)

Published through the normal resource wizard/publish path:

- Resource `id` (AMB) = the Blossom package URL.
- Default `learningResourceType` = hcrt *application* concept
  (educator-overridable). (Deferred to a follow-up — the wizard currently
  requires a manual pick.)
- NIP-32 labels: `["L","metadata-form"]` + `["l","interactive","metadata-form"]`
  so edit flows reopen the right variant (`resolveVariantFromEvent`).
- Additional tags: `["m","application/x-webxdc"]` (the launchability
  marker resource views key on) and `["x", <sha256>]` (execution-time
  integrity check, consistent with the image-license convention).

### Kind 1063 (dual-purpose NIP-94)

One event serves as **both** the license attestation (existing
image-license convention: `url`, `x`, `m`, `license`, `credit`,
optional `source`/`p`) **and** the NIP-DC discovery event:

- `m` = `application/x-webxdc`
- `alt` = `Webxdc app: <name>` (Armada/Ditto naming convention)
- `image` = icon URL, `size` = archive bytes
- `license` + `credit` per the edufeed license gate (which stays
  mandatory for uploads, exactly as for images).

Published to AMB relays + fallback relays so public NIP-DC clients
(Armada's app picker queries `{kinds:[1063],"#m":["application/x-webxdc"]}`)
can discover it. No new kind, no duplicate events.

### Deletion

`deleteEvent()` handles the 30142 as usual; the delete flow also issues
NIP-09 for the companion 1063 (looked up by `#x`).

## Section 2 — Sandbox player architecture

New self-contained module **`src/lib/webxdc/`**. Browser-only: consumed
exclusively from `ssr = false` routes behind dynamic-import guards
(same discipline as `src/lib/concord/`); none of it may enter SSR chunks.

| File | Responsibility |
| --- | --- |
| `SandboxFrame.svelte` | Clean-room iframe.diy protocol client. Renders `<iframe src="https://<id>.<SANDBOX_DOMAIN>/">`; JSON-RPC 2.0 over postMessage with strict `event.origin`/`event.source` checks; `ready` → (await archive ready) → `init`; `fetch` requests answered from the file map; injects `<script src="/webxdc.js">` into HTML responses and serves the bridge at that path (shadowing any bundled simulator); adds the CSP header to every response. Sandbox attrs: `allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads` — **never** `allow-top-navigation`. Cross-origin subdomain isolation is the primary boundary; sandbox attrs are defense-in-depth. |
| `xdc-archive.js` | Fetch archive → **verify SHA-256 against the `x` tag before execution** (mismatch = hard error, no launch) → unzip (`fflate`) → normalized path→bytes map; `extractMeta()` reads `manifest.toml` name + icon bytes (shared with the upload flow). |
| `webxdc-bridge.js` | Generates the injected `/webxdc.js` implementing `window.webxdc` (sendUpdate / setUpdateListener / getAllUpdates / joinRealtimeChannel / selfAddr / selfName, `sendUpdateMaxSize` 65536, realtime frame cap 128,000 bytes) via JSON-RPC to the parent. |
| `subdomain.js` | `label(resourceAddress)` = base36(HMAC-SHA256(device-local seed, address)); seed is a random UUID persisted in localStorage. Stable per device+app → origin-keyed storage persists; unguessable → other pages can't reach it. |
| `local-sync.js` | Phase 1 state backend implementing the **`AppSync` interface** (below): updates in memory, persisted to localStorage keyed by resource address; serials = array index + 1. |
| `WebxdcPlayer.svelte` | Launch card (icon, name, Launch) in the resource view → expands to the iframe stage with fullscreen toggle. Loading / error states. |

### The `AppSync` seam

```js
/** @typedef {{
 *   getUpdates: () => Array<{payload:any, info?:string, document?:string, summary?:string}>,
 *   sendState: (payload:any, meta?:object) => void,
 *   sendRealtime: (bytes:Uint8Array) => void,
 *   onRealtime: (cb:(bytes:Uint8Array)=>void) => (()=>void),
 *   subscribe: (cb:()=>void) => (()=>void)   // state-changed notifications
 * }} AppSync */
```

`WebxdcPlayer` takes any `AppSync`. Phase 1 passes `local-sync`;
Phase 2 passes `community-sync`. Nothing else changes.

`selfAddr` = user npub (or `anonymous`); `selfName` = display name.

### CSP (every served response)

```
default-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:;
base-uri 'self'; form-action 'self'
```

No external network, per the webxdc spec. `unsafe-eval`/inline are
required by real-world H5P/webxdc content.

### Config

`SANDBOX_DOMAIN` env → `runtimeConfig.webxdc.sandboxDomain`, default
`iframe.diy`. Verify iframe.diy's terms during implementation; if
restricted, deploy the equivalent shim on `*.sandbox.edufeed.org`
(wildcard DNS + cert on the homelab) and flip the env var.

## Section 3 — .h5p auto-wrapper

`src/lib/webxdc/h5p-wrap.js`, fully client-side:

1. Unzip the `.h5p` (ZIP: `h5p.json`, `content/`, library dirs).
2. Assemble file map: pinned **h5p-standalone** dist assets (npm dep,
   bundled as static assets — we own version updates) + package laid
   out as h5p-standalone expects.
3. Generate `index.html` (boots h5p-standalone on the local content;
   includes `<script src="webxdc.js"></script>`), `manifest.toml`
   (name from `h5p.json` title), icon (from content, else default
   H5P glyph).
4. Include the **xAPI shim** from day one: listens on
   `H5P.externalDispatcher` `xAPI` events, forwards statements via
   `webxdc.sendUpdate()`. Phase 1: updates land in local storage only
   (solo progress per device, harmless). Phase 2/3: the same shim feeds
   shared sessions — already-published packages need no re-wrap.
5. Re-zip → `.xdc` → normal upload path.

Guards: size warning above ~50 MB (archive is fetched + unzipped in
memory per launch); optional **pre-publish preview launch** in the
wizard so the educator can verify the package runs before signing.
Relaxed from mandatory during implementation (controller ruling): the
license disclosure is the publish gate; forcing a launch was judged
educator-hostile.

## Section 4 — UI surfaces (Phase 1)

- **Form variant `interactive`** in `resource-form-variants.js`
  (+ Paraglide label/description, env-gated via
  `RESOURCE_FORM_VARIANTS`). One variant-conditional wizard step: a
  package upload field following the `LicensedFileInput` pattern
  (accepts `.h5p`/`.xdc`/`.html`; wrap + preview inline; license modal
  → the dual-purpose 1063).
- **`AMBResourceCard`**: "Interactive" badge when the
  `m application/x-webxdc` tag is present (pattern: `LicenseBadge`).
- **`AMBResourceView`**: `WebxdcPlayer` launch card instead of a bare
  link.
- **Discover**: nothing — these are ordinary 30142 events in existing
  feeds/search. (Apps gallery / filter chip: YAGNI.)

## Section 5 — Phase 2: shared sessions in communities

> **Superseded (2026-08-25):** session state is now scoped to the NIP-29
> group id on the groups relay — see
> `2026-08-25-channel-webxdc-sessions-design.md`. The kinds (9450/24450)
> and AppSync seam below are unchanged; the `h` scoping and relay routing
> are not.

- **Sharing:** posting an interactive resource into community chat
  creates a kind-9 message with an `imeta` entry: `url`, `m
  application/x-webxdc`, `image` (icon), `webxdc <fresh-uuid>` —
  Armada's attachment convention. Chat rendering gains an
  attachment launch card; all launches from one message share the
  session. Each share mints a new UUID = a fresh session.
- **`community-sync.js`** implements `AppSync`:
  - Durable state: kind **9450**, tags `["h", communityPubkey]`,
    `["i", uuid]`, optional `info`/`document`/`summary` tags, JSON
    payload in `content`. Published via `publish-service` to community
    relays (enforced relays included → profile-list access control
    applies as for chat). Serial order = `created_at` (client-assigned
    serials); backfill query + live pool subscription mounted only
    while an app is open.
  - Realtime: **ephemeral** kind **24450**, same `h`/`i` tags, base64
    `Uint8Array` in `content`, ≤128,000 bytes raw; own echoes skipped.
- Sync kinds are **social content**: never curated/WoT-filtered
  (existing policy), excluded from feed queries by kind.
- **Interop note:** wire format matches Armada's NIP-29 mapping, but
  `h` scoping differs (community pubkey vs NIP-29 group id), so live
  cross-client sessions with Armada are out of scope. Kind-1063 app
  discovery interop (Phase 1) is full.

## Section 6 — Phase 3: results layer

The xAPI shim's statements are ordinary state updates in the shared
session. A results panel component aggregates completion/score
statements per participant (`selfAddr`) into a leaderboard/progress
view rendered alongside the chat attachment. Design detail deferred
until Phase 2 ships.

## Error handling

- Download failure / SHA-256 mismatch / missing `index.html` →
  distinct error cards in `WebxdcPlayer` (route-level
  `<svelte:boundary>` remains last resort only).
- Malformed `.h5p`/ZIP → wizard validation error before upload.
- Sandbox `ready` timeout → retry affordance.
- All tag-derived render inputs deduped per repo policy.

## Testing (TDD)

Unit (`src/lib/__tests__/` or module-local): `xdc-archive`
(unzip/normalize/manifest/hash-verify), `h5p-wrap` (file-map assembly,
generated index/manifest), `webxdc-bridge` (generated script content),
`subdomain` (stable derivation, distinct per address), `local-sync`
(serial ordering, persistence round-trip), dual-purpose-1063 builder,
30142 tag additions. Component: `WebxdcPlayer` states (launch card,
loading, error), `AMBResourceCard` badge. E2E: one happy-path
publish→launch flow after Phase 1 stabilizes. Phase 2: `community-sync`
event building/ordering against a mocked pool.

## New dependencies

- `fflate` (zip/unzip, ~8 kB)
- `smol-toml` or equivalent tiny TOML parser (manifest read/write)
- `h5p-standalone` (pinned; dist bundled as static assets)

## Open questions / risks

- **iframe.diy terms & uptime** — verify before Phase 1 ships;
  fallback: self-hosted shim on `*.sandbox.edufeed.org` (config flip).
- **h5p-standalone coverage** — some exotic H5P libraries may misbehave
  offline; the (now optional, not mandatory) preview launch is the
  best-effort safety net.
- **Archive size in memory** — accepted for Phase 1 (warning at 50 MB);
  streaming/caching optimizations only if real usage demands them.
- **Popup exfiltration (accepted):** `allow-popups-to-escape-sandbox` +
  user gesture lets a malicious package exfiltrate its own state via
  window.open URL params despite the no-network CSP. Same trade-off
  Armada makes; the sandbox protects the host app, not the package's own
  data.
