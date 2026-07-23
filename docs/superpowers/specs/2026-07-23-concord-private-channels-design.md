# Private Kanäle: Concord (applesauce-concord) Integration — Design Spec

**Date:** 2026-07-23
**Status:** Approved design, pending implementation plan
**Design prototype:** claude.ai/design project `d5844719-c637-42ed-b6bc-954cdc56d585`, files `Armada-Edufeed-Integration.html` + `pk-data.jsx` / `pk-views.jsx` / `pk-app.jsx` ("Private Kanäle" prototype)
**Dev brief:** provided by Steffen 2026-07-23 (Concord/CORD integration, Phase 1)

## 1. Objective

Add E2E-encrypted group channels ("Private Kanäle") to existing Communikey
communities using the Concord protocol (CORD-01/02/03) via the
`applesauce-concord` package. Phase 1: encrypted channels inside existing
communities, behind a feature flag, on a dedicated relay. The CORD specs are
NOT hand-implemented — the package is adopted and wrapped.

## 2. Decisions (settled with Steffen, 2026-07-23)

| # | Question | Decision |
|---|----------|----------|
| 1 | Granularity | **One Concord community per Communikey community** ("private area" alongside the existing public area). Each *privater Kanal* = a **CORD-03 private channel** inside it (independently keyed, own epoch/rekey lifecycle, subset membership). Verified: `applesauce-concord` ships `client/private-channel.ts` implementing exactly this. |
| 2 | Association | **Public pointer in kind 10222** (community definition). Existence of a private area is public; channel names, members, and all activity stay encrypted per CORD-01. |
| 3 | Founding permission | **Community owner only** (whoever holds the community signer — works for both current-keypair and new-keypair communities, since new-keypair community signers are registered with the account manager; see `EditCommunityModal.svelte` `isOwner = !!communitySigner`). |
| 4 | Relay | **Dedicated `concord.edufeed.org`** (new strfry on the homelab), deployed as part of this work. `relay.edufeed.org` is unsuitable: its author-based policy shadow-drops events from unknown pubkeys, and Concord stream authors are throwaway derived keys. `dm.edufeed.org` stays DM-only. |
| 5 | Backup scope | **Guidance only** in Phase 1: key bar + backup modal with "second device" instructions and the existing nsec-export path for npub-login accounts. Encrypted backup-file export/import is a later phase. |

## 3. Model mapping

### 3.1 Identity and keys

- The Concord community is founded with the **owner's personal key**, not the
  community keypair. Rationale: the personal signer does day-to-day crypto
  (signing own rumors, NIP-44-to-self for the kind 13302 Community List /
  13303 Invite List), and 13302 gives multi-device sync on the key the human
  actually uses. Owner-key loss risk stays on a key with existing backup
  affordances.
- The **community signer is used exactly once** per community: to publish the
  pointer tag into kind 10222.
- Community-plane crypto is symmetric and local — no signer round-trips for
  reading/decrypting.

### 3.2 Pointer tag (kind 10222)

A new tag on the Communikey community definition:

```
["concord", "<community_id>", "<relay-url>"]
```

- `community_id`: CORD-02 community id (lowercase hex,
  `sha256("concord/community" || owner_xonly || owner_salt)`).
- `relay-url`: primary Concord relay for this community (the Concord
  community metadata carries its own full relay list; this hint bootstraps).
- Parsing lives next to `parseCommunityMetadata` in
  `src/lib/helpers/communityRelays.js` (pure function, unit-tested).
- Absence of the tag = community has no private area; the "Private Kanäle"
  rail section shows only the owner's "found the private area" affordance
  (owner) or nothing (non-owner, no invites).

### 3.3 Membership and channels

- Holding `community_root` IS Concord-community membership. Members of any
  private Kanal are necessarily Concord-community members.
- Each Kanal is a CORD-03 private channel: own key + epoch chain derived
  against community join material; syncs and rotates independently.
- **Kick** (entfernen): remove from channel; re-invitable. **Ban** (sperren):
  channel rekey ("neues Schloss") + banlist entry; already-received messages
  remain readable on the removed device (communicated honestly in the confirm
  dialog, as in the prototype).
- Member list = coalesced guestbook ∪ observed authors − banlist (CORD-02,
  off-consensus). The UI labels it as approximate, per the prototype
  ("kann ein paar Minuten hinterherhinken").
