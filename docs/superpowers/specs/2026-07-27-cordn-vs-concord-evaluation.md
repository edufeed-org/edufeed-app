# Cordn vs. Concord — Evaluation for Edufeed Private Groups

**Date:** 2026-07-27 · **Status:** Spike complete, decision open
**Tracks:** Concord = `worktree-concord-private-channels` (Phase 1 built). Cordn = `worktree-cordn-groups` (this spike).

## Why

Edufeed's open Communikey communities need a complement for private/closed groups. Two candidate protocols, both Nostr-identity-based, with opposite architectures. Sources: Cordn specs 00–03 + application specs (github.com/Cordn-msg/cordn), CORD-01…07 (github.com/concord-protocol/concord), and cloud fodder's articles "Concord vs. Nostr Relay Infrastructure" (2026-07-26) and "Concord and NIP-29" (2026-07-12).

## The two models in one paragraph each

**Concord** — "keys are the server." Kind-1059 giftwrap-lookalikes on plain Nostr relays with NIP-59 inverted (fixed stream author derived from a shared group secret, random `p` tag). Membership = key possession; authority = signed edition chains every client re-verifies from the owner key. Relays are dumb ciphertext buckets; history lives on relays + device caches.

**Cordn** — MLS (RFC 9420, `ts-mls`) plus a self-hosted **coordinator** (Docker/SQLite) that stores KeyPackages, Welcomes, and ordered opaque message streams sealed with per-epoch MLS exporter keys (ChaCha20-Poly1305). Clients reach it over **ContextVM** (MCP-over-Nostr) — relays carry only generic encrypted RPC; **nothing persists on public relays**. Messages are unsigned Nostr-shaped envelopes (kinds 9/1111/7 — the kinds edufeed already renders).

## Comparison

