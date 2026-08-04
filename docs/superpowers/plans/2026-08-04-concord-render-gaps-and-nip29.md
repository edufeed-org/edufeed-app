# Concord Render Gaps + NIP-29 Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render everything Armada sends into Concord channels (imeta attachments, 1111 threads, 1068 polls, calendar events, zaps) and add NIP-29 relay-group chat, reusing the existing chat component stack.

**Architecture:** Each feature is an additional rumor-kind consumer on the existing per-channel `ConcordRumorStore` timeline (`community.channelStore(id).timeline([{kinds:[k]}])`), rendered through the shared presentational chat components (`ChatMessageList`/`ChatMessageRow`/`ReactionChips`). NIP-29 is a new `src/lib/groups/` lane that talks to a group relay directly (kind-9 + `#h` filters, 39000-39002 metadata) but feeds the *same* presentational components — that is the DRY axis: protocol lanes differ, rendering does not.

**Tech Stack:** Svelte 5 runes, applesauce-concord `0.0.0-concord-20260714212055` (pinned; seals 20013/20014, `helpers/imeta.js`), applesauce-common@6.2.0 (`helpers/groups.js` NIP-29 helpers + `blueprints` Group*Blueprints — already in the tree), vitest + @testing-library/svelte, Web Crypto (blob decrypt, already proven in `blob-media.js`).

## Global Constraints

- Branch: `feat/concord-render-gaps` off `worktree-cordn-groups` (1f61b22d). Worktree: `.worktrees/concord-render-gaps`.
- TDD: every feature lands test-first; graft new tests onto the unfixed source and require a FAIL before implementing (repo memory: a test named for a property may be unable to fail on it).
- `set -a; . ./.env; set +a` before every `pnpm test` run (vitest does not load .env).
- SSR discipline: `src/lib/concord/**` modules consumed by components must not add top-level package imports (`bridge.svelte.js` convention); package access via dynamic import or pure reimplementation with a parity test.
- No new dependencies without a stated reason in the commit message.
- Do not touch `.claude/worktrees/cordn-groups` — laoc's dev server (:5179) serves it.
- Known-red baseline: GlobalFAB async-leak exit-1 on green suites; read the `Tests` summary line, not the exit code.
- Sending/uploads: Phase A is RENDER-side. Composing attachments/polls/events/zaps is explicitly out of scope v1 (thread replies get a composer because a thread panel without one is useless).
- Rolling-wave: Tasks 1-2 are specified at full bite-size below; Tasks 3-6 lock interfaces + acceptance and get their bite-size expansion appended here as each is reached (executor = author, same session lineage).

---

### Task 1: Concord imeta attachments — pure helpers

**Files:**
- Create: `src/lib/concord/attachments.js`
- Test: `src/lib/__tests__/concord-attachments.test.js`