- Roles come from the Concord control plane (folded roles/grants editions),
  surfaced as Gründer:in / Admin / Mitglied. Grant-revoke rank-gating follows
  the package's strict reading (see `packages/concord/UPSTREAM-NOTES.md` —
  read before assuming spec behavior anywhere).

## 4. Package and wrapper module

- Dependency: `applesauce-concord@0.0.0-concord-20260714212055` — **exact
  pin** (latest `concord` dist-tag as of 2026-07-23; verified on npm).
  Version bumps are deliberate: review diffs, run the package's own vitest
  suite as a canary.
- All package imports go through **`src/lib/concord/`** (thin app-local
  wrapper) so pre-1.0 churn is contained in one directory:
  - `client.svelte.js` — `ConcordClient` lifecycle: one instance per
    logged-in session, created after login and `configReady`, torn down on
    logout. Options: `signer` = active account's signer, app `RelayPool`,
    `autoUnlock: false` (no signer calls or publishes during initial sync;
    unlock self-encrypted events on user action).
  - `storage.js` — the IndexedDB adapter (§5).
  - `bridge.svelte.js` — RxJS→runes bridges following the app's existing
    loader/model pattern (`$effect` subscribe + cleanup; `$state.raw()` for
    event arrays).
  - `pointer.js` — 10222 pointer build/parse helpers.
  - Components import only from `$lib/concord`, never from
    `applesauce-concord` directly (enforced by an ESLint
    `no-restricted-imports` rule scoped to everything outside `src/lib/concord/`).
- `startDirectInviteWatcher()` is started only when the signer exposes
  `nip44Decrypt`; otherwise direct-invite receive degrades gracefully
  (link invites still work).

## 5. Storage (IndexedDB)

Implements the verified package contracts:

- **`ConcordStorage`** — async KV (`getItem`/`setItem`/`removeItem`) for
  membership material, keys, sync cursors. Backed by one IndexedDB
  object store; namespaced per account pubkey so multi-account sessions don't
  bleed.
- **`ConcordStoreFactory`** — `(communityId, planeKey) => AsyncRumorStore`
  returning an IndexedDB-backed rumor store per community+plane
  (`CachePlane = "control" | "guestbook" | "channel"`; the package caps
  channel cache at 300 entries, control/guestbook kept whole).
- Check first whether applesauce v6.2's async storage interfaces or the
  existing DM decryption cache can be reused before writing new plumbing.
- Data is deletable: leaving/`leave(cid)` and logout clear the relevant
  stores.
- Unit tests run the adapter against the package's store contract.

## 6. Configuration, modes, relay

- **`CONCORD_ENABLED`** (default `false`) following the `MEMBERSHIP_ENABLED`
  pattern → `runtimeConfig.concord.enabled`. All UI hidden when off.
- **`CONCORD_RELAYS`** → `runtimeConfig.concord.relays`. Not routed through
  gated-mode category helpers — Concord has its own relay semantics.