| Dimension | Concord (CORD-01…07) | Cordn (MLS + coordinator) |
|---|---|---|
| **Trust anchor** | Shared symmetric keys; no server holds keys | MLS group state; coordinator content-blind but trusted for delivery/ordering/availability |
| **Infrastructure** | ~5 community-chosen open relays (incompatible with NIP-17 inbox relays) | One coordinator (self-hosted, migratable) + any relays as transport |
| **Messages live** | On relays as 1059 ciphertext + device caches | On the coordinator (SQLite) as opaque sealed blobs |
| **Encryption** | NIP-44 shared keys; **no FS/PCS within an epoch** — one device compromise leaks (usually all) history | MLS: **forward secrecy + post-compromise security**, rotation on every membership change |
| **History for joiners** | Full (invite hands over all epoch keys) | **None by default** (MLS property) |
| **Roster** | Floor only — **invisible lurkers possible** until next rekey | Exact — MLS tree *is* the member list, no lurkers |
| **Invites** | Link bundles, direct giftwrap, un-gateable key whisper | KeyPackage-based Add + coordinator-mediated join requests/Welcomes; no whisper |
| **Moderation** | Ban = client-side filter; real exclusion = heavyweight Refounding; old epochs floodable forever | Remove = MLS commit, immediate cryptographic exclusion |
| **Spam control** | Relay can't distinguish members → IP throttles/AUTH/payment/PoW only | Coordinator authenticates callers → per-pubkey rate limits + KP quotas built in |
| **Deletion** | Any keyholder can delete anything relay-side (cloud fodder's headline risk) | Coordinator-mediated; members can't wipe the store |
| **Metadata** | Relays get a rich anonymous traffic graph; Concord traffic distinguishable from real giftwraps | Coordinator sees pubkey↔gid activity (one chosen party); relays see generic ciphertext. Read/locate split |
| **Push** | Wake-and-fetch only; rekeys break registrations; keyholder bot = trust-heavy answer | Coordinator is a natural opaque-ping push point |
| **Multi-device / NIP-46** | Keys are strings — trivially portable; bunker-compatible by design | Hard: per-device MLS state; sync app-spec exists but complex |
| **Offline resilience** | Excellent (relay redundancy) | Coordinator must be up; cursor catch-up on return |
| **Scale ceilings** | 64KB NIP-44: ~500 banlist, ~400-member snapshots, 120-recipient rekeys | MLS tree scales; ceilings operational |
| **Deniability** | Non-repudiable (real-npub seals) | Unsigned envelopes → deniable outside the group |
| **Ecosystem** | Rigorous specs, Armada/Accordion emerging, Vector variant, Newlay relay support | Draft specs, single team, but runnable today (Docker + web/Android client) |
| **Edufeed status** | **Phase 1 built & tested**, relay live | **Spike complete** (this doc) |

## Spike results (all verified 2026-07-27)

1. **Coordinator deployed** on the homelab (docker-host, `/opt/cordn`, SQLite, `ghcr.io/cordn-msg/cordn:latest`). Pubkey `3f86268a2abd47cb50147067d5868aa47a07a6fa6c4affde0cc67167aef073e2`, outbound-only via `wss://relay.contextvm.org` — no Traefik/ports/subdomain needed. Ansible role on homelab branch `cordn-spike` (uncommitted).
2. **Reference CLI round trip** against that coordinator: create → add-member → welcome → live bidirectional messages (CEP-41 streaming). Cordn repo's own suite: 272/272 tests pass locally.
3. **In-app probe** (`/labs/cordn`, flag `CORDN_GROUPS_ENABLED`): full two-account MLS lifecycle **in the browser** — create group, invite by pubkey, accept welcome, bidirectional kind-9 messages — against the homelab coordinator. Verified by `e2e/cordn-groups.test.js` (2-context Playwright, real network, passes in ~2.5 min).
4. **Flag-off gate**: page shows "nicht aktiviert", zero ContextVM/wss traffic (verified via browser network inspection). Same standard as `CONCORD_ENABLED`.

### Feasibility answers

- **(a) MLS state in the browser:** works. `ts-mls` runs fine under Vite/SvelteKit; ClientState serializes via `clientStateEncoder` into IndexedDB (`cordn:<pubkey>` namespace). cordn-web (SvelteKit + applesauce v6 — *our exact stack*, MIT) is a proven reference and a rich source for copy-adaptation.
- **(b) Signer compatibility:** positive. `@contextvm/sdk`'s `NostrSigner` interface = `getPublicKey`/`signEvent`/`nip44` — matches applesauce signers. The spike passes the account signer for identity-bound calls (KeyPackage publish/consume, Welcome store/fetch) and a random ephemeral signer for message traffic (coordinator can't link posts to npubs). Verified with nsec accounts; NIP-07/NIP-46 should work via the same interface but need a prompt-volume check (transport signs one event per identity-bound RPC).
- **(c) Bundle/SSR:** clean. All Cordn code behind `src/lib/cordn/` (ESLint `no-restricted-imports` guard), dynamically imported from the ssr=false route only; barrel exports only SSR-safe pure helpers. New deps: `ts-mls`, `@contextvm/sdk`, `@contextvm/mcp-sdk`, `@noble/ciphers`.

### Spike limitations (deliberate, Phase-2 material)

- Poll-based sync (3s bounded fetch), no CEP-41 live streams.
- No group-metadata MLS extension (group names local-only); capabilities advertised for cordn-web interop.
- Welcome finalized optimistically (post commit → store welcome immediately) instead of cordn-web's pending-epoch-operation reconciliation; no snapshot/recovery machinery, no sibling-skip multi-device handling.
- No remove-member/admin UI, no media, no join-request links.
- Licensing: cordn **server** repo has no LICENSE — only cordn-web (MIT) code was adapted; keep it that way.

## Fit assessment

- **Classroom/institution-style closed groups** (known roster, teacher = admin, instant removal, no lurkers, push): **Cordn's model fits better** — at the cost of running a coordinator (trivial next to our existing relay fleet) and no pre-join history.
- **Loose private communities** (newcomers get history, relay-redundant durability, NIP-46 logins): **Concord fits better** — and Phase 1 is already built.
- They are complements, not substitutes: Concord ≈ private-community layer; Cordn ≈ Signal-grade closed group chat with Nostr identity.

## Open decision

Which track (or both) goes to production, and under which product surface (Concord = community channels tab; Cordn = standalone private groups?). Revisit after user testing of both feature branches.