**Interfaces:**
- Produces: `getMessageAttachments(message) -> Array<{url, mime?, name?, size?, dim?, blurhash?, ox?, x?, encryption?: {algorithm, key, nonce}}>` (parsed from `imeta` tags, order-preserving, invalid entries skipped)
- Produces: `classifyAttachment(att) -> 'image'|'video'|'audio'|'file'` (by `mime` prefix, `file` fallback)
- Produces: `stripAttachmentUrls(content, attachments) -> string` (removes bare attachment URLs from message text so the bubble doesn't show a dead ciphertext link above the rendered embed; leaves all other text intact; collapses leftover whitespace)

**Steps:**
- [ ] Write failing tests: imeta parse (url/m/ox + `encryption-algorithm`/`decryption-key`/`decryption-nonce` fields per applesauce-concord `helpers/imeta.js` convention), classification per mime, strip behavior (URL-only content -> '', mixed content keeps prose, non-attachment URLs untouched). Include a parity fixture: one tag set run through our parser must equal `parseImeta` from `applesauce-concord/dist/helpers/imeta.js` (dynamic import inside the test — tests are node-side, SSR constraint doesn't apply there).
- [ ] Run: fails (module missing).
- [ ] Implement pure module (no package imports — SSR constraint; parity test is the DRY guard).
- [ ] Run: green. `pnpm check` clean.
- [ ] Commit `feat(concord): parse + classify imeta chat attachments`.

### Task 2: attachment decrypt-and-render in ChannelChat

**Files:**
- Modify: `src/lib/concord/blob-media.js` (add `fetchDecryptedAttachmentUrl(att)`; reuse `decryptBlob`, new cache keyed by `url`, hash-verify against `ox` when present, pass-through `att.url` when no `encryption`)
- Modify: `src/lib/concord/blob-media.svelte.js` (add `useDecryptedAttachment(getAtt)` — same `$effect` bridge as `useConcordAreaIcon`)
- Create: `src/lib/components/community/channels/MessageAttachments.svelte` (image `<img>` w/ dim aspect placeholder, video/audio via native elements, file chip w/ name+size; loading skeleton; failure -> file chip fallback)
- Modify: `src/lib/components/chat/ChatMessageRow.svelte` (new optional `attachments` snippet rendered inside the bubble below content — presentational, non-breaking)
- Modify: `src/lib/components/community/channels/ChannelChat.svelte` (derive attachments per message via Task-1 helpers; pass stripped content + snippet)
- Test: extend `src/lib/__tests__/concord-blob-media.test.js`; create `src/lib/components/__tests__/MessageAttachments.test.js`

**Interfaces:**
- Consumes: Task 1 helpers; `decryptBlob(bytes, keyHex, nonceHex)`.
- Produces: `fetchDecryptedAttachmentUrl(att) -> Promise<string|null>`; `MessageAttachments` props `{attachments: Att[]}`.

**Steps:**
- [ ] Failing tests: encrypted fixture (WebCrypto-encrypt in test, serve via mocked fetch, expect object URL + plaintext hash check; wrong `ox` -> null + single warn), unencrypted pass-through (no fetch call), cache shares in-flight promise. Component test: img render for image att, chip for pdf, fallback on null URL. ChatMessageRow snippet test: renders when provided, absent otherwise.
- [ ] Implement; run suite; `pnpm check`.
- [ ] Manual probe on a scratch dev server (NOT :5179): photo posted from Armada renders. (If no Armada community with media is reachable, publish an imeta message via applesauce-concord factory in a node script against the test relay and view it.)
- [ ] Commit `feat(concord): render encrypted imeta attachments in channel chat`.

### Task 3: thread replies (1111)

**Files:** Create `src/lib/concord/threads.js` + `src/lib/components/community/channels/ThreadPanel.svelte`; modify `ChannelChat.svelte` (kinds [1111] timeline, per-root reply counts, open panel, "reply in thread" action); test `src/lib/__tests__/concord-threads.test.js`.

**Interfaces (locked):**
- `aggregateThreads(comments) -> Map<rootId, {count, latest}>` (root = uppercase `E` tag; rumors without `E` ignored)
- `buildThreadReplyTemplate({root, parent, content}) -> rumor template` with NIP-22 `K/E/P` (root) + `k/e/p` (parent) tags exactly as Armada's `buildV2CommentTags` produces them (verify against a captured Armada fixture before coding; kind 1111, published via `community.sendEvent(channelId, factory-or-template)` — confirm `sendEvent` accepts an `EventFactory`-wrapped custom kind, else use `ChatMessageFactory`-equivalent path from `applesauce-common-concord/factories`).
- ThreadPanel reuses `ChatMessageRow` + `MentionAutocomplete` + the send pipeline; badge on root rows: "N replies →".
- Acceptance: reply posted in Armada shows under its root here (count + panel); reply sent here shows threaded in Armada.

### Task 4: polls (1068 + votes 1018)

**Files:** Create `src/lib/concord/polls.js` + `PollMessage.svelte`; modify `ChannelChat.svelte` (timeline kinds [9,1068] merged for rows; votes kinds [1018] aggregated); test `concord-polls.test.js`.

**Interfaces (locked):**
- `parsePoll(rumor) -> {id, label, options: [{id, label}], endsAt?, multi: boolean}` (NIP-88: `option` tags, `polltype` singlechoice default, `endsAt`)
- `tallyVotes(votes, poll) -> Map<optionId, {count, mine: boolean}>` — latest vote per pubkey wins (created_at, `ms` tie-break), `response` tags, votes referencing the poll via `e`.
- Vote send: kind-1018 rumor `{e: pollId, response: optionId}` through `community.sendEvent`; disabled after `endsAt`.
- Acceptance: poll created in Armada renders with live tallies; voting here reflects in Armada.

### Task 5: calendar events bar (31922/31923 + RSVP 31925)

**Files:** Create `src/lib/concord/channel-events.js` + `ChannelEventsBar.svelte`; modify `ChannelChat.svelte`; test `concord-channel-events.test.js`.

**Interfaces (locked):**
- `parseChannelEvent(rumor) -> {id, title, start, end?, location?, dateBased: boolean}` (NIP-52 tags; identity = (author,d) within channel, latest created_at wins — these are RUMORS: no `a`-coordinate, RSVPs use `e` per Armada kinds.ts comment)
- `aggregateRsvps(rsvps) -> Map<eventId, Map<pubkey, 'accepted'|'declined'|'tentative'>>` (latest per pubkey)
- Bar above chat: upcoming events sorted by start (past hidden behind a toggle), RSVP buttons publish 31925 `{e, status}`. Reuse `formatMessageTimestamp`-family date helpers; do NOT drag the page-scale calendar components in.
- Acceptance: event created in Armada appears in the bar; RSVP round-trips.

### Task 6: zaps on messages (9735 + 8333)

**Files:** Create `src/lib/concord/zaps.js`; modify `ChannelChat.svelte` + zap chip in `ChatMessageRow` footer area (via existing `reactions` snippet composition, no new snippet); test `concord-zaps.test.js`.

**Interfaces (locked):**
- `verifyZap(rumor) -> {target: eventId, amountMsat, payer} | null` — CORD.md rule: NIP-57 receipt shape authored by the PAYER + `preimage` tag; verify `sha256(preimage) == bolt11 payment_hash` and amount tag == invoice amount; unverified NEVER enters tallies. bolt11 payment_hash/amount extraction: minimal tagged-field parser in `zaps.js` (bech32 words -> tag `p`), tested against fixture invoices — no new dependency.
- `tallyZaps(rumors) -> Map<targetId, {totalMsat, count}>`; kind 8333 on-chain rows tallied separately (`totalOnchainSat`).
- Render: "⚡ N sats" chip next to reaction chips. Sending zaps: out of scope (needs wallet UX — separate feature).
- Acceptance: zap sent in Armada shows verified tally here; a forged receipt (bad preimage) fixture is EXCLUDED by test.

### Task 7: NIP-29 relay groups (Phase B)

**Files:** Create `src/lib/groups/{pointer.js,metadata.js,timeline.js,actions.js}`, `src/routes/groups/[pointer]/+page.svelte` (+`+page.js` ssr=false), `src/lib/components/groups/GroupChat.svelte`; tests `src/lib/__tests__/groups-*.test.js`.

**Interfaces (locked; expand to bite-size when reached):**
- Pointer codec: reuse `encodeGroupPointer`/`decodeGroupPointer` from `applesauce-common/helpers/groups` (`host'id` format, same as Armada).
- Metadata: kind 39000 (name/picture/about, `public`/`open` markers), admins 39001, members 39002 — request from the group relay only.
- Timeline: kind 9 + kind 7 with `#h:[id]` filter through the app's existing relay-pool infrastructure (`nostr-infrastructure.svelte` / applesauce RelayPool path — decide at expansion after reading how Chat.svelte subscribes); send = signed kind 9 with `["h", id]` + NIP-31-style previous-tag defense skipped v1 (Armada parity check at expansion).
- Join/leave: `GroupJoinRequestBlueprint`/`GroupLeaveRequestBlueprint` (applesauce-common/blueprints) published to the group relay.
- **Risk (resolve first at expansion):** NIP-29 relays require NIP-42 AUTH for closed groups — verify the app's relay layer answers AUTH challenges; if not, that sub-task comes first.
- UI: GroupChat composes the SAME `ChatMessageList`/`ChatMessageRow`/`ReactionChips`/`groupMessagesByDate` stack as ChannelChat/Chat — zero protocol code in components.
- Entry point: "Join group" accepts a `host'id` string or `nostr:` group link; joined groups persisted in kind-10009 GROUPS_LIST (applesauce constant) so they roam.
- Acceptance: join a public group on a live NIP-29 relay (e.g. the relay Armada defaults to), read history, send a message visible in Armada, leave.

### Task 8: CORD-07 calls — BLOCKED on laoc infra decision (LiveKit + broker). Not planned here; research: `.superpowers/sdd/cord07-av-research.md`.

---

## Self-Review (2026-08-04)

- Spec coverage: laoc's list = imeta ✓(T1-2) threads ✓(T3) polls ✓(T4) calendar ✓(T5) zaps ✓(T6) NIP-29 ✓(T7) calls ✓(T8 blocked, flagged in thread).
- Placeholder scan: Tasks 3-7 are interface-locked rolling-wave stubs by declared exception (executor = author); no TBDs inside locked interfaces.
- Type consistency: attachment shape used by T2 matches T1 product; `sendEvent` usage in T3/T4 mirrors `send-message.js`'s existing factory path.