- **Curated/WoT/gated:** kind 1059 is excluded from author filtering
  entirely (spam control is key possession + in-protocol moderation), same
  reasoning as the ungated inbox decision (issue #43).
- **Relay deployment (in scope):** new strfry `concord.edufeed.org` via the
  homelab Ansible repo. Policy (awk/sh only — BusyBox container):
  - store kind 1059; drop ephemeral 21059 (must not store);
  - reject gift-wrap deletion by author; allow deletion by `p` tag only
    (NIP-59/CORD-01);
  - no NIP-42 pubkey allowlisting for these kinds.

## 7. UI (implements the "Private Kanäle" prototype)

Location: the community page (`/c/[pubkey]`), new "Kanäle" area integrating
with the existing chat. German-first copy from the prototype; all strings via
Paraglide (de + en). Beta badge everywhere the prototype shows it.
Beware the known community-layout double-mount (2–3× children render): gate
expensive Concord work accordingly.

| Prototype element | Behavior |
|---|---|
| Rail: public channels | Existing kind-9 community chat, unchanged. |
| Rail: "Private Kanäle" section | Visible when the flag is on AND (the user has Concord membership OR the 10222 pointer exists OR the user is the owner). Members see their channels (bridged client models, unread badges) + the invite inbox; non-members see only the invite inbox / "open your invitation" note; owners without a founded private area see the founding affordance. Flag off, or no pointer + no membership + not owner → section absent. |
| "Neuer privater Kanal" | Owner only. 3-step wizard: Grundlagen (name/desc) → Einladen (initial direct invites) → Wichtig zu wissen (key-loss disclosure + mandatory checkbox). First channel creation also founds the Concord community + publishes the 10222 pointer (community signer). |
| Invite sheet | Tabs: Link & QR (revocable link — revoke = new invite key, members unaffected) and Direkt (NIP-59 kind 3313 to selected members; requires recipient DM-reachability; sender needs nip44 — otherwise tab disabled with hint). |
| Einladungen inbox | Direct-invite watcher results; accept = `joinByBundle`, decline discards. |
| Join by link | `joinByLink(url)`; join pane with community context, founder, verified badge; revoked-link error state. |
| Members modal | Model-derived list with approximation note; roles; kick/ban actions with distinct confirm dialogs (ban explains rekey + honest limits). |
| Key bar + backup modal | Dismissible bar; modal = second-device guidance + nsec export for npub-login accounts (Phase 1 scope). |
| Explainer | Static modal ("Wie sind private Kanäle geschützt?"). |
| State panes | History-sync progress (from sync observables), new-device sync, removed-from-channel, dissolved channel (tombstone, read-only input), revoked link. |
| Ghost messages | Rumors that fail to decrypt yet (newer epoch) render as placeholder bubbles; resolved automatically when rekey arrives. |
| Message rendering | Kind-9 rumors reuse existing chat message components (NIP-C7 shape matches the app's kind 9); replies 1111, reactions 7, deletes 5 as in existing chat. |
| Kanal auflösen | Owner-only dissolve → tombstone state. Mapped to a control-plane metadata edition; exact mechanism verified against the package during planning (best-effort if no first-class support — flagged as an upstream question). |

Multi-community targeting, typing indicators (23311), edits (3302), voice,
webxdc: **out of scope** for Phase 1 even where the package supports them.

## 8. Testing

- **Unit** (`src/lib/__tests__/`): storage adapter vs. package store
  contract; pointer build/parse; wrapper lifecycle logic; flag gating.
- **Component** (`src/lib/components/__tests__/`): create wizard (step
  gating, disclosure checkbox), invite sheet (tab states, nip44
  degradation), members modal (role rendering, action gating), state panes.
- **E2E** (Playwright, nix shell, two browser contexts): create channel →
  invite via link → join → exchange messages both ways → ban member →
  verify banned context stops decrypting new messages. Update
  `e2e/COVERAGE.md`.
- **Canary:** package's own vitest suite on every version bump.
- Cross-client debugging reference: Armada (GitLab, likely AGPL — compare
  behavior only, never copy code) + spec `examples.md` for byte-exactness.

## 9. Risks and mitigations

- **Pre-1.0 churn:** exact pin + wrapper module + import lint rule; canary
  suite on bumps.
- **Key loss = permanent lock-out; no owner succession:** disclosure step in
  wizard (mandatory checkbox), key bar, backup guidance; recommend
  NIP-46/bunker where applicable. Data labeled Beta/experimental.
- **Pomegranate/FROST nip44 support unverified:** feature-detect
  `nip44Decrypt`; degrade direct invites to link invites.
- **NIP-44 65,535-byte plaintext cap:** enforced by the package at every
  nesting layer; UI surfaces oversized-message errors rather than silently
  failing.
- **Relay misrouting:** Concord traffic goes only to `CONCORD_RELAYS`; never
  through amb-relay or author-policy relays. Publish paths in the wrapper,
  not `publishEvent()`'s outbox union.
- **Spec ambiguity:** `UPSTREAM-NOTES.md` is authoritative for the package's
  resolutions (e.g. strict Grant-revoke rank-gating).
- **Upstream coordination:** open a dialogue/issue with hzrd149 as an early
  Svelte adopter (his reference client is React); "extraction in progress"
  note in index.ts means API surface may still move.

## 10. Out of scope (Phase 1)

- Encrypted backup-file export/import (§2 decision 5).
- Typing indicators, message edits, voice, webxdc, emoji-pack integration.
- Read-side enforced-relay filtering (pre-existing deferred Communikey work).
- Migration of existing public chats into private channels.
- Any hand-implementation of CORD specs.
