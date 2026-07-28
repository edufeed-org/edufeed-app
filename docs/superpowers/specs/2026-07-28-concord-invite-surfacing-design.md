# Concord: Surface Pending Invitations — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending plan
**Branch:** `worktree-cordn-groups`

## Problem

An invited user must currently discover a Concord (private-area) invitation by visiting the
right community, noticing it has a "Kanäle" content type, and clicking "Erhaltene
Einladungen" inside it. Far too buried. Pending invitations should come to the user on the
dashboard — via the Termi assistant, a dashboard inbox entry, and a nav badge.

Concord invites arrive on the `directInviteWatcher` (kind-1059 gift wraps), a
**deliberately local-only** stream (not NIP-78-synced, for metadata-leak reasons) —
separate from the dashboard `inbox-service`. So this is about **bridging the watcher's
pending state** into shared surfaces, not filtering the existing inbox.

## Key facts (verified)

- `directInviteWatcher.pending$` = locked wraps addressed to you (count readable with **no
  signer prompt**); `.invites$` = decrypted, actionable invites (fills after `readPending()`,
  which prompts the signer). The client runs `autoUnlock: false`.
- The Concord client + `notifications` service run **app-wide**, started via
  `initConcordService()` in `src/routes/+layout.svelte`, lifecycle in
  `src/lib/concord/client.svelte.js:284-305` (`startConcordNotifications({client,storage,pubkey})`).
- No existing app-wide pending-invite count. `notifications.svelte.js` subscribes to
  `invites$` only as a tick and discards the payload.
- `InviteInboxModal.svelte` (`community/channels/`) is the **receiving-side, community-agnostic**
  accept/decline UI — it reads the app-wide `getConcordClient().directInviteWatcher` and takes
  only `onClose`. It is SSR-safe (imports `getConcordClient` from `client.svelte.js`, which uses
  dynamic concord imports).
- Global modals: `modalStore.openModal(type, props, callbacks)` + `ModalManager.svelte`
  (static import + `{:else if activeModal === 'type'}` branch). `ModalType` union in
  `src/lib/stores/modal.svelte.js`.
- `DashboardNavSidebar.svelte` has section ids incl. `communities` (line 49); badge pattern at
  lines 91-106 (DaisyUI `badge badge-secondary`, `getTotalUnreadCount()`/`getUnreadDmCount()`).
- Termi hints: `HINT_IDS` + `statuses` `$derived` in `assistant-hints.svelte.js`;
  `deriveHintStatus()` in `helpers/assistant-hints.js`; copy in `TermiChatWindow.svelte`'s
  `hintCopy` map; `runHint(id)` opens modals via `modalStore`.

## Design

### 1. Shared count service — `src/lib/concord/pending-invites.svelte.js`

New app-wide service modeled on `notifications.svelte.js` (module-level `$state`, manual RxJS
subscription managed outside component context):

- `startConcordPendingInvites({ client })` — subscribes to
  `client.directInviteWatcher$.pipe(switchMap(w => combineLatest([w?.pending$ ?? of([]), w?.invites$ ?? of([])])))`
  and sets `pendingCount = pending.length + invites.length`. `stopConcordPendingInvites()`
  unsubscribes + resets to 0. Guard with a generation counter (mirror notifications) so a stale
  async start can't clobber a newer one.
- Reactive getter `getPendingInviteCount()` (reads a module `$state`).
- Wire start/stop next to `startConcordNotifications`/`stopConcordNotifications` in
  `client.svelte.js:284-305` (start receives the same `client`).

The count is prompt-free (uses `.length`, no decrypt). Accept/decline in `InviteInboxModal`
drops the wrap → count falls → all surfaces clear automatically.

### 2. Global modal registration

Add `'concordInvites'` to the `ModalType` union (`modal.svelte.js`) and a branch in
`ModalManager.svelte` rendering `InviteInboxModal` with `onClose={() => modal.closeModal()}`.
Now any surface can `modalStore.openModal('concordInvites')`.

### 3. Termi hint (`invites`)

- Add `'invites'` to `HintId`/`HINT_IDS`.
- In `statuses` `$derived`: `invites: deriveHintStatus({ applicable: getPendingInviteCount() > 0, confirmed: false, running: running.has('invites'), everOpen: everOpen.has('invites') })`. `confirmed` is never true — the hint auto-clears when the count hits 0 (accept/decline), so it's a self-managing call-to-action, not a nag. No dismiss needed.
- `runHint('invites')` → `modalStore.openModal('concordInvites')`.
- `hintCopy.invites` in `TermiChatWindow.svelte` + new i18n keys.

### 4. Dashboard inbox CTA — `HomeInboxCard.svelte`

Inject a CTA row between the filter chips and the item list, shown when
`getPendingInviteCount() > 0`: "🔒 {n} Einladung(en) zu privaten Bereichen" + an "Ansehen"
button → `modalStore.openModal('concordInvites')`. Reads the shared getter.

### 5. Nav badge — `DashboardNavSidebar.svelte`

Add a badge branch `{:else if section.id === 'communities' && getPendingInviteCount() > 0}`
mirroring the existing inbox/messages badge markup. (Badge **Communities**, not Gruppen —
Gruppen is the unrelated, feature-gated cordn feature; Concord private areas live in
communities.)

## New i18n messages (de + en)

- `concord_invite_hint_title`, `concord_invite_hint_body`, `concord_invite_hint_action` (Termi)
- `concord_invite_inbox_cta` (param `count`), `concord_invite_inbox_action` (dashboard)

## Testing

- **`pending-invites` unit test** (node): mock a `directInviteWatcher$` BehaviorSubject emitting a
  watcher whose `pending$`/`invites$` are controllable Subjects; assert `getPendingInviteCount()`
  = pending.length + invites.length, updates on emit, resets on stop, and the generation guard
  ignores a stale start.
- **`DashboardNavSidebar`**: badge shows the count on `communities` when > 0, hidden at 0 (mock
  `getPendingInviteCount`).
- **`HomeInboxCard`**: CTA row shows when > 0 and calls `modalStore.openModal('concordInvites')`;
  absent at 0.
- **assistant-hints**: `invites` status is `'open'` when count > 0 and `null` at 0.
- **Browser (best-effort):** the logged-in owner is the *inviter*, so may have no pending invite
  to display; verify with a temporary count stub or an incoming invite if available, else rely on
  the component tests.

## Scope boundaries

- No change to the accept/decline logic, the watcher, or the NIP-78 sync stance (invites stay
  local-only).
- No new relay/protocol behavior.
- Badge/count are read-only views of existing watcher state; the only signer-decrypt stays in
  `InviteInboxModal.readPending()` (unchanged).

## Files touched

- New: `src/lib/concord/pending-invites.svelte.js` (+ unit test)
- `src/lib/concord/client.svelte.js` (lifecycle wiring)
- `src/lib/stores/modal.svelte.js` (ModalType) + `src/lib/components/ModalManager.svelte` (branch)
- `src/lib/stores/assistant-hints.svelte.js` + `src/lib/components/assistant/TermiChatWindow.svelte`
- `src/lib/components/inbox/HomeInboxCard.svelte`
- `src/lib/components/dashboard/DashboardNavSidebar.svelte`
- `messages/de.json`, `messages/en.json`, tests
