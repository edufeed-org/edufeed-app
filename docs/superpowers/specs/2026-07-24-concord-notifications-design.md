# Concord Notifications & Read-State — Design

**Date:** 2026-07-24
**Status:** Approved by Steffen (brainstorm session)
**Branch:** `worktree-concord-private-channels` (stacked on the completed private-channels feature @ 5a80e8d4)
**Research basis:** `.superpowers/sdd/armada-notifications-research.md` (Armada source analysis; file:line evidence)

## Summary

Armada-style unread badges, mentions, and foreground browser notifications for
Concord private channels. Read-state is **local-only per device** (per-account
Concord IndexedDB) — deliberately not synced, mirroring Armada's choice for
sealed channels: a synced read-state blob would be a regularly-republished
public event correlating the pubkey's activity cadence with private-channel
usage, a metadata leak the sealed design exists to avoid. Cross-device cost
(channel read on desktop re-shows unread on mobile) is accepted.

There is no protocol-level read-state or mention mechanism anywhere (verified:
base CORD spec, Armada's extension doc, `applesauce-concord` dist) — everything
here is client-local invention with no interop bar to meet.

## Decisions (user-confirmed)

| Question | Decision |
| --- | --- |
| Read-state sync | Local-only, per device, per account |
| Surfaces | Channel rows + area/community level. **Not** the global inbox/Nachrichten badge |
| Mentions tier | Yes — two-tier (unread vs. mentioned) |
| Mention producers | Reply p-tags **and** composer @-autocomplete |
| Visual style | Armada-style binary: dot/bold for unread, accent `@` pill for mention. No numeric counts |
| OS toasts | Foreground-only Notification API, all messages by default |
| Toast controls | Per-channel 3-level menu: all / mentions / nothing |
| Deferred | Cross-device sync, closed-tab Web Push (blocked on web-push initiative), global inbox integration, kind-1111 thread mentions |

## Architecture: central notifications service

One service owns all subscription fan-out, folding, marker I/O, and toast
dispatch. Badge components only read derived reactive state. Rationale: the
community layout double-mounts children 2–3× (per-component subscriptions would
multiply); the toast dispatcher must run even when no badge component is
mounted; monotonic marker writes are enforced in one place.

### New files (all inside `src/lib/concord/` unless noted)

| File | Purpose |
| --- | --- |
| `notification-helpers.js` | Pure functions: summary folding, monotonic marker merge, level resolution, toast gate decision, marker pruning. No IDB, no Svelte — fully unit-testable |
| `notifications.svelte.js` | The service: fan-out subscriptions, `$state.raw` reactive map, hooks (`useChannelUnread`, `useAreaUnread`), `markChannelRead`, toast dispatcher, level accessors |
| `active-channel.svelte.js` | Shared `{communityId, channelId} \| null` in `$state.raw` + set/clear/get. Written by `PrivateChannelsView`, read by the service |
| `src/lib/components/shared/ConcordUnreadDot.svelte` | Tiny presentational two-tier dot (neutral / accent) overlaid at badge call sites |
| `src/lib/components/community/channels/MentionAutocomplete.svelte` | `@`-autocomplete dropdown over the community roster |

`ConcordAreaBadge` stays a pure identity avatar — the dot is a sibling overlay
at call sites, not a new prop on the badge.

## 1. Data model & persistence

All state lives in the existing per-account Concord IndexedDB
(`concord:<pubkey>`), `kv` object store, via `createConcordStorage(dbName)`
(`storage.js:39`). JSON-encoded string values, three keys:

- **`notif:read`** — `Record<"communityId/channelId", number>`: last-read
  `created_at` (unix seconds) per channel. Monotonic — writes never lower a
  value.
- **`notif:mention-read`** — `Record<communityId, number>`: last time the user
  viewed mention-worthy content per community. Consulted only for the
  area-level accent-dot rollup, so a mention in a channel that later becomes
  deleted/inaccessible cannot wedge the area dot forever.
- **`notif:levels`** — `Record<"communityId/channelId", "all"|"mentions"|"nothing">`:
  per-channel toast level; absent = `"all"`. Levels affect **only OS toasts**,
  never badges (muting silences noise but never hides unread truth — Armada's
  model).

No new object store, no `DB_VERSION` bump. Auto-wiped by the existing
`wipeConcordData(pubkey)` on logout (it deletes the whole DB).

## 2. Notifications service

Lifecycle: started/stopped by `initConcordService` (`client.svelte.js`) under
the same generation guard as the client. Never starts when `CONCORD_ENABLED`
is off or logged out; hooks then return all-read defaults.

**Fan-out:** subscribe `client.communities$` → per community
`getCommunity(cid)` → `channels$` → per *accessible* channel
`channelStore(channelId).timeline([{kinds: [9]}])`. Subscriptions are diffed on
channel-list changes (new → subscribe, gone/inaccessible → unsubscribe, all
torn down on stop). Timelines replay from the local `AsyncRumorStore` (IDB,
cap 300/channel) — **zero added relay traffic**, works offline.

**Folding:** each emission folds to a per-channel summary:

```
{ latest, latestFromOthers, latestMention }   // all unix-seconds created_at
```

- `latest`: newest kind-9 overall (used for mark-read stamping).
- `latestFromOthers`: newest with `pubkey !== me`.
- `latestMention`: newest with `pubkey !== me` and a `["p", <myPubkey>]` tag —
  Armada's exact convention: p-tag match on the decrypted rumor, never content
  scanning. Kind 9 only (reactions/edits excluded by the kinds filter;
  kind-1111 thread replies deferred until channel forums ship in edufeed).

**Reactive state:** one `$state.raw` map reassigned whole on change:
`{[communityId]: {[channelId]: summary}}`, plus loaded markers and levels.
Markers load from `kv` **before** the first summary publishes, so a reload
never flashes everything-unread.

**Hooks** (thin `$derived` getters, same shape as `bridge.svelte.js` usage):

- `useChannelUnread(getCommunityId, getChannelId)` → `{unread, mentioned}` —
  `unread = latestFromOthers > (readMarker ?? 0)`,
  `mentioned = latestMention > (readMarker ?? 0)`.
- `useAreaUnread(getCommunityId)` → same shape, OR-rollup across the
  community's channels; the mention rollup additionally requires
  `latestMention > notif:mention-read[communityId]`.

**`markChannelRead(communityId, channelId)`:** stamps
`max(current, summary.latest)` into `notif:read`; when the channel had an
unread mention, bumps `notif:mention-read[communityId]` the same way. Updates
reactive state synchronously, persists async (fire-and-forget with
`console.warn` on failure). Called when a channel becomes the active channel
and again as new messages arrive while it stays active and the tab is visible.

## 3. Active-channel state

`active-channel.svelte.js`: `{communityId, channelId} | null` in `$state.raw`.
`PrivateChannelsView` sets it whenever `selectedChannelId` changes and clears
on destroy. The double-mounted responsive variants track the same selection, so
last-writer-wins is safe. "Being viewed" = active channel **and**
`document.visibilityState === 'visible'`; this condition drives both mark-read
and toast suppression.

## 4. Badge surfaces

All binary, all DaisyUI semantic tokens (no literals):

- **Channel rows** (`PrivateChannelsView`): unread → bold name + neutral dot
  (`bg-base-content`); mentioned → accent `@` pill
  (`bg-secondary text-secondary-content`) with `aria-label` ("Du wurdest
  erwähnt" via paraglide message).
- **Kanäle tab** (`BottomTabBar.svelte` + `ContentNavSidebar.svelte`): reuse
  the existing restricted-tab overlay pattern (`<span class="relative">` +
  `absolute -top-1 -right-1.5` child) — neutral dot for any unread in the
  community, accent when any mention.
- **Area/community entries** (`Sidebar.svelte` private-areas section,
  `CommunitySidebar.svelte` collapsed rail + expanded list, linked communities
  where listed): `ConcordUnreadDot` overlaid on the existing
  `ConcordAreaBadge` anchor.

## 5. Mention producers

**Reply p-tag** — the pinned `applesauce-concord` `sendMessage(…, replyTo)`
only writes the NIP-C7 `q` tag. Fix app-side:

- Add npm alias **`applesauce-common-concord`**:
  `npm:applesauce-common@0.0.0-concord-20260714212055` — pinned in lockstep
  with the other two concord packages (CLAUDE.md Concord section gets the
  bump-in-lockstep note extended to three packages). Import only inside
  `src/lib/concord/` (extend the existing lint rule).
- New wrapper in `src/lib/concord/` — `sendChannelMessage(community,
  channelId, text, replyTo?)`: non-replies delegate to `community.sendMessage`
  unchanged; replies build
  `ChatMessageFactory.create(text, {emojis}).replyTo(parent).mention(parent.author)`
  and publish via `community.sendEvent(channelId, factory)` (identical
  channel/epoch binding + sealing path; the reply UI has no file attachments,
  so `sendMessage`'s uploader branch isn't needed). Self-replies skip
  `.mention()`. `ChannelChat.send()` switches to the wrapper.

**@-picker** — `MentionAutocomplete.svelte` in the `ChannelChat` composer:
typing `@query` opens a dropdown over the community roster (`members$`),
names from `useProfileMap` + `getUserDisplayName` (hex fallback). Selecting
inserts `nostr:npub1…` + space at the cursor. No package change needed:
`sendMessage` → `ChatMessageFactory.text()` → `setShortTextContent` already
runs `tagPubkeyMentions()`, turning content `nostr:npub…`/`nprofile…` into
`p` tags (verified in the pinned dist).

**Mention rendering** — as shipped, `ChatMessageRow` renders message content
via the existing shared `NostrContentRenderer` → `NostrIdentifier` →
`UserProfilePreview` chain (the same pipeline public `Chat.svelte` already
uses), unchanged: `nostr:npub…`/`nostr:nprofile…` tokens become the generic
`@displayname` mention chip that component already produces. No bespoke
token renderer was added, and the chip carries no self-highlight — a mention
of the current user renders identically to a mention of anyone else.
Distinguishing "this mentions me" visually is possible future polish, not
part of this feature.

## 6. Foreground OS notifications

- **Dispatcher** in the service: a candidate fires when a folded summary gains
  a new not-self kind-9 rumor (`created_at >` previous `latest` **and** `>`
  service start time — cache replay on boot never toasts).
- **Gates, in order:** `Notification.permission === "granted"` → tab hidden
  *or* channel ≠ active channel → channel level (`all` passes; `mentions`
  requires p-tag match; `nothing` drops) → not already read.
- **Content is minimal by design:** title `"{channelName} · {communityName}"`,
  body `"Neue Nachricht von {displayName}"` (paraglide). No message text in
  the OS layer — OS notification centers persist content, which conflicts
  with sealed channels.
- **Click:** focus tab, navigate to the community's Kanäle tab with
  `?channel=<id>`; `PrivateChannelsView` reads the param as initial selection
  (this also makes channels linkable).
- **Permission UX:** never prompt on load. A bell toggle in the
  `PrivateChannelsView` header calls `Notification.requestPermission()` on
  first enable; denied → toggle disabled with a hint. Per-channel level menu
  (all/mentions/nothing) as a compact dropdown in the `ChannelChat` header for
  the open channel, persisted to `notif:levels`.
- **Throttle:** one OS notification per channel per ~30s, using the
  Notification `tag` option keyed by channel so bursts collapse.

## 7. Error handling & edge cases

- **kv failures** (private-mode IDB): fall back to in-memory markers for the
  session; badges still work, worst case is re-shown unread after reload.
  Fire-and-forget writes with `console.warn`.
- **Clock skew:** `created_at` is sender-controlled. Mark-read stamps
  `max(marker, latest_seen)`, so a far-future message marks read once viewed
  instead of pinning the channel unread forever.
- **Deleted/inaccessible channels:** summaries drop out of the fold — stale
  markers can't light dots. `notif:mention-read` protects the area-level
  mention rollup. Stale marker entries pruned lazily on save.
- **Rekey/refounding:** channel ids survive rekey, so markers keep working. A
  refounding that changes ids starts fresh (rare; worst case one spurious
  unread dot).
- **300-rumor cache cap:** unread compares newest messages only — cap is
  irrelevant to correctness.
- **Svelte discipline:** `$state.raw` everywhere (rumor-derived data, Sets/
  Maps); plain `let` for subscriptions; keyed `{#each}` over channel ids only
  (already unique from `ChannelMetadata`).

## 8. Testing (TDD)

- **Unit** (`src/lib/__tests__/`, node): `notification-helpers` — monotonic
  merge, level resolution, folding from rumor fixtures (self excluded, p-tag
  mention detection, kind filter), toast gate function (pure decision:
  permission/visibility/active/level/marker → fire?), marker pruning.
- **Component** (jsdom): channel row dot/pill states; `MentionAutocomplete`
  roster filtering + insertion at cursor; mention chip in `ChatMessageRow`;
  level dropdown persistence; `ConcordUnreadDot` tiers.
- **E2E** (one flow, reusing the two-account invite fixtures): B messages a
  shared channel → A sees channel-row dot + area dot; A opens the channel →
  dots clear and stay cleared across reload; B replies to A's message → A
  sees the accent `@` pill. OS toasts excluded from E2E (headless Notification
  API unreliable) — covered by the pure gate function. Update
  `e2e/COVERAGE.md`.

## Deferred / out of scope

- Cross-device read-state sync (would need either the metadata-leaking synced
  blob or an unblessed in-plane CORD extension).
- Closed-tab Web Push (blocked on the app-wide web-push initiative; Armada's
  content-blind wake-up design is the template when it resumes).
- Global inbox/Nachrichten integration.
- Kind-1111 thread-reply mentions (no channel-forum UI in edufeed yet).
- Community-level default notification levels (per-channel only in v1).
