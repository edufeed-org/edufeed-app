# Channel webxdc sessions — collaborative apps in NIP-29 channels

Date: 2026-08-25 · Status: designed, awaiting implementation plan

## Context

Communities now have real NIP-29 channels (branch `feat/community-group-pointer`,
groups relay = edufeed pyramid fork). The webxdc Phase-1 viewer is merged: any
interactive resource (`.xdc`) can run sandboxed with solo, local-only state.
This spec designs the next step: **launching webxdc apps inside a channel with
shared, relay-backed state** — the flagship use case being a collaborative
markdown pad (webxdc/editor, Yjs + ProseMirror) that a working group opens in a
channel, edits together, resumes later, and finally publishes as a community
document.

The mechanism is general (any webxdc app: pads, quizzes, polls, games); the pad
drives the requirements.

Prior art verified in source: Armada (Soapbox's NIP-29 client) ships exactly
this model — `.xdc` attached to a kind-9 message via NIP-92 `imeta` with a
session UUID, state as kind 9450/24450 scoped by `h` + `i`, launched in an app
stage above the chat. We adopt its wire format byte-for-byte.

## Decisions

| Decision | Choice |
| --- | --- |
| Scope | General "apps in channels" mechanism; pad is the flagship app |
| State scoping | `h` = **NIP-29 group id** on the groups relay (Armada-compatible; supersedes the 2026-08-19 spec's `h` = community pubkey — see Amendment) |
| Base branch | Stacked on `feat/community-group-pointer` (contains dev) |
| Channel types | NIP-29 only; Concord (E2E) is a future extension via the same AppSync seam |
| App sources | Curated "Start pad" + app picker over kind-1063 discovery; no raw `.xdc` upload in v1 |
| Persistence layers | Session resume (free) + apps bar (findability) + publish snapshot (artifact) |
| Export mechanism | Implement the standard webxdc `sendToChat` API in our host |

## 1. Event model & session lifecycle

**Session start.** A member with write access uses a composer action in a
NIP-29 channel:

- **Start pad** — references the deployment's curated pad app (see §6).
- **Apps…** — a picker over published interactive resources, discovered via
  `{kinds:[1063], "#m":["application/x-webxdc"]}` on the educational lookup
  relays (the same discovery Armada's game picker uses).

Either publishes an ordinary **kind-9 chat message** to the group relay with an
NIP-92 `imeta` tag:

```
["imeta",
  "url <blossom .xdc url>",
  "m application/x-webxdc",
  "x <sha256 of the archive>",
  "image <icon url>",
  "webxdc <freshly minted uuid>"]
```

The `webxdc` UUID **is** the session: everyone launching from that message
converges on one shared state. Re-sharing the same app mints a new UUID = a
fresh session. This is NIP-DC's attachment convention and Armada's exact
behavior. No per-session Blossom upload happens — the app blob already exists
from the resource lane (or the curated pad publish).

**State transport** (Armada's NIP-29 mapping, adopted verbatim):

| Kind | Role | Tags | Content |
| --- | --- | --- | --- |
| **9450** | durable state update (`sendUpdate()`) | `["h", groupId]`, `["i", sessionUuid]`, optional `info`/`document`/`summary` | JSON payload |
| **24450** | ephemeral realtime (`joinRealtimeChannel()`) | `["h", groupId]`, `["i", sessionUuid]` | base64 `Uint8Array`, ≤128,000 bytes raw |

Join/backfill = `{kinds:[9450], "#h":[groupId], "#i":[uuid]}` plus a live
subscription; 24450 is forwarded to active subscribers, never stored. All
publishes go through `publishToGroupRelay` (`src/lib/groups/group-management.js`)
— NIP-42 auth with one-shot retry included.

**Resume.** Reopening the launch card (from chat scrollback or the apps bar)
replays the 9450 log. State lives on the relay, not in the client.

**Interop.** Because `h` = group id on a relay29-family relay, live
cross-client sessions with Armada are possible (an Armada user and an edufeed
user can edit the same pad). Kind-1063 discovery interop was already full in
Phase 1.

## 2. Privacy model

Pad/session state inherits **exactly the channel's own privacy** — 9450 events
sit on the groups relay next to the channel's kind-9 messages and are gated by
the same NIP-29 rules:

- **Private channel** (39000 carries `private`): the relay serves group events
  only to NIP-42-authenticated members on the 39002 roster; outsiders get
  nothing. Same for 24450 forwarding.
- **Public channel**: world-readable, exactly like the chat itself.

Caveats (state them in user-facing docs):

1. **Relay-enforced, not cryptographic.** Nothing is encrypted; the relay
   operator can read everything. This is a different guarantee than Concord's
   E2E channels — users must not confuse the two. E2E pads over Concord
   streams are a scoped-out future extension.
2. **Pad content never touches Blossom.** The public blob is only the editor
   app binary; the document exists purely in the 9450 log. Content becomes
   public only through the explicit publish-snapshot action.

## 3. UI surfaces

All in the NIP-29 lane (`GroupChat.svelte`); Concord surfaces untouched.

- **Composer** (`src/lib/components/chat/ChatComposer.svelte`, currently a bare
  text input): gains one apps affordance (`+`/puzzle button) opening a menu
  with *Start pad* and *Apps…*. The picker modal reuses interactive-resource
  card components; discovery via the educational lookup relays. Visible only
  when the user can write to the channel, and only in the timeline composer —
  the ThreadPanel's composer (same component) does not get the menu in v1
  (sessions are channel-scoped, not thread-scoped).
- **Launch card.** `ChatMessageRow` already exposes an `attachments` snippet —
  GroupChat starts passing it (today only Concord's ChannelChat does). A new
  `WebxdcAttachmentCard` renders icon + name + Launch for `imeta` entries with
  `m application/x-webxdc`; other mimes keep `MessageAttachments` behavior.
  The generic NIP-92 parser currently in `src/lib/concord/attachments.js` is
  extracted to a shared helper (e.g. `src/lib/helpers/imeta.js`) so the NIP-29
  lane does not import from the Concord namespace (lint rule).
- **App stage.** Launching opens the app in a panel pinned above the chat
  timeline (Armada's AppStage pattern; structurally like our
  `ChannelEventsBar`), hosting the existing `WebxdcPlayer` unchanged
  (hash-verify → unzip → sandboxed iframe on `SANDBOX_DOMAIN`). One open
  session per channel view; closing the stage unsubscribes — state is on the
  relay.
- **Apps bar.** A collapsible strip above the timeline listing this channel's
  sessions: derived client-side from webxdc `imeta` messages already in the
  loaded timeline, enriched with each session's latest 9450
  `document`/`summary` tags (pad title, activity). Entries reopen the session.
  No new registry event kind — YAGNI until timeline-derivation hurts.

## 4. Sync layer — `group-sync.js`

New `src/lib/webxdc/group-sync.js`:
`createGroupSync(pointer, sessionUuid, user)` implementing the 5-method
`AppSync` interface from `local-sync.js` (`getUpdates` / `sendState` /
`sendRealtime` / `onRealtime` / `subscribe`). `WebxdcPlayer` gets an optional
`sync` prop defaulting to `createLocalSync` — the resource-page solo flow is
untouched; the channel stage passes the group-backed sync. This is the seam
Phase 1 pre-declared.

**Ordering.** The host derives webxdc serials from array index and its contract
forbids re-sorting after listeners have seen updates (`local-sync.js` header).
Therefore:

1. On open: paginated backfill of `{kinds:[9450], "#h", "#i"}` to EOSE, sorted
   once by `created_at` (event id as tiebreak), frozen as the initial array.
2. After that: live events are **appended in arrival order**, deduped by event
   id — even when a straggler carries an older timestamp. Never splice.

This can violate timestamp order for late arrivals; CRDT payloads (Yjs — the
pad) are commutative and immune. Non-CRDT apps must tolerate late appends —
the standard reality of eventually-consistent transports; note it in dev docs.

**Publishing.** `sendState` builds the 9450 template (`h`, `i`, pass-through
`info`/`document`/`summary`) → `publishToGroupRelay`. `sendRealtime` publishes
24450 (base64). `onRealtime` subscribes and skips own echoes (track sent event
ids). For private channels the sync calls `authenticateOnce`
(`src/lib/groups/relay-auth.js`) proactively before its REQ — an
unauthenticated REQ gets a silent CLOSED and the pad would look empty.

**Lifecycle & limits.** Subscriptions exist only while the stage is open.
Existing host limits stand (64 KiB per update, 128,000 bytes realtime). A
rejected 9450 publish (e.g. membership revoked mid-session) surfaces as a toast
on the stage, mirroring chat-send failures.

## 5. Publish snapshot — `sendToChat` as the export hook

The host currently rejects `sendToChat`. We implement it:

- `createWebxdcHost` gains an `onShareFile` option; the RPC handler validates
  the payload (`name` + `plainText` or base64 blob) and forwards it.
- **Channel stage:** a text export opens the **existing article/wiki creation
  flow prefilled** — title from the file name, body from the markdown,
  community targeting (h-tag) preset from the channel's community. A small
  dialog first chooses **article (30023)** or **wiki page (30818)**. The user
  reviews and publishes through the normal flow; nothing is published
  silently.
- **Solo player (resource page):** same callback wired to a plain file
  download.
- Binary exports: download only, both contexts, v1.

webxdc/editor's *"Export as .txt"* menu item calls
`sendToChat({file: {name, plainText: <markdown-serialized doc>}})` (verified in
`src/prosemirror-setup.ts`), so the pad's export button becomes our "publish as
community document" flow with **zero app modification**. Divergence note:
Delta Chat interprets `sendToChat` as "open a draft message with this file";
ours is host-mediated sharing — within the API's intent (the host defines what
sharing means). A later addition can offer "post into channel as attachment"
from the same hook.

## 6. Relay & configuration changes

- **Groups relay (pyramid fork, homelab):** whitelist kinds **9450** and
  **24450** in the relay29 `RestrictToSpecifiedKinds` set — the same two-line
  change Armada's relay makes. 24450 is in NIP-01's ephemeral range; khatru
  forwards without storing automatically. Redeploy via the homelab role.
- **Curated pad app (ops step):** vendor + version-pin the webxdc/editor
  build, publish it once to Blossom + kind-1063 (small script following the
  `publish:vocabs` conventions), reference via env → `runtimeConfig`
  (`PAD_APP_URL`, `PAD_APP_SHA256`, `PAD_APP_ICON`). *Start pad* is hidden
  when unconfigured.
- **Discovery reliability:** the app picker queries the educational lookup
  relays; today the AMB relays hold zero 1063s (separate open task:
  relay-side kind-1063 admission, planned). The picker works via the fallback
  relays meanwhile; the AMB-relay fix makes it reliable and gated-mode-safe.
  The two initiatives interlock; neither blocks the other.
- **Feature gating:** no new flag — the surface rides on the existing
  `groupsFeatureAvailable()` gate; *Start pad* additionally requires the pad
  config.

## Amendment to the 2026-08-19 webxdc spec

Section 5 (Phase 2) of
`docs/superpowers/specs/2026-08-19-webxdc-interactive-resources-design.md`
scoped `h` to the community pubkey on community relays, with a noted caveat
that this forfeits Armada interop. **This spec supersedes that section**: with
real NIP-29 channels, session state is scoped to the group id on the groups
relay, which restores Armada interop and inherits channel-level access control
(including private channels — which the community-pubkey scoping could not
enforce). The Phase-3 results/leaderboard design is unaffected and would build
on this transport.

## Testing

- **Unit** (`src/lib/__tests__/`): 9450/24450 template building; backfill
  ordering + append-only live handling + dedupe against a mocked pool;
  `onShareFile` payload validation; imeta parser extraction keeps existing
  Concord attachment tests green.
- **Component** (`src/lib/components/__tests__/`): `WebxdcAttachmentCard`
  rendering from an imeta-carrying kind-9; apps-bar derivation from a message
  set; composer menu gating (write access, pad config).
- **E2E:** at most one flow — start pad → send an update → relaunch → state
  replayed — against a local mock relay, only if it can be made non-flaky;
  otherwise the unit layer carries ordering guarantees. Update
  `e2e/COVERAGE.md` either way.

## Dependencies & sequencing

1. Base: `feat/community-group-pointer` (unmerged; contains dev as of
   f996aaba). Implement in a worktree branched from it.
2. Groups relay deployed with 9450/24450 whitelisted (fork tag edufeed-v1.1 +
   this change).
3. Curated pad published + env configured (ops).
4. Interlocks with (does not block / is not blocked by) the AMB-relay
   kind-1063 admission task.

## Out of scope (future)

- Concord (E2E) channel sessions via a Concord-backed AppSync.
- Raw `.xdc` upload in the chat composer.
- "Post export into channel as attachment" from the `sendToChat` hook.
- Phase-3 results/leaderboard panel (xAPI statements over this transport).
- Session archival/compaction of long 9450 logs (Yjs snapshot-as-update is the
  known escape hatch if logs grow hot).
- Pad deletion/moderation UI: protocol-wise the share message is deletable by
  its author (kind-5, relay's 2h window) and by channel admins/mods (NIP-29
  kind 9005; mods cannot delete admins' content); deleting the share hides
  card + apps-bar entry, but the 9450 log lingers unless swept. An in-app
  "remove pad" action belongs to the broader channel-moderation-UI feature.
