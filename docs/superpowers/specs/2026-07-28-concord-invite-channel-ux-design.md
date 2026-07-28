# Concord Invite & Channel UX Fixes — Design

**Date:** 2026-07-28
**Status:** Approved (design), pending implementation plan
**Branch:** `worktree-cordn-groups`

## Problem

A user attached a Concord private-channels area to a community and got confused by
the Kanäle (Channels) tab:

1. **"Did I create two groups?"** No — one area with three channels
   (`edufeed-private` 🔒, `general` #, `ideen` 🔒). The area itself is not shown as a
   row; the first private channel happened to share the community name, and every
   new channel is locked, so it read as multiple groups.
2. **"Everything is locked."** The create-channel wizard (`+ Neuer privater Kanal`)
   always creates a **private** channel. The only public (`#`) channel is the
   auto-created genesis `general`. The user expected to be able to create a normal
   open channel.
3. **"I can't invite people."** Two invite surfaces exist but neither met the
   expectation of *invite by npub* or *invite from my follow list*:
   - The sidebar `Einladungen` button is the **received-invites inbox**, not a send
     action (showed "Keine Einladungen"), and is easily confused with the `Einladen`
     send action buried in the `⋯` menu.
   - The `Einladen` → **"Direkt einladen"** tab renders **empty** because it only
     lists existing verified community members (`getVerifiedMembers`), and this
     community has none besides the owner. There is **no free-form npub entry** and
     **no personal-follow-list** integration.

## Key protocol facts (verified against `applesauce-concord/dist`)

- Channel visibility is `channel.private` (`PrivateChannelsView.svelte:256` renders
  `🔒` vs `#`). Accessibility: `deriveVisibleChannels`
  (`src/lib/concord/community.svelte.js:39-43`) sets
  `accessible = !private || heldChannelIds.includes(channel_id)`.
- **Key model** (`applesauce-concord/dist/helpers/community.js` `channelSecret`):
  - **Public channel** (`private:false`) → chat key derives from
    `material.community_root`. Any area member can read it; no per-channel key.
  - **Private channel** (`private:true`) → its own `channel.key`; must be handed that
    key.
- `community.createChannel(name, { private })` supports both (genesis `general` is
  created `{ private: false }`).
- `community.grantChannelAccess(channelId, member)`
  (`applesauce-concord/dist/client/community.js:840`) gift-wraps a bundle carrying the
  **community material** plus the requested channel's key. It therefore works
  correctly for **both** visibilities:
  - Public channel → the bundle's `community_root` is all the invitee needs; they
    become a member and can read all public channels.
  - Private channel → additionally hands over that channel's specific key.
  - Requires `MANAGE_CHANNELS`; publish is best-effort (delivery unobservable, only
    permission errors reject).

**Conclusion:** the invite gap is a **UI gap**, not a protocol gap. No SDK, relay, or
`grantChannelAccess` semantics change is needed.

## Design

### 1. Direct-invite picker (core fix)

Reuse the app-standard people-picker `ContactSearchInput.svelte`
(`src/lib/components/shared/`, already used in DM compose, calendar
`InviteToEventModal`, `AddProfileRow`, `SendFormModal`). With `acceptPubkeyInput` it
searches kind-3 follows (`contactsStore.searchContacts`) **and** offers an
"invite this person" row when the input parses as a valid npub/hex, emitting
`onselect(contact)` or `onrawpubkey(hex)`.

**`ChannelInviteSheet.svelte` — "Direkt einladen" tab (lines ~199-217):**

- Render a `ContactSearchInput` with `acceptPubkeyInput`, a "Name suchen oder npub
  einfügen…" placeholder, and `exclude` = already-`sent` pubkeys ∪ self.
- `onselect={(c) => directInvite(c.pubkey)}`, `onrawpubkey={(hex) => directInvite(hex)}`.
  `directInvite` (existing, lines 116-129) already calls
  `grantChannelAccess(channel.channel_id, pubkey)` and appends to `sent` — unchanged.
- Keep the existing verified-community-member quick-list **below** the picker as
  shortcuts, wiring the same `exclude` so invited/self rows drop out.

**`ChannelCreateWizard.svelte` — step 2 "Einladen":** same `ContactSearchInput` +
member quick-list, feeding the wizard's `selected` set (which step `create()` already
loops through with `grantChannelAccess`, lines ~106-110). No change to `create()`.

### 2. Empty-state fix

