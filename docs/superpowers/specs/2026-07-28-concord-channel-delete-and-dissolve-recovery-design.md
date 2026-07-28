# Concord: Per-Channel Delete + Dissolve Recovery/Safety — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending plan
**Branch:** `worktree-cordn-groups`
**Follows:** `2026-07-28-concord-invite-channel-ux-design.md` (shipped)

## Problem

Follow-up UX gaps found while validating the invite/channel work:

1. **No per-channel delete.** The SDK exposes `community.deleteChannel(channelId)`
   (`applesauce-concord/dist/client/community.js:668`, a soft-delete publishing a
   `vsk CHANNEL` edition with `deleted:true`, gated by MANAGE_CHANNELS), but nothing
   in the app calls it. The only destructive area action in the UI is "Privaten
   Bereich auflösen" (dissolve the **whole** area).
2. **Dissolve is a permanent dead-end with no recovery path.** Dissolution is a
   permanent, chainless owner tombstone (`vsk 10` on the "dissolved" plane);
   `dissolved$` stays true forever and there is no un-dissolve. Once dissolved, the
   Kanäle tab renders a read-only shell and **hides every management control** (⋯
   menu, Einladen, + Neuer Kanal), and the app offers **no way to start over** from
   there — the only recovery (detach in Settings, then found fresh) lives one tab
   away and is undiscoverable. Verified: `PrivateChannelsView.svelte` has no
   `concord.dissolved` branch; the found-pane only shows when `!concord.community`,
   and a dissolved-but-resolvable community is truthy.
3. **Dissolve is under-guarded.** The dissolve modal is a single red "Auflösen"
   button with no typed confirmation, for a permanent, whole-area wipe.

## Key protocol facts (verified)

- `community.deleteChannel(channelId)` soft-deletes ONE channel (`deleted:true`
  edition); `deriveVisibleChannels` (`src/lib/concord/community.svelte.js:39-43`)
  already drops `deleted` channels, so a deleted channel disappears from the rail
  reactively.
- Founding a NEW area **replaces** the kind-10222 `concord` pointer cleanly:
  `withConcordPointer` (`src/lib/concord/pointer.js:48-51`) strips any existing
  `concord` tag and appends the new one. So founding fresh over a dissolved pointer
  works and orphans the dead area — **no detach step required**. The `ChannelCreateWizard`
  founds a fresh area whenever its `community` prop is falsy (`ChannelCreateWizard.svelte:69-81`).
- Dissolve is permanent; `refound` (CORD-06) only rekeys, it does not un-dissolve.

## Design

### A — Per-channel delete

- **Entry point:** add a **"Kanal löschen"** item to the channel header `⋯` menu in
  `ChannelChat.svelte` (after the dissolve item region, ~line 324), shown only when
  `isOwner && !dissolved && channelCount > 1` → `openOverlay('delete-channel')`.
  `ChannelChat` gains a `channelCount` prop (passed from `PrivateChannelsView`) so it
  can hide the item for the last remaining channel.
- **Confirmation + action live in `PrivateChannelsView`** (mirrors the existing
  `dissolve` modal pattern — it owns `channels`, `activeChannel`, `selectConcordChannel`,
  `concord.community`). Add an `overlay === 'delete-channel'` modal: title, a body
  naming `activeChannel.name`, Cancel + red Delete. On confirm →
  `await concord.community.deleteChannel(activeChannel.channel_id)`, then
  `selectConcordChannel` to the first remaining channel, success toast, close. Guard
  in the handler too (defense-in-depth): if `channels.length <= 1`, no-op.
- Deleting the active channel is safe: `deriveVisibleChannels` drops it, and the
  explicit re-select moves the user to a surviving channel.

### B1 — Dissolve recovery (kill the dead-end, keep history readable)

Rather than replace the read-only chat (which intentionally keeps history readable),
**augment the existing dissolved banner** in `ChannelChat.svelte` (lines 340-343): when
`isOwner`, add a **"Neuen Bereich gründen"** button → `openOverlay('create')`.

`PrivateChannelsView`'s `overlay === 'create'` block founds fresh when dissolved by
passing `community={concord.dissolved ? undefined : concord.community}` to the wizard.
Founding republishes the 10222 pointer at a new area; the reactive `useConcordArea`
hook then swaps `concord.community` to the live area and the dissolved state clears.
The old area is orphaned (harmless). No detach needed.

### B2 — Safer dissolve (typed confirmation)

In `PrivateChannelsView`'s `overlay === 'dissolve'` modal, add a text input. The red
"Auflösen" button stays `disabled` unless the typed value (trimmed, case-insensitive)
equals the area name (`communityProfile?.name`). Show the expected name in the label.
Fallback: if `communityProfile?.name` is empty, require a fixed confirmation word
(`concord_dissolve_confirm_fallback`). Reset the input when the modal opens/closes.

## New Paraglide messages (de + en)

- `concord_menu_delete_channel` — "Kanal löschen" / "Delete channel"
- `concord_delete_channel_title` — "Kanal löschen?" / "Delete channel?"
- `concord_delete_channel_body` (param `name`) — "„{name}" und der gesamte Verlauf
  werden für alle Mitglieder entfernt. Das lässt sich nicht rückgängig machen." /
  "\"{name}\" and its full history will be removed for all members. This can't be undone."
- `concord_delete_channel_action` — "Kanal löschen" / "Delete channel"
- `concord_channel_deleted` — "Kanal gelöscht." / "Channel deleted."
- `concord_channel_delete_failed` — "Kanal konnte nicht gelöscht werden." / "Couldn't delete the channel."
- `concord_dissolved_recover` — "Neuen Bereich gründen" / "Start a new area"
- `concord_dissolve_confirm_label` (param `name`) — "Tippe zur Bestätigung den Namen
  des Bereichs: {name}" / "Type the area name to confirm: {name}"
- `concord_dissolve_confirm_placeholder` — "Name des Bereichs" / "Area name"
- `concord_dissolve_confirm_fallback` — "AUFLÖSEN" / "DISSOLVE"

## Testing

Component tests (jsdom):
- `ChannelChat`: the `⋯` menu shows "Kanal löschen" only when `isOwner && !dissolved &&
  channelCount > 1` → `openOverlay('delete-channel')`; the dissolved banner shows the
  "Neuen Bereich gründen" recover button only when `isOwner`, calling `openOverlay('create')`.
- `PrivateChannelsView`: `overlay==='delete-channel'` modal calls
  `concord.community.deleteChannel` with the active channel id and re-selects; the
  dissolve modal's confirm button is disabled until the area name is typed; the
  `create` overlay passes `community=undefined` when dissolved (force-found).

## Scope boundaries (not doing)

- No undissolve/refound wiring (impossible/irrelevant per protocol).
- No channel rename (CORD ChannelMetadata carries name only; out of scope here).
- No changes to the invite-link flow or receive-inbox.
- No SDK/relay/protocol changes.

## Files touched (anticipated)

- `src/lib/components/community/channels/ChannelChat.svelte` (menu item, banner recover
  button, `channelCount` prop)
- `src/lib/components/community/channels/PrivateChannelsView.svelte` (delete-channel
  modal + handler, dissolve typed-confirm, `create` overlay force-found when dissolved,
  pass `channelCount`)
- `messages/de.json`, `messages/en.json`
- Tests under `src/lib/components/__tests__/`