When the community-member quick-list is empty, render an explicit hint instead of the
current blank text: e.g. "Keine Mitglieder zum Direktwählen — suche oben einen Kontakt,
füge einen npub ein, oder teile den Einladungslink." The `ContactSearchInput` stays
usable regardless. New message: `concord_invite_direct_empty`.

### 3. Public/private channel choice

`ChannelCreateWizard.svelte` step 1 (Grundlagen): add a visibility toggle
(radio/segmented) — `#` Offen (all area members) vs `🔒` Privat (chosen subset).
Default **private** (preserve current behaviour). Pass through to
`createChannel(name.trim(), { private: isPrivate })` (currently hard-coded `true`,
`ChannelCreateWizard.svelte:82`).

- For a **public** channel, step 3's key-loss warning copy softens (access = area
  membership, not a channel-specific key) — new/conditional message
  `concord_channel_public_hint`.
- The founding path (first channel founds the area) is unaffected; the toggle applies
  to the channel created inside it either way.

New messages: `concord_channel_visibility_label`, `concord_channel_visibility_public`,
`concord_channel_visibility_public_hint`, `concord_channel_visibility_private`,
`concord_channel_visibility_private_hint`.

### 4. Clarity / labeling (`PrivateChannelsView.svelte`)

- **Icon legend + tooltips:** small legend under the "Kanäle" header (or `title`
  tooltips on each channel row's icon): `#` = "alle im Bereich", `🔒` = "nur
  ausgewählte Mitglieder". New messages `concord_legend_public`,
  `concord_legend_private`.
- **Relabel `concord_new_channel`** "Neuer privater Kanal" → "Neuer Kanal" (used at
  the footer button line 271 and the found-pane line 297 — drop/adjust the hardcoded
  `🔒` prefix at 297 since the channel may now be public).
- **Rename `concord_invites`** ("Einladungen", the ✉ footer inbox button, line 279) →
  a received-invites label, e.g. "Erhaltene Einladungen", to disambiguate from the
  `Einladen` send action.
- **Surface `Einladen` (send):** add a visible invite button in the channel header
  (near the 👥 members and `⋯` buttons) that sets `overlay = 'invite'` (the existing
  `ChannelInviteSheet` path, gated on `activeChannel` present), so sending invites is
  discoverable without opening `⋯`.

### 5. Testing

Component tests (jsdom, `src/lib/components/__tests__/` alongside existing
`ChannelMembersModal.test.js`):

- `ChannelInviteSheet`: Direct tab renders `ContactSearchInput`; `onrawpubkey` and
  `onselect` invoke `grantChannelAccess(channelId, pubkey)`; `exclude` hides
  already-invited + self; empty member-list shows the empty-state hint; Link tab
  unchanged.
- `ChannelCreateWizard`: visibility toggle passes `{ private: false|true }` to
  `createChannel`; public selection shows the softened key hint; default is private.
- `PrivateChannelsView`: header `Einladen` button opens the invite overlay when a
  channel is active; renamed inbox label renders.

Mock `applesauce-concord` community (`createChannel`, `grantChannelAccess`) and
`contactsStore` as the existing Concord/contact tests do. Add Paraglide messages to
both `messages/de.json` and `messages/en.json`; run `pnpm run machine-translate` for
any other locales.

## Scope boundaries (explicitly NOT doing)

- No change to the invite **link/QR** flow (`createInvite`, revoke) or its persistence
  behaviour.
- No change to the **receive/accept/decline** inbox logic (`InviteInboxModal`,
  `directInviteWatcher`).
- No SDK / `grantChannelAccess` / relay / protocol changes.
- No banlist/moderation, no area rename, no per-channel description (CORD
  `ChannelMetadata` has none).

## Files touched (anticipated)

- `src/lib/components/community/channels/ChannelInviteSheet.svelte` (picker +
  empty-state)
- `src/lib/components/community/channels/ChannelCreateWizard.svelte` (picker in step
  2, visibility toggle in step 1, `{private}` pass-through, public hint)
- `src/lib/components/community/channels/PrivateChannelsView.svelte` (legend, header
  Einladen button, relabels)
- `messages/de.json`, `messages/en.json` (new + renamed strings)
- New/updated tests under `src/lib/components/__tests__/`

## Open questions

None blocking. `contactsStore` is populated on login (kind-3); if a user has no
follows, the npub-paste path and the invite link still cover the need.
